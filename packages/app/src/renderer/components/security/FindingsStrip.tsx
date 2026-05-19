// Session-detail Findings strip — accent-tinted inline band that sits
// below the session header.
//
// Visual distinction from SessionFindBar:
//   - SessionFindBar  = body bg + thin border + search affordances.
//                       Reads as "find in page." Floats top-right via
//                       its own layer when ⌘F is invoked.
//   - Findings strip  = accent-tinted band + alert icon + summary +
//                       Review/Purge actions. Reads as "warning."
//                       Always in document flow, sole horizontal
//                       surface below the header.
//
// After everything is purged/dismissed, the strip stays as a muted
// "3 findings purged · 1 dismissed" footnote rather than disappearing
// mid-session.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import type { Session, FindingRow } from '@spool-lab/core'
import { securityFeatureEnabled } from '../../featureFlags.js'
import { securityApi } from '../../api/security.js'
import PurgeConfirmDialog from './PurgeConfirmDialog.js'

interface Props {
  session: Session
}

const HIGH_KINDS = new Set([
  'private-key', 'ssh-key', 'cloud-cred-ini', 'kubeconfig-token', 'netrc',
  'connection-string', 'url-creds', 'api-key', 'jwt', 'bearer',
  'basic-auth', 'env-var', 'generic-secret',
])
const isHigh = (k: string) => HIGH_KINDS.has(k)

export default function FindingsStrip({ session }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [findings, setFindings] = useState<FindingRow[] | null>(null)
  const [bulkPurgePending, setBulkPurgePending] = useState(false)

  const load = useCallback(async () => {
    const rows = await securityApi.listFindings({ sessionId: session.id, state: 'any' })
    setFindings(rows)
  }, [session.id])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const off = securityApi.onChange((c) => {
      if (c.sessionId === session.id) void load()
    })
    return () => { off() }
  }, [session.id, load])

  if (!securityFeatureEnabled()) return null
  if (findings === null) return null

  const active = findings.filter(f => f.state === 'active')
  const high = active.filter(f => isHigh(f.kind)).length
  const low = active.length - high
  const purged = findings.filter(f => f.state === 'purged').length
  const dismissed = findings.filter(f => f.state === 'dismissed').length

  if (active.length === 0) {
    if (purged === 0 && dismissed === 0) return null
    return <ResolvedStrip purged={purged} dismissed={dismissed} />
  }

  async function bulkPurge() {
    const activeIds = active.map(f => f.id)
    await securityApi.purgeFindings(activeIds)
    setBulkPurgePending(false)
    void load()
  }

  return (
    <div
      data-testid="findings-strip"
      className="px-5 py-2 bg-accent-bg dark:bg-accent-bg-dark border-y border-warm-border dark:border-dark-border"
    >
      <div className="flex items-center gap-2.5">
        <AlertTriangle
          size={16}
          strokeWidth={1.7}
          className="flex-none text-accent dark:text-accent-dark"
          aria-hidden
        />
        <span className="text-[13px] text-warm-text dark:text-dark-text">
          {high > 0 && (
            <strong className="font-semibold text-accent dark:text-accent-dark">
              {t('security.strip_high', { count: high, defaultValue: '{{count}} high-risk' })}
            </strong>
          )}
          {high > 0 && low > 0 && (
            <span className="text-warm-muted dark:text-dark-muted"> · </span>
          )}
          {low > 0 && (
            <span className="text-warm-muted dark:text-dark-muted">
              {t('security.strip_low', { count: low, defaultValue: '{{count}} low' })}
            </span>
          )}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <button
            type="button"
            data-testid="strip-purge-all"
            onClick={() => setBulkPurgePending(true)}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md font-sans text-[12px] font-medium text-warm-muted dark:text-dark-muted border border-transparent hover:text-accent dark:hover:text-accent-dark hover:bg-warm-text/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          >
            <Trash2 size={13} strokeWidth={1.6} aria-hidden />
            {t('security.strip_purge_all', { defaultValue: 'Purge all' })}
          </button>
          <button
            type="button"
            data-testid="strip-review-toggle"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md font-sans text-[12px] font-semibold bg-warm-bg dark:bg-dark-bg border border-accent dark:border-accent-dark text-accent dark:text-accent-dark hover:bg-accent dark:hover:bg-accent-dark hover:text-white dark:hover:text-white transition-colors"
          >
            {expanded
              ? t('security.strip_hide', { defaultValue: 'Hide' })
              : t('security.strip_review', { defaultValue: 'Review' })}
            <span className="ml-0.5 opacity-80">
              {expanded ? <ChevronUp size={13} strokeWidth={1.7} aria-hidden /> : <ChevronDown size={13} strokeWidth={1.7} aria-hidden />}
            </span>
          </button>
        </span>
      </div>

      {expanded && (
        <div className="mt-2.5 pt-2 border-t border-accent-bg-strong dark:border-accent-bg-strong-dark flex flex-col gap-px">
          {findings.map((f, i) => (
            <StripFindingItem
              key={f.id}
              finding={f}
              defaultRevealed={i === 0 && f.state === 'active' && isHigh(f.kind)}
              onChange={load}
            />
          ))}
        </div>
      )}

      <PurgeConfirmDialog
        open={bulkPurgePending}
        count={active.length}
        kind={active[0]?.kind ?? ''}
        bulk
        onConfirm={() => { void bulkPurge() }}
        onCancel={() => setBulkPurgePending(false)}
      />
    </div>
  )
}

function ResolvedStrip({ purged, dismissed }: { purged: number; dismissed: number }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="findings-strip"
      data-resolved="true"
      className="px-5 py-2 bg-warm-surface dark:bg-dark-surface border-y border-warm-border dark:border-dark-border"
    >
      <div className="flex items-center gap-2.5">
        <span className="w-4 h-4 rounded-full bg-warm-muted dark:bg-dark-muted text-white inline-flex items-center justify-center font-mono text-[10px] font-bold">
          ✓
        </span>
        <span className="text-[13px] text-warm-muted dark:text-dark-muted">
          {purged > 0 && t('security.strip_purged', { count: purged, defaultValue: '{{count}} findings purged' })}
          {purged > 0 && dismissed > 0 && ' · '}
          {dismissed > 0 && t('security.strip_dismissed_count', { count: dismissed, defaultValue: '{{count}} dismissed' })}
        </span>
      </div>
    </div>
  )
}

function StripFindingItem({
  finding,
  defaultRevealed,
  onChange,
}: {
  finding: FindingRow
  defaultRevealed: boolean
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(defaultRevealed)
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
      data-testid="strip-finding"
      data-kind={finding.kind}
      data-state={finding.state}
      className="group grid items-center gap-3 px-2 py-1 rounded font-mono text-[11px]"
      style={{ gridTemplateColumns: '14px 110px 1fr auto', opacity: finding.state === 'dismissed' ? 0.5 : 1 }}
    >
      <span className={`justify-self-center w-1 h-1 rounded-full ${bulletClass}`} />
      <span className="text-warm-muted dark:text-dark-muted truncate">{finding.kind}</span>
      <span
        className={`truncate transition-[filter] duration-100 ${valueClass}`}
        onMouseEnter={() => !isPurged && setRevealed(true)}
        onClick={() => !isPurged && setRevealed(true)}
      >
        {displayValue}
      </span>
      {isActive ? (
        <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => { void dismiss('session') }}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-text/[0.04] dark:hover:bg-white/[0.04] hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_session', { defaultValue: 'Dismiss in this session' })}
          >
            {t('security.dismiss', { defaultValue: 'Dismiss' })}
          </button>
          <button
            type="button"
            onClick={() => { void dismiss('global') }}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-text/[0.04] dark:hover:bg-white/[0.04] hover:text-warm-text dark:hover:text-dark-text transition-colors"
            title={t('security.dismiss_global', { defaultValue: 'Dismiss everywhere' })}
          >
            {t('security.everywhere', { defaultValue: 'Everywhere' })}
          </button>
          <button
            type="button"
            onClick={() => setPurgePending(true)}
            className="h-5 px-1.5 rounded font-sans text-[11px] font-medium text-warm-muted dark:text-dark-muted hover:bg-warm-text/[0.04] dark:hover:bg-white/[0.04] hover:text-accent dark:hover:text-accent-dark inline-flex items-center gap-1 transition-colors"
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
  }
  return map[kind] ?? kind
}
