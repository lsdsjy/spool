// Top-level Security Scan page — peer to Sessions / Shares / Search.
//
// Library-warm aesthetic: minimal chrome, warm surfaces, monospace
// for paths / kinds / counts, sentence-case labels everywhere. The
// page is content-first — no big H1, no decorative blocks.
//
// Information architecture
//   1. Tiny header row (count of active findings · sessions affected · Rescan)
//   2. Category chips, grouped High / Low (Info hidden behind toggle —
//      file paths, IPs and internal hosts have an unworkable
//      false-positive rate as standalone findings, and would otherwise
//      drown the real leaks)
//   3. Filter bar (GitHub-style qualifiers)
//   4. Sessions-with-findings list — expand a row to review individual
//      findings; the filter pins down what gets shown both at the
//      session-list level AND inside the row

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RotateCw, Trash2, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'
import type {
  FindingRow,
  RiskByCategoryRow,
  SessionFindingFilter,
  SessionWithFindingCounts,
} from '@spool-lab/core'
import { securityApi } from '../api/security.js'
import PurgeConfirmDialog from './security/PurgeConfirmDialog.js'
import { parseQualifier, withQualifier } from './security/parse-qualifier.js'

interface Props {
  onOpenSession: (sessionUuid: string) => void
}

export default function SecurityPage({ onOpenSession }: Props) {
  const { t } = useTranslation()
  const [risk, setRisk] = useState<RiskByCategoryRow[]>([])
  const [sessions, setSessions] = useState<SessionWithFindingCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showInfo, setShowInfo] = useState(false)
  const [bulkPurgeKind, setBulkPurgeKind] = useState<string | null>(null)
  const parsed = useMemo(() => parseQualifier(query), [query])

  // Effective filter for the session list. If the user hasn't pinned
  // a severity AND hasn't enabled info, the list query stays at the
  // default "active, no severity filter" — but info findings won't
  // appear here anyway because updateSessionCounts excludes them
  // from scan_finding_count. The chip-click path always pins a kind,
  // which scopes the list precisely.
  const listFilter: SessionFindingFilter = parsed.filter

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        securityApi.riskByCategory(),
        securityApi.listSessionsWithFindings(listFilter),
      ])
      setRisk(r)
      setSessions(s)
      setLoading(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [listFilter])

  useEffect(() => {
    void refresh()
    const off = securityApi.onChange(() => { void refresh() })
    return () => { off() }
  }, [refresh])

  async function handleRescanAll() {
    await securityApi.rescanAll()
    void refresh()
  }

  function selectKindFilter(kind: string) {
    setQuery((q) => withQualifier(q, 'kind', kind))
  }

  async function handleBulkPurgeKind(kind: string) {
    const rows = await securityApi.listFindings({
      kind: kind as Parameters<typeof securityApi.listFindings>[0]['kind'],
      state: 'active',
    })
    if (rows.length === 0) {
      setBulkPurgeKind(null)
      return
    }
    await securityApi.purgeFindings(rows.map((r) => r.id))
    setBulkPurgeKind(null)
    void refresh()
  }

  const highCats = risk.filter(r => r.severity === 'high')
  const lowCats = risk.filter(r => r.severity === 'low')
  const infoCats = risk.filter(r => r.severity === 'info')
  const visibleActive = highCats.reduce((a, c) => a + c.count, 0)
                      + lowCats.reduce((a, c) => a + c.count, 0)
  const sessionsCount = sessions.length

  return (
    <div data-testid="security-page" className="flex flex-col flex-1 min-h-0">
      <div className="flex-none flex items-center gap-3 px-6 pt-1.5 pb-3">
        <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
          {t('security.summary', {
            findings: visibleActive,
            sessions: sessionsCount,
            defaultValue: '{{findings}} active · {{sessions}} sessions',
          })}
        </span>
        <button
          type="button"
          data-testid="security-rescan-all"
          onClick={handleRescanAll}
          title={t('security.rescanAll', { defaultValue: 'Rescan all' })}
          aria-label={t('security.rescanAll', { defaultValue: 'Rescan all' })}
          className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <RotateCw size={13} strokeWidth={1.6} aria-hidden />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {loading ? null : error ? (
          <p className="text-sm text-warm-muted dark:text-dark-muted py-4">
            {t('common.error')}: {error}
          </p>
        ) : risk.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <CategoryPanel
              high={highCats}
              low={lowCats}
              info={infoCats}
              showInfo={showInfo}
              onToggleInfo={() => setShowInfo(v => !v)}
              onSelectKind={selectKindFilter}
              onBulkPurgeKind={(k) => setBulkPurgeKind(k)}
            />

            <FilterBar
              value={query}
              onChange={setQuery}
            />

            <SessionsList
              sessions={sessions}
              activeKindFilter={parsed.filter.kind ?? null}
              onOpen={onOpenSession}
              onRefresh={refresh}
            />
          </>
        )}
      </div>

      <PurgeConfirmDialog
        open={bulkPurgeKind !== null}
        count={
          bulkPurgeKind
            ? (risk.find((c) => c.kind === bulkPurgeKind)?.count ?? 0)
            : 0
        }
        summary={bulkPurgeKind ? `all ${bulkPurgeKind}` : ''}
        onConfirm={() => { if (bulkPurgeKind) void handleBulkPurgeKind(bulkPurgeKind) }}
        onCancel={() => setBulkPurgeKind(null)}
      />
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <p className="font-mono text-[11px] text-warm-faint dark:text-dark-muted pt-4">
      {t('security.empty', { defaultValue: 'No findings yet. Your archive is clean.' })}
    </p>
  )
}

// ── Category chips, grouped by severity ────────────────────────────────────

function CategoryPanel({
  high,
  low,
  info,
  showInfo,
  onToggleInfo,
  onSelectKind,
  onBulkPurgeKind,
}: {
  high: RiskByCategoryRow[]
  low: RiskByCategoryRow[]
  info: RiskByCategoryRow[]
  showInfo: boolean
  onToggleInfo: () => void
  onSelectKind: (kind: string) => void
  onBulkPurgeKind: (kind: string) => void
}) {
  const { t } = useTranslation()
  const infoCount = info.reduce((a, c) => a + c.count, 0)

  return (
    <section className="mb-5">
      {high.length > 0 && (
        <CategoryGroup
          labelKey="security.severity_high"
          defaultLabel="High"
          accent
          rows={high}
          onSelectKind={onSelectKind}
          onBulkPurgeKind={onBulkPurgeKind}
        />
      )}

      {low.length > 0 && (
        <CategoryGroup
          labelKey="security.severity_low"
          defaultLabel="Low"
          rows={low}
          onSelectKind={onSelectKind}
          onBulkPurgeKind={onBulkPurgeKind}
        />
      )}

      {info.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            data-testid="security-toggle-info"
            onClick={onToggleInfo}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] font-semibold text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
            aria-expanded={showInfo}
          >
            {showInfo ? <EyeOff size={11} strokeWidth={1.75} aria-hidden /> : <Eye size={11} strokeWidth={1.75} aria-hidden />}
            <span>
              {t('security.info_toggle', {
                items: infoCount,
                defaultValue: 'Informational signals · {{items}} (paths, IPs, internal hosts — high false-positive rate)',
              })}
            </span>
          </button>
          {showInfo && (
            <div className="mt-2">
              <CategoryGroup
                labelKey={null}
                defaultLabel=""
                muted
                rows={info}
                onSelectKind={onSelectKind}
                onBulkPurgeKind={onBulkPurgeKind}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function CategoryGroup({
  labelKey,
  defaultLabel,
  rows,
  accent,
  muted,
  onSelectKind,
  onBulkPurgeKind,
}: {
  labelKey: string | null
  defaultLabel: string
  rows: RiskByCategoryRow[]
  accent?: boolean
  muted?: boolean
  onSelectKind: (kind: string) => void
  onBulkPurgeKind: (kind: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mb-3 last:mb-0">
      {labelKey && (
        <div className="flex items-center gap-1.5 mb-1.5">
          {accent && <AlertTriangle size={11} strokeWidth={1.75} className="text-accent dark:text-accent-dark" aria-hidden />}
          <h2 className="text-[10px] uppercase tracking-[0.08em] font-semibold text-warm-muted dark:text-dark-muted">
            {t(labelKey, { defaultValue: defaultLabel })}
          </h2>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <CategoryChip
            key={r.kind}
            kind={r.kind}
            count={r.count}
            accent={accent}
            muted={muted}
            onSelect={() => onSelectKind(r.kind)}
            onBulkPurge={() => onBulkPurgeKind(r.kind)}
          />
        ))}
      </div>
    </div>
  )
}

function CategoryChip({
  kind,
  count,
  accent,
  muted,
  onSelect,
  onBulkPurge,
}: {
  kind: string
  count: number
  accent?: boolean
  muted?: boolean
  onSelect: () => void
  onBulkPurge: () => void
}) {
  const base = 'group inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded text-[11px] border transition-colors'
  const tone = accent
    ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent/30 dark:border-accent-dark/30 text-warm-text dark:text-dark-text hover:border-accent/60 dark:hover:border-accent-dark/60'
    : muted
      ? 'bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border text-warm-faint dark:text-dark-muted hover:text-warm-muted dark:hover:text-dark-text'
      : 'bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
  return (
    <span
      data-testid="risk-category-chip"
      data-kind={kind}
      className={`${base} ${tone}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="inline-flex items-center gap-1.5 font-mono tabular-nums"
        title={`Filter by ${kind}`}
      >
        <span>{kind}</span>
        <span className="text-warm-faint dark:text-dark-muted">·</span>
        <span>{count}</span>
      </button>
      <button
        type="button"
        data-testid="risk-bulk-purge"
        onClick={onBulkPurge}
        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-4 h-4 rounded text-warm-faint hover:text-accent dark:hover:text-accent-dark"
        title={`Purge all ${kind}`}
        aria-label={`Purge all ${kind}`}
      >
        <Trash2 size={10} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

// ── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mb-3">
      <input
        type="search"
        data-testid="security-filter-bar"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('security.filter_placeholder', {
          defaultValue: 'kind:api-key · is:active · severity:high · free text',
        })}
        className="block w-full h-8 px-3 rounded font-mono text-[12px] bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted focus:outline-none focus:border-warm-border2 dark:focus:border-dark-border2 transition-colors"
      />
    </div>
  )
}

// ── Session list ───────────────────────────────────────────────────────────

function SessionsList({
  sessions,
  activeKindFilter,
  onOpen,
  onRefresh,
}: {
  sessions: SessionWithFindingCounts[]
  /** When the page filter pins a kind, the per-row expansion uses
   *  it too — fixes the "filtered by api-key but expanded row shows
   *  every absolute-path finding" UX bug. */
  activeKindFilter: string | null
  onOpen: (uuid: string) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  if (sessions.length === 0) {
    return (
      <p className="font-mono text-[11px] text-warm-faint dark:text-dark-muted py-4">
        {t('security.empty_sessions', { defaultValue: 'No sessions match this filter.' })}
      </p>
    )
  }
  return (
    <ul data-testid="security-session-list" className="flex flex-col gap-0">
      {sessions.map(s => (
        <SessionRow
          key={s.id}
          session={s}
          activeKindFilter={activeKindFilter}
          onOpen={() => onOpen(s.sessionUuid)}
          onRefresh={onRefresh}
        />
      ))}
    </ul>
  )
}

function SessionRow({
  session,
  activeKindFilter,
  onOpen,
  onRefresh,
}: {
  session: SessionWithFindingCounts
  activeKindFilter: string | null
  onOpen: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [findings, setFindings] = useState<FindingRow[] | null>(null)

  const loadFindings = useCallback(async () => {
    const filter: Parameters<typeof securityApi.listFindings>[0] = { sessionId: session.id }
    if (activeKindFilter) filter.kind = activeKindFilter as typeof filter.kind
    const rows = await securityApi.listFindings(filter)
    setFindings(rows)
  }, [session.id, activeKindFilter])

  useEffect(() => {
    if (expanded) void loadFindings()
    else setFindings(null)
  }, [expanded, loadFindings])

  const title = session.title?.trim() || t('common.noTitle')
  const date = new Date(session.startedAt).toLocaleDateString()

  return (
    <li data-testid="security-session-row" data-session-uuid={session.sessionUuid} className="border-b border-warm-border dark:border-dark-border last:border-b-0">
      <div className="flex items-center gap-2 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? t('common.collapse', { defaultValue: 'Collapse' }) : t('common.expand', { defaultValue: 'Expand' })}
          className="flex-none inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
        >
          {expanded ? <ChevronDown size={14} strokeWidth={1.6} aria-hidden /> : <ChevronRight size={14} strokeWidth={1.6} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-warm-text dark:text-dark-text truncate">
              {title}
            </span>
            {session.highCount > 0 && (
              <span className="flex-none inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-accent dark:text-accent-dark">
                <AlertTriangle size={11} strokeWidth={1.75} aria-hidden />
                {session.highCount}
              </span>
            )}
            {session.findingCount > session.highCount && (
              <span className="flex-none font-mono text-[11px] tabular-nums text-warm-muted dark:text-dark-muted">
                {session.findingCount - session.highCount}
                <span className="text-warm-faint dark:text-dark-muted"> low</span>
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-warm-faint dark:text-dark-muted truncate">
            {date}
          </p>
        </button>
      </div>
      {expanded && findings && (
        <ul className="flex flex-col gap-0 pb-2 pl-7">
          {findings.length === 0 ? (
            <li className="font-mono text-[11px] text-warm-faint dark:text-dark-muted py-1">
              {t('security.no_matching_findings', { defaultValue: 'No findings match the current filter.' })}
            </li>
          ) : (
            findings.map(f => (
              <FindingItem
                key={f.id}
                finding={f}
                onChange={() => { void loadFindings(); onRefresh() }}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}

function FindingItem({
  finding,
  onChange,
}: {
  finding: FindingRow
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(null)
  const [purgePending, setPurgePending] = useState(false)

  useEffect(() => {
    securityApi.getFindingValue(finding.id).then(setValue).catch(() => setValue(null))
  }, [finding.id])

  async function dismiss(scope: 'session' | 'global') {
    await securityApi.dismissFinding(finding.id, scope)
    onChange()
  }
  async function purge() {
    await securityApi.purgeFinding(finding.id)
    setPurgePending(false)
    onChange()
  }

  const isActive = finding.state === 'active'

  return (
    <li
      data-testid="finding-row"
      data-finding-id={finding.id}
      data-kind={finding.kind}
      data-state={finding.state}
      className="group flex items-center gap-2 py-1 font-mono text-[11px]"
    >
      <span className="flex-none w-32 truncate text-warm-muted dark:text-dark-muted">
        {finding.kind}
      </span>
      <span className="flex-1 min-w-0 truncate text-warm-text dark:text-dark-text">
        {value ?? <em className="text-warm-faint dark:text-dark-faint not-italic">{t('security.value_unavailable', { defaultValue: '(value unavailable)' })}</em>}
      </span>
      {isActive ? (
        <span className="flex-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          <button
            type="button"
            data-testid="dismiss-in-session"
            onClick={() => { void dismiss('session') }}
            className="h-5 px-1.5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_session', { defaultValue: 'Dismiss in this session' })}
          >
            {t('security.dismiss', { defaultValue: 'Dismiss' })}
          </button>
          <button
            type="button"
            data-testid="dismiss-everywhere"
            onClick={() => { void dismiss('global') }}
            className="h-5 px-1.5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_global', { defaultValue: 'Dismiss everywhere' })}
          >
            {t('security.everywhere', { defaultValue: 'Everywhere' })}
          </button>
          <button
            type="button"
            data-testid="purge-button"
            onClick={() => setPurgePending(true)}
            className="h-5 px-1.5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-accent dark:hover:text-accent-dark transition-colors inline-flex items-center gap-1"
            title={t('security.purge', { defaultValue: 'Purge from local archive' })}
          >
            <Trash2 size={10} strokeWidth={1.75} aria-hidden />
            {t('security.purge', { defaultValue: 'Purge' })}
          </button>
          <PurgeConfirmDialog
            open={purgePending}
            count={1}
            summary={finding.kind}
            onConfirm={() => { void purge() }}
            onCancel={() => setPurgePending(false)}
          />
        </span>
      ) : (
        <span className="flex-none text-warm-faint dark:text-dark-muted">
          {finding.state}
        </span>
      )}
    </li>
  )
}
