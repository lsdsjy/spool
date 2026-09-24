import type { Session, SessionSource, SessionsCursor } from '@spool-lab/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import VirtualSessionList, { type SessionListRow } from './VirtualSessionList.js'

const PAGE_SIZE = 60

type Props = {
  source: SessionSource
  onOpenSession: (uuid: string) => void
  onCopySessionId: (source: SessionSource) => void
  onShare?: (uuid: string) => void
}

/** Every indexed Session from one agent, newest first, across all projects.
 *  Opened from the sidebar's Agents section. */
export default function AgentView({ source, onOpenSession, onCopySessionId, onShare }: Props) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [cursor, setCursor] = useState<SessionsCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const fetchTokenRef = useRef(0)

  useEffect(() => {
    const token = ++fetchTokenRef.current
    setSessions(null)
    setCursor(null)
    window.spool
      .listSessions({ sources: [source], limit: PAGE_SIZE })
      .then((page) => {
        if (fetchTokenRef.current !== token) return
        setSessions(page.sessions)
        setCursor(page.nextCursor ?? null)
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return
        setSessions([])
        setCursor(null)
      })
  }, [source])

  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const loadingRef = useRef(loadingMore)
  loadingRef.current = loadingMore

  async function loadMore() {
    if (loadingRef.current || !cursorRef.current) return
    setLoadingMore(true)
    const token = fetchTokenRef.current
    try {
      const page = await window.spool.listSessions({
        sources: [source],
        limit: PAGE_SIZE,
        cursor: cursorRef.current,
      })
      if (fetchTokenRef.current !== token) return
      setSessions((prev) => [...(prev ?? []), ...page.sessions])
      setCursor(page.nextCursor ?? null)
    } catch {
      setCursor(null)
    } finally {
      setLoadingMore(false)
    }
  }

  const rows: SessionListRow[] = useMemo(
    () =>
      (sessions ?? []).map((session) => ({
        kind: 'session' as const,
        id: session.sessionUuid,
        session,
        showProject: true,
        headerId: null,
      })),
    [sessions],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-3 px-6 pt-1.5 pb-3">
        <span
          aria-hidden
          className="size-2.5 flex-none rounded-full"
          style={{ background: getSessionSourceColor(source) }}
        />
        <h1 className="text-warm-text dark:text-dark-text truncate text-[15px] font-medium">
          {getSessionSourceLabel(source)}
        </h1>
        {sessions && (
          <span className="text-warm-faint dark:text-dark-muted text-xs tabular-nums">
            {t('sidebar.sessionCount', { count: sessions.length })}
          </span>
        )}
      </header>

      {sessions === null ? (
        <div className="px-6">
          <div className="bg-warm-surface2 dark:bg-dark-surface2 h-4 w-40 animate-pulse rounded" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-warm-faint dark:text-dark-muted px-6 py-3 text-sm">
          {t('library.noSessions')}
        </p>
      ) : (
        <VirtualSessionList
          rows={rows}
          onEndReached={() => {
            void loadMore()
          }}
          onOpenSession={onOpenSession}
          onCopySessionId={onCopySessionId}
          {...(onShare ? { onShare } : {})}
          testId="agent-view-list"
        />
      )}
    </div>
  )
}
