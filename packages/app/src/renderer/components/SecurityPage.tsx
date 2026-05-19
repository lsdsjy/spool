// Top-level Security Scan page — peer to Sessions / Shares / Search.
//
// Layout follows the Claude Design handoff (Spool Security Scan —
// Redesign):
//   1. Tiny meta row (active count · sessions · Rescan icon button)
//   2. Risk board — kind tiles in two boards: high (accent-tinted) and
//      low (neutral). Each tile shows count + how-many-sessions in mono;
//      hover reveals a Purge-all-of-kind icon button.
//   3. Active filter pill (when a kind is pinned)
//   4. Sessions list — each session is a card with title + meta + up to
//      3 findings inline (no expand chevron). Values blur-by-default
//      and hover-reveal. "Show N more" reveals the rest.
//   5. Info drawer — informational signals (paths, IPs, internal-host)
//      collapsed by default with the false-positive audit fact visible.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Eye, EyeOff, Info, RotateCw, Trash2, ShieldAlert, X, Settings as SettingsIcon } from 'lucide-react'
import type {
  FindingRow,
  RiskByCategoryRow,
  ScanStatus,
  SessionFindingFilter,
  SessionWithFindingCounts,
  Session,
} from '@spool-lab/core'
import { securityApi } from '../api/security.js'
import PurgeConfirmDialog from './security/PurgeConfirmDialog.js'
import { parseQualifier, withQualifier } from './security/parse-qualifier.js'
import { SourceBadge } from './Badges.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

interface Props {
  onOpenSession: (sessionUuid: string) => void
}

type Sess = SessionWithFindingCounts & { source: Session['source'] }

export default function SecurityPage({ onOpenSession }: Props) {
  const { t } = useTranslation()
  const [risk, setRisk] = useState<RiskByCategoryRow[]>([])
  const [sessions, setSessions] = useState<Sess[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showInfo, setShowInfo] = useState(false)
  const [bulkPurgeKind, setBulkPurgeKind] = useState<string | null>(null)
  const [bulkPurgeSamples, setBulkPurgeSamples] = useState<Array<{ value: string; sessionTitle: string }>>([])
  // Default: reveal values. The page exists so the user can review
  // what got captured — hiding the very thing they came to read is
  // anti-UX. The eye-off toggle is for screen-share / step-away moments.
  const [valuesHidden, setValuesHidden] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  // `backfillStart` is captured the first tick the worker reports
  // backfillRemaining > 0 — the scanning banner reads "12 of N" from
  // it. Reset when the worker goes idle.
  const [backfillStart, setBackfillStart] = useState<number | null>(null)
  // The latest moment `scan_completed_at` was set on ANY session — used
  // as the "scanned X ago" line in the meta row.
  const [lastScanCompletedAt, setLastScanCompletedAt] = useState<string | null>(null)
  const parsed = useMemo(() => parseQualifier(query), [query])

  const filter: SessionFindingFilter = parsed.filter

  const refresh = useCallback(async () => {
    try {
      const [r, s, st] = await Promise.all([
        securityApi.riskByCategory(),
        securityApi.listSessionsWithFindings(filter),
        securityApi.getScanStatus(),
      ])
      setRisk(r)
      setSessions(s as Sess[])
      setScanStatus(st)
      // Pick the most recent scan_completed_at across the session set
      // we just fetched. Cheap because s is already in-memory.
      const completedAts = (s as Sess[])
        .map(x => x.scanCompletedAt)
        .filter((x): x is string => Boolean(x))
      if (completedAts.length > 0) {
        completedAts.sort()
        setLastScanCompletedAt(completedAts[completedAts.length - 1] ?? null)
      }
      setLoading(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void refresh()
    const off = securityApi.onChange(() => { void refresh() })
    return () => { off() }
  }, [refresh])

  // Capture the backfill total the first tick we see > 0, reset when idle.
  useEffect(() => {
    if (!scanStatus) return
    const inFlight = scanStatus.backfillRemaining + (scanStatus.scanning !== null ? 1 : 0)
    if (inFlight === 0) {
      if (backfillStart !== null) setBackfillStart(null)
      return
    }
    if (backfillStart === null || inFlight > backfillStart) {
      setBackfillStart(inFlight)
    }
  }, [scanStatus, backfillStart])

  // Poll status while the worker is busy so the progress bar moves.
  useEffect(() => {
    if (!scanStatus) return
    const busy = scanStatus.queued > 0 || scanStatus.scanning !== null || scanStatus.backfillRemaining > 0
    if (!busy) return
    const handle = setInterval(() => {
      void securityApi.getScanStatus().then(setScanStatus).catch(() => {})
    }, 500)
    return () => clearInterval(handle)
  }, [scanStatus])

  const isScanning = scanStatus !== null &&
    (scanStatus.queued > 0 || scanStatus.scanning !== null || scanStatus.backfillRemaining > 0)

  async function handleRescanAll() {
    await securityApi.rescanAll()
    void refresh()
  }

  function selectKindFilter(kind: string) {
    setQuery((q) => withQualifier(q, 'kind', kind))
  }

  function clearKindFilter() {
    setQuery('')
  }

  async function openBulkPurge(kind: string) {
    setBulkPurgeKind(kind)
    // Fetch a few sample values up-front so the modal can show them.
    const rows = await securityApi.listFindings({
      kind: kind as Parameters<typeof securityApi.listFindings>[0]['kind'],
      state: 'active',
    })
    const samples: Array<{ value: string; sessionTitle: string }> = []
    for (const r of rows.slice(0, 4)) {
      const v = await securityApi.getFindingValue(r.id).catch(() => null)
      if (v !== null) {
        const session = sessions.find(s => s.id === r.sessionId)
        const truncated = v.length > 56 ? v.slice(0, 54) + '…' : v
        samples.push({ value: truncated, sessionTitle: session?.title?.trim() || '(no title)' })
      }
    }
    setBulkPurgeSamples(samples)
  }

  async function confirmBulkPurgeKind() {
    if (!bulkPurgeKind) return
    const rows = await securityApi.listFindings({
      kind: bulkPurgeKind as Parameters<typeof securityApi.listFindings>[0]['kind'],
      state: 'active',
    })
    if (rows.length > 0) {
      await securityApi.purgeFindings(rows.map((r) => r.id))
    }
    setBulkPurgeKind(null)
    setBulkPurgeSamples([])
    void refresh()
  }

  const highCats = risk.filter(r => r.severity === 'high')
  const lowCats = risk.filter(r => r.severity === 'low')
  const infoCats = risk.filter(r => r.severity === 'info')
  const highCount = highCats.reduce((a, c) => a + c.count, 0)
  const lowCount = lowCats.reduce((a, c) => a + c.count, 0)
  const infoCount = infoCats.reduce((a, c) => a + c.count, 0)
  const visibleActive = highCount + lowCount

  return (
    <div data-testid="security-page" className="flex flex-col flex-1 min-h-0">
      {/* Meta row */}
      <div className="flex-none flex items-center gap-3 px-6 pt-2 pb-3">
        <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
          {t('security.summary', { findings: visibleActive, sessions: sessions.length, defaultValue: '{{findings}} active · {{sessions}} sessions' })}
          {lastScanCompletedAt && !isScanning && (
            <>
              {' · '}
              {t('security.scanned_ago', {
                ago: formatScanAgo(lastScanCompletedAt),
                defaultValue: 'scanned {{ago}}',
              })}
            </>
          )}
        </span>
        <button
          type="button"
          data-testid="security-toggle-values"
          onClick={() => setValuesHidden(v => !v)}
          title={valuesHidden
            ? t('security.show_values', { defaultValue: 'Show values' })
            : t('security.hide_values', { defaultValue: 'Hide values (screen-share mode)' })}
          aria-label={valuesHidden
            ? t('security.show_values', { defaultValue: 'Show values' })
            : t('security.hide_values', { defaultValue: 'Hide values (screen-share mode)' })}
          aria-pressed={valuesHidden}
          className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
            valuesHidden
              ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
              : 'text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
          }`}
        >
          {valuesHidden ? <EyeOff size={13} strokeWidth={1.6} aria-hidden /> : <Eye size={13} strokeWidth={1.6} aria-hidden />}
        </button>
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
        <div className="max-w-[720px]">
          {loading ? null : error ? (
            <p className="text-sm text-warm-muted dark:text-dark-muted py-4">
              {t('common.error')}: {error}
            </p>
          ) : risk.length === 0 && !isScanning ? (
            <EmptyState onRescan={handleRescanAll} lastScan={lastScanCompletedAt} currentProfile={scanStatus?.currentProfile ?? null} />
          ) : (
            <>
              {isScanning && scanStatus && (
                <ScanBanner status={scanStatus} backfillStart={backfillStart} />
              )}

              {highCats.length > 0 && (
                <section className="mb-5">
                  <SectionHeader
                    label={t('security.severity_high', { defaultValue: 'High · credentials' })}
                    count={highCount}
                    leading={<AlertTriangle size={11} strokeWidth={1.75} className="text-accent dark:text-accent-dark" aria-hidden />}
                  />
                  <KindGrid
                    rows={highCats}
                    tone="high"
                    activeKind={parsed.filter.kind ?? null}
                    onSelect={selectKindFilter}
                    onBulkPurge={(k) => void openBulkPurge(k)}
                  />
                </section>
              )}

              {lowCats.length > 0 && (
                <section className="mb-5">
                  <SectionHeader
                    label={t('security.severity_low', { defaultValue: 'Low · identity' })}
                    count={lowCount}
                  />
                  <KindGrid
                    rows={lowCats}
                    tone="default"
                    activeKind={parsed.filter.kind ?? null}
                    onSelect={selectKindFilter}
                    onBulkPurge={(k) => void openBulkPurge(k)}
                  />
                </section>
              )}

              {parsed.filter.kind && (
                <div className="flex items-center gap-2 mb-3 pt-1">
                  <span className="text-[11px] font-semibold leading-[14px] text-warm-muted dark:text-dark-muted">
                    {t('security.filter_label', { defaultValue: 'Filter' })}
                  </span>
                  <FilterPill onClear={clearKindFilter}>kind:{parsed.filter.kind}</FilterPill>
                  <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
                    {t('security.filter_count', {
                      count: risk.find(r => r.kind === parsed.filter.kind)?.count ?? 0,
                      defaultValue: 'showing {{count}} findings',
                    })}
                  </span>
                </div>
              )}

              <section className="mb-5">
                <SectionHeader
                  label={t('security.sessions_with_findings', { defaultValue: 'Sessions with active findings' })}
                  count={sessions.length}
                />
                {sessions.length === 0 ? (
                  <p className="font-mono text-[11px] text-warm-faint dark:text-dark-muted py-2">
                    {t('security.empty_sessions', { defaultValue: 'No sessions match this filter.' })}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {sessions.map(s => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        activeKindFilter={parsed.filter.kind ?? null}
                        valuesHidden={valuesHidden}
                        onOpen={() => onOpenSession(s.sessionUuid)}
                        onRefresh={refresh}
                      />
                    ))}
                  </div>
                )}
              </section>

              {infoCats.length > 0 && (
                <InfoDrawer
                  expanded={showInfo}
                  onToggle={() => setShowInfo(v => !v)}
                  rows={infoCats}
                  total={infoCount}
                />
              )}
            </>
          )}
        </div>
      </div>

      <PurgeConfirmDialog
        open={bulkPurgeKind !== null}
        count={bulkPurgeKind ? (risk.find((c) => c.kind === bulkPurgeKind)?.count ?? 0) : 0}
        kind={bulkPurgeKind ?? ''}
        bulk
        bulkSamples={bulkPurgeSamples}
        onConfirm={() => { void confirmBulkPurgeKind() }}
        onCancel={() => { setBulkPurgeKind(null); setBulkPurgeSamples([]) }}
      />
    </div>
  )
}

function ScanBanner({ status, backfillStart }: { status: ScanStatus; backfillStart: number | null }) {
  const { t } = useTranslation()
  const inFlight = status.backfillRemaining + (status.scanning !== null ? 1 : 0)
  const total = backfillStart ?? inFlight
  const done = Math.max(0, total - inFlight)
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  return (
    <div
      data-testid="security-scan-banner"
      className="grid items-center gap-3 mb-5 px-4 py-2.5 rounded-lg bg-accent-bg dark:bg-accent-bg-dark border border-accent-bg-strong dark:border-accent-bg-strong-dark"
      style={{ gridTemplateColumns: 'auto 1fr auto' }}
    >
      <span className="relative inline-flex items-center justify-center w-2 h-2 rounded-full bg-accent dark:bg-accent-dark">
        <span className="absolute inset-[-3px] rounded-full bg-accent dark:bg-accent-dark opacity-20 animate-ping" />
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold leading-[14px] text-accent dark:text-accent-dark">
            {t('security.scanning', { defaultValue: 'Scanning' })}
          </span>
          <span className="font-mono text-[11px] text-accent dark:text-accent-dark tabular-nums">
            {t('security.scanning_progress', {
              done, total,
              defaultValue: '{{done}} / {{total}} sessions',
            })}
          </span>
          <span className="font-mono text-[11px] text-warm-muted dark:text-dark-muted tabular-nums">
            {status.currentProfile}
          </span>
        </div>
        <div
          className="relative h-1 rounded-full overflow-hidden"
          style={{ background: 'rgba(200,90,0,0.12)' }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-accent dark:bg-accent-dark rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label, count, leading }: { label: string; count: number; leading?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {leading}
      <span className="text-[11px] font-semibold leading-[14px] text-warm-muted dark:text-dark-muted">
        {label}
      </span>
      <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums ml-1">
        {count}
      </span>
    </div>
  )
}

function KindGrid({
  rows,
  tone,
  activeKind,
  onSelect,
  onBulkPurge,
}: {
  rows: RiskByCategoryRow[]
  tone: 'high' | 'default' | 'info'
  activeKind: string | null
  onSelect: (kind: string) => void
  onBulkPurge: (kind: string) => void
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
    >
      {rows.map(r => (
        <KindTile
          key={r.kind}
          kind={r.kind}
          count={r.count}
          sessions={r.sessions}
          tone={tone}
          active={activeKind === r.kind}
          onSelect={() => onSelect(r.kind)}
          onBulkPurge={() => onBulkPurge(r.kind)}
        />
      ))}
    </div>
  )
}

function KindTile({
  kind,
  count,
  sessions,
  tone,
  active,
  onSelect,
  onBulkPurge,
}: {
  kind: string
  count: number
  sessions: number
  tone: 'high' | 'default' | 'info'
  active: boolean
  onSelect: () => void
  onBulkPurge: () => void
}) {
  const toneClasses =
    tone === 'high'
      ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent-bg-strong dark:border-accent-bg-strong-dark hover:border-accent dark:hover:border-accent-dark'
      : tone === 'info'
        ? 'bg-transparent border-warm-border2 dark:border-dark-border2 border-dashed opacity-90'
        : 'bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2 hover:bg-warm-surface2 dark:hover:bg-dark-surface2'

  const activeClasses = active ? 'border-accent ring-1 ring-accent dark:border-accent-dark dark:ring-accent-dark' : ''
  const countColor = tone === 'high' ? 'text-accent dark:text-accent-dark' : 'text-warm-text dark:text-dark-text'

  return (
    <div
      data-testid="risk-category-chip"
      data-kind={kind}
      data-severity={tone}
      className={`group relative flex flex-col justify-between min-w-[132px] h-14 px-3 py-2 rounded-lg border ${toneClasses} ${activeClasses} transition-colors cursor-pointer`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
    >
      <span className="font-mono text-[12px] text-warm-text dark:text-dark-text truncate">
        {kind}
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className={`font-mono tabular-nums text-[18px] leading-none font-medium tracking-[-0.01em] ${countColor}`}>
          {count}
        </span>
        <span className="font-mono text-[10px] text-warm-muted dark:text-dark-muted tabular-nums whitespace-nowrap">
          {sessions} {sessions === 1 ? 'session' : 'sessions'}
        </span>
      </span>
      <button
        type="button"
        data-testid="risk-bulk-purge"
        title={`Purge all ${kind}`}
        aria-label={`Purge all ${kind}`}
        onClick={(e) => { e.stopPropagation(); onBulkPurge() }}
        className="absolute top-1.5 right-1.5 w-[18px] h-[18px] rounded inline-flex items-center justify-center text-warm-faint dark:text-dark-muted opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 hover:text-accent dark:hover:text-accent-dark transition-opacity"
      >
        <Trash2 size={12} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  )
}

function FilterPill({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span
      data-testid="security-filter-pill"
      className="inline-flex items-center gap-1.5 h-[22px] pl-2 pr-1.5 rounded bg-accent-bg dark:bg-accent-bg-dark border border-accent-bg-strong dark:border-accent-bg-strong-dark font-mono text-[11px] text-accent dark:text-accent-dark"
    >
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear filter"
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded text-accent dark:text-accent-dark hover:bg-accent/10"
      >
        <X size={10} strokeWidth={2} aria-hidden />
      </button>
    </span>
  )
}

function SessionCard({
  session,
  activeKindFilter,
  valuesHidden,
  onOpen,
  onRefresh,
}: {
  session: Sess
  activeKindFilter: string | null
  valuesHidden: boolean
  onOpen: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [findings, setFindings] = useState<FindingRow[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const LIMIT = 3

  const load = useCallback(async () => {
    const f: Parameters<typeof securityApi.listFindings>[0] = { sessionId: session.id, state: 'active' }
    if (activeKindFilter) f.kind = activeKindFilter as typeof f.kind
    const rows = await securityApi.listFindings(f)
    setFindings(rows)
  }, [session.id, activeKindFilter])

  useEffect(() => { void load() }, [load])

  if (findings === null) {
    return (
      <article className="py-3 border-b border-warm-border dark:border-dark-border last:border-b-0" />
    )
  }

  const visible = showAll ? findings : findings.slice(0, LIMIT)
  const hidden = findings.length - visible.length
  const high = findings.filter(f => f.state === 'active' && isHigh(f.kind)).length
  const low = findings.filter(f => f.state === 'active' && !isHigh(f.kind)).length
  const title = session.title?.trim() || t('common.noTitle')

  // Match SessionRow's meta format exactly: relative date · N msgs · model
  const looseT = t as unknown as (k: string, o?: Record<string, unknown>) => string
  const dateStr = formatRelativeDate(session.startedAt, { t: looseT })
  const msgsStr = t('session.msgs_other', { count: session.messageCount })
  const modelStr = compactModel(session.model)

  return (
    <article
      data-testid="security-session-row"
      data-session-uuid={session.sessionUuid}
      className="py-3 border-b border-warm-border dark:border-dark-border last:border-b-0"
    >
      <header
        className="group flex items-center gap-2 px-1 cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      >
        <SourceBadge source={session.source} />
        <span className="flex-1 min-w-0 text-[13px] font-medium text-warm-text dark:text-dark-text truncate group-hover:text-accent dark:group-hover:text-accent-dark transition-colors">
          {title}
        </span>
        <span className="flex items-center gap-2 ml-auto">
          {high > 0 && (
            <span className="inline-flex items-center gap-[3px] font-mono tabular-nums text-[11px] text-accent dark:text-accent-dark">
              <AlertTriangle size={12} strokeWidth={1.7} aria-hidden />
              {high}
            </span>
          )}
          {low > 0 && (
            <span className="inline-flex items-center gap-[3px] font-mono tabular-nums text-[11px] text-warm-muted dark:text-dark-muted">
              <span className="w-1 h-1 rounded-full bg-warm-muted dark:bg-dark-muted" />
              {low}
            </span>
          )}
        </span>
      </header>
      <p className="mt-0.5 mx-1 pl-1 font-mono text-[11px] tabular-nums text-warm-faint dark:text-dark-muted truncate">
        {dateStr} · {msgsStr}{modelStr ? ` · ${modelStr}` : ''}
      </p>
      {visible.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-px">
          {visible.map((f) => (
            <FindingItem
              key={f.id}
              finding={f}
              valuesHidden={valuesHidden}
              onChange={() => { void load(); onRefresh() }}
            />
          ))}
          {hidden > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="self-start ml-6 mt-0.5 h-[22px] px-2 rounded bg-transparent font-mono text-[11px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              {t('security.show_more', { count: hidden, defaultValue: 'show {{count}} more' })}
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/** Drops the long `claude-sonnet-4-5-20251022` form to `sonnet 4.5`.
 *  Mirrors SessionRow's helper. */
function compactModel(model: string | null | undefined): string {
  if (!model) return ''
  const m = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?$/)
  if (!m) return model
  const name = m[1]!
  const major = m[2]
  const minor = m[3]
  if (minor) return `${name} ${major}.${minor}`
  if (major) return `${name} ${major}`
  return name
}

function FindingItem({
  finding,
  valuesHidden,
  onChange,
}: {
  finding: FindingRow
  /** Global hide toggle (screen-share mode). When true, blur every value
   *  until the user hover-reveals it. When false (default), values render
   *  in clear — the user is here to review them. */
  valuesHidden: boolean
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(null)
  // Per-row reveal override — only meaningful when valuesHidden is true.
  const [localReveal, setLocalReveal] = useState(false)
  const [purgePending, setPurgePending] = useState(false)

  useEffect(() => {
    securityApi.getFindingValue(finding.id).then(setValue).catch(() => setValue(null))
  }, [finding.id])

  // Reset local reveal whenever the global toggle flips back on.
  useEffect(() => { if (valuesHidden) setLocalReveal(false) }, [valuesHidden])

  const revealed = !valuesHidden || localReveal

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
  const isPurged = finding.state === 'purged'
  const high = isHigh(finding.kind)
  const bulletClass = isPurged
    ? 'bg-warm-faint dark:bg-dark-faint'
    : high
      ? 'bg-accent dark:bg-accent-dark'
      : 'bg-warm-muted dark:bg-dark-muted'

  const valueClass = isPurged
    ? 'line-through text-warm-faint dark:text-dark-faint'
    : revealed
      ? 'text-warm-text dark:text-dark-text'
      : 'text-warm-text dark:text-dark-text blur-[3.5px] cursor-pointer select-none'

  const displayValue = isPurged
    ? `[redacted: ${friendlyKind(finding.kind)}]`
    : value === null
      ? t('security.value_unavailable', { defaultValue: '(value unavailable)' })
      : value

  return (
    <div
      data-testid="finding-row"
      data-finding-id={finding.id}
      data-kind={finding.kind}
      data-state={finding.state}
      className="group grid items-center gap-3 pl-6 pr-2 py-1 rounded font-mono text-[11px] hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
      style={{ gridTemplateColumns: '14px 110px 1fr auto', opacity: finding.state === 'dismissed' ? 0.5 : 1 }}
    >
      <span className={`justify-self-center w-1 h-1 rounded-full ${bulletClass}`} />
      <span className="text-warm-muted dark:text-dark-muted truncate">{finding.kind}</span>
      <span
        className={`truncate transition-[filter] duration-100 ${valueClass}`}
        onMouseEnter={() => valuesHidden && !isPurged && setLocalReveal(true)}
        onClick={() => valuesHidden && !isPurged && setLocalReveal(true)}
      >
        {displayValue}
      </span>
      {isActive ? (
        <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            data-testid="dismiss-in-session"
            onClick={() => { void dismiss('session') }}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_session', { defaultValue: 'Dismiss in this session' })}
          >
            {t('security.dismiss', { defaultValue: 'Dismiss' })}
          </button>
          <button
            type="button"
            data-testid="dismiss-everywhere"
            onClick={() => { void dismiss('global') }}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_global', { defaultValue: 'Dismiss everywhere' })}
          >
            {t('security.everywhere', { defaultValue: 'Everywhere' })}
          </button>
          <button
            type="button"
            data-testid="purge-button"
            onClick={() => setPurgePending(true)}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-accent dark:hover:text-accent-dark inline-flex items-center gap-1 transition-colors"
            title={t('security.purge', { defaultValue: 'Purge from local archive' })}
          >
            <Trash2 size={10} strokeWidth={1.7} aria-hidden />
            {t('security.purge', { defaultValue: 'Purge' })}
          </button>
          <PurgeConfirmDialog
            open={purgePending}
            count={1}
            kind={finding.kind}
            {...(value !== null ? { before: value } : {})}
            onConfirm={() => { void purge() }}
            onCancel={() => setPurgePending(false)}
          />
        </span>
      ) : (
        <span className="font-sans text-[10px] uppercase tracking-[0.08em] font-semibold text-warm-faint dark:text-dark-muted">
          {finding.state}
        </span>
      )}
    </div>
  )
}

function InfoDrawer({
  expanded,
  onToggle,
  rows,
  total,
}: {
  expanded: boolean
  onToggle: () => void
  rows: RiskByCategoryRow[]
  total: number
}) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="security-info-drawer"
      className="mt-5 rounded-lg border border-dashed border-warm-border2 dark:border-dark-border2"
    >
      <button
        type="button"
        data-testid="security-toggle-info"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg hover:bg-black/[0.015] dark:hover:bg-white/[0.015] transition-colors"
      >
        <span className="text-warm-faint dark:text-dark-muted inline-flex">
          <Info size={14} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="inline-flex items-center gap-2">
            <span className="text-[13px] font-medium text-warm-text dark:text-dark-text">
              {t('security.info_title', { defaultValue: 'Informational signals' })}
            </span>
            <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
              {t('security.info_suppressed', { count: total, defaultValue: '{{count}} suppressed' })}
            </span>
          </span>
          <span className="font-mono text-[11px] text-warm-muted dark:text-dark-muted">
            {t('security.info_summary', { defaultValue: 'absolute-path · ip · internal-host · audit showed ~98% false-positive rate' })}
          </span>
        </span>
        <Segmented value={expanded ? 'shown' : 'hidden'} />
      </button>
      {expanded && (
        <div className="px-4 pt-3 pb-4 border-t border-dashed border-warm-border2 dark:border-dark-border2">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
          >
            {rows.map(r => (
              <KindTile
                key={r.kind}
                kind={r.kind}
                count={r.count}
                sessions={r.sessions}
                tone="info"
                active={false}
                onSelect={() => {}}
                onBulkPurge={() => {}}
              />
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-warm-muted dark:text-dark-muted">
            {t('security.info_footnote', {
              defaultValue: 'Signals are kept as audit records but never surfaced as standalone findings.',
            })}
          </p>
        </div>
      )}
    </section>
  )
}

function Segmented({ value }: { value: 'shown' | 'hidden' }) {
  const { t } = useTranslation()
  const options = [
    { value: 'hidden', label: t('security.info_hidden', { defaultValue: 'Hidden' }) },
    { value: 'shown', label: t('security.info_shown', { defaultValue: 'Shown' }) },
  ] as const
  return (
    <span className="inline-flex items-center gap-1.5 ml-auto">
      {options.map(opt => {
        const active = opt.value === value
        return (
          <span
            key={opt.value}
            className={`h-[22px] px-2.5 rounded-md text-[12px] inline-flex items-center transition-colors ${
              active
                ? 'bg-accent-bg dark:bg-accent-bg-dark border border-accent dark:border-accent-dark text-accent dark:text-accent-dark font-semibold'
                : 'border border-transparent text-warm-muted dark:text-dark-muted font-medium'
            }`}
          >
            {opt.label}
          </span>
        )
      })}
    </span>
  )
}

function EmptyState({
  onRescan,
  lastScan,
  currentProfile,
}: {
  onRescan: () => void
  lastScan: string | null
  currentProfile: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-4 max-w-[560px] pt-4">
      <span className="flex-none w-9 h-9 rounded-lg bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border inline-flex items-center justify-center text-warm-muted dark:text-dark-muted mt-0.5">
        <ShieldAlert size={18} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex flex-col gap-2.5 flex-1 min-w-0">
        <h2 className="text-[15px] font-semibold text-warm-text dark:text-dark-text leading-5 tracking-[-0.005em]">
          {t('security.empty_title', { defaultValue: 'Nothing to review.' })}
        </h2>
        <p className="text-[13px] text-warm-muted dark:text-dark-muted leading-[18px] max-w-[480px]">
          {t('security.empty_body', {
            defaultValue: "We scanned your sessions and found nothing high-risk. Spool re-scans whenever new sessions sync.",
          })}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <button
            type="button"
            onClick={onRescan}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border text-[12px] font-medium text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:border-warm-border2 dark:hover:border-dark-border2 transition-colors"
          >
            <RotateCw size={12} strokeWidth={1.6} aria-hidden />
            {t('security.rescanAll', { defaultValue: 'Rescan all' })}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
          >
            <SettingsIcon size={12} strokeWidth={1.6} aria-hidden />
            {t('security.detector_settings', { defaultValue: 'Detector settings' })}
          </button>
        </div>

        {(lastScan || currentProfile) && (
          <div className="mt-1.5 rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3.5 py-3">
            <div className="text-[11px] font-semibold leading-[14px] text-warm-muted dark:text-dark-muted mb-1.5">
              {t('security.last_scan', { defaultValue: 'Last scan' })}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-warm-muted dark:text-dark-muted leading-[18px]">
              {lastScan && (
                <div>
                  {t('security.last_scan_when', { ago: formatScanAgo(lastScan), defaultValue: 'scanned {{ago}}' })}
                </div>
              )}
              {currentProfile && (
                <div>{currentProfile}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Format a scan_completed_at timestamp as "2m ago" / "just now". */
function formatScanAgo(iso: string): string {
  try {
    const t = new Date(iso).getTime()
    const ms = Date.now() - t
    if (!Number.isFinite(ms) || ms < 0) return 'just now'
    const s = Math.floor(ms / 1000)
    if (s < 45) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  } catch {
    return ''
  }
}

const HIGH_KINDS = new Set([
  'private-key', 'ssh-key', 'cloud-cred-ini', 'kubeconfig-token', 'netrc',
  'connection-string', 'url-creds', 'api-key', 'jwt', 'bearer',
  'basic-auth', 'env-var', 'generic-secret',
])
function isHigh(kind: string): boolean {
  return HIGH_KINDS.has(kind)
}

function friendlyKind(kind: string): string {
  const map: Record<string, string> = {
    'api-key': 'API key', 'private-key': 'private key', 'jwt': 'JWT',
    'bearer': 'bearer token', 'kubeconfig-token': 'kubeconfig token',
    'env-var': 'env var', 'url-creds': 'URL credentials',
    'connection-string': 'connection string', 'ssh-key': 'SSH key',
    'cloud-cred-ini': 'cloud creds', 'netrc': 'netrc',
    'basic-auth': 'basic auth', 'generic-secret': 'secret',
    'email': 'email', 'person-name': 'name', 'phone': 'phone',
    'street-address': 'address', 'credit-card': 'credit card',
    'ssn': 'SSN', 'date-of-birth': 'DOB',
    'absolute-path': 'absolute path', 'ip': 'IP address',
    'internal-host': 'internal host',
  }
  return map[kind] ?? kind
}
