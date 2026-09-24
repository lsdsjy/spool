/**
 * External apps a Session can be opened in, beyond resuming it in a terminal.
 *
 * Codex Desktop registers the `codex:` scheme (shipped inside ChatGPT.app) and
 * opens a thread by id: `codex://threads/<threadId>`. Pi's local web UI
 * addresses a session with `?session=<uuid>&cwd=<project>`.
 *
 * Keep this list deliberately small: each target is a scheme the OS hands to an
 * app, so an entry here is also something `shell.openExternal` will launch.
 */
export type SessionExternalTargetId = 'codex-desktop' | 'pi-web'

export interface SessionExternalTarget {
  id: SessionExternalTargetId
  /** i18n key for the menu label / tooltip. */
  labelKey: string
  url: string
}

/** Pi's local web UI (see the `@agegr/pi-web` checkout: `next dev -p 30141`). */
export const DEFAULT_PI_WEB_BASE_URL = 'http://127.0.0.1:30141'

export interface SessionExternalTargetInput {
  source: string
  sessionUuid: string
  cwd?: string | null
}

export function getSessionExternalTargets(
  session: SessionExternalTargetInput,
  options: { piWebBaseUrl?: string } = {},
): SessionExternalTarget[] {
  const targets: SessionExternalTarget[] = []

  if (session.source === 'codex') {
    targets.push({
      id: 'codex-desktop',
      labelKey: 'session.openInCodex',
      url: `codex://threads/${encodeURIComponent(session.sessionUuid)}`,
    })
  }

  if (session.source === 'pi') {
    const base = (options.piWebBaseUrl ?? DEFAULT_PI_WEB_BASE_URL).replace(/\/+$/, '')
    const params = new URLSearchParams({ session: session.sessionUuid })
    if (session.cwd) params.set('cwd', session.cwd)
    targets.push({
      id: 'pi-web',
      labelKey: 'session.openInPiWeb',
      url: `${base}/?${params.toString()}`,
    })
  }

  return targets
}
