import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

import { parseCodexSessionLines, readCodexSubagentInfo } from '@spool-lab/session-kit'
import type { CodexSubagentMessages } from '@spool-lab/session-kit'

import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'

// The parsing brain lives in @spool-lab/session-kit (browser-safe, shared
// with the web reader); this wrapper owns only the streamed file I/O.

export const CODEX_INDEX_VERSION = 'codex-v7-fold-subagent-threads'

const READ_CHUNK_SIZE = 1024 * 1024

/** One child rollout to embed into its parent thread. */
export interface CodexSubagentRef {
  filePath: string
  /** Display label resolved from the child's session_meta. */
  label: string
  sessionUuid: string
}

/** Metadata the syncer needs to build the parent → children index without
 *  parsing full transcripts. */
export interface CodexThreadMeta {
  sessionUuid: string
  parentThreadId: string | null
  label: string
}

export function loadCodexSession(
  filePath: string,
  options: { subagents?: CodexSubagentRef[] } = {},
): ParseSessionResult {
  const subagents: CodexSubagentMessages[] = []
  for (const ref of options.subagents ?? []) {
    const child = parseCodexSessionLines(readNonEmptyLines(ref.filePath), ref.filePath, {
      allowSubagentFile: true,
    })
    if (child.kind !== 'parsed') continue
    subagents.push({
      label: ref.label || ref.sessionUuid,
      sessionUuid: ref.sessionUuid || child.session.sessionUuid,
      messages: child.session.messages,
    })
  }

  const result = parseCodexSessionLines(readNonEmptyLines(filePath), filePath, { subagents })
  if (result.kind !== 'parsed') return result
  const gitRemote = loadCodexSessionGitRemote(filePath)
  return gitRemote ? { kind: 'parsed', session: { ...result.session, gitRemote } } : result
}

/** Read the leading `session_meta` record: thread id, subagent parent, label.
 *  Used to build the parent → children index before any transcript is parsed. */
export function loadCodexThreadMeta(filePath: string): CodexThreadMeta | null {
  try {
    let scanned = 0
    for (const line of readNonEmptyLines(filePath)) {
      if (scanned++ >= 100) break
      let record: Record<string, unknown>
      try {
        record = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (record['type'] !== 'session_meta') continue
      const payload = record['payload']
      if (!payload || typeof payload !== 'object') return null
      const meta = payload as Record<string, unknown>
      const sessionUuid = typeof meta['id'] === 'string' ? meta['id'] : ''
      if (!sessionUuid) return null
      const info = readCodexSubagentInfo(meta['source'])
      return {
        sessionUuid,
        parentThreadId: info?.parentThreadId ?? null,
        label: info?.label ?? '',
      }
    }
    return null
  } catch {
    return null
  }
}

function* readNonEmptyLines(filePath: string): Iterable<string> {
  const fd = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(READ_CHUNK_SIZE)
  const decoder = new StringDecoder('utf8')
  let pending = ''

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break

      pending += decoder.write(buffer.subarray(0, bytesRead))
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim().length > 0) yield line
      }
    }

    pending += decoder.end()
    if (pending.trim().length > 0) yield pending
  } finally {
    closeSync(fd)
  }
}

export function parseCodexSession(filePath: string): ParsedSession | null {
  try {
    const result = loadCodexSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

/**
 * Read only the leading metadata records needed for project identity repair.
 * Codex writes session_meta at the start of each rollout, so this avoids
 * parsing a potentially huge historical transcript during DB startup.
 */
export function loadCodexSessionGitRemote(filePath: string): string | null {
  try {
    let scanned = 0
    for (const line of readNonEmptyLines(filePath)) {
      if (scanned++ >= 100) break
      let record: Record<string, unknown>
      try {
        record = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (record['type'] !== 'session_meta') continue
      const payload = record['payload']
      if (!payload || typeof payload !== 'object') return null
      const git = (payload as Record<string, unknown>)['git']
      if (!git || typeof git !== 'object') return null
      const repositoryUrl = (git as Record<string, unknown>)['repository_url']
      return typeof repositoryUrl === 'string' && repositoryUrl.trim() ? repositoryUrl : null
    }
    return null
  } catch {
    return null
  }
}
