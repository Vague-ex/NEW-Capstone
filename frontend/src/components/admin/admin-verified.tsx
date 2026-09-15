import { useEffect, useMemo, useState, Fragment } from 'react';
import { useSearchParams } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import type { AlumniRecord } from '../../data/app-data';
import {
  fetchRetrackingHistory,
  fetchVerifiedAlumni,
  sendRetrackingReminder,
  type RetrackingEventKind,
  type RetrackingHistory,
  type RetrackingHistoryEvent,
} from '../../app/api-client';
import { useReferenceData } from '../../hooks/useReferenceData';
import {
  Search, CheckCircle2, Users, Briefcase, Star, MapPin,
  ChevronDown, ChevronUp, Camera, X, ChevronLeft, ChevronRight,
  Clock, Building2, Globe, Award, Maximize2, RefreshCw, Send, AlertTriangle,
  History, UserPlus, Mail, ShieldCheck, ShieldX, ArrowRight,
} from 'lucide-react';
import { ImageLightbox, type LightboxImage } from '../shared/image-lightbox';

type ModalTab = 'profile' | 'employment' | 'skills' | 'history';

const PAGE_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveTimeToHire(a: AlumniRecord): string {
  const sd = (a as Record<string, unknown>).surveyData as Record<string, unknown> | undefined;
  if (sd?.timeToHire) return String(sd.timeToHire);
  if (!a.monthsToHire) return '-';
  const m = a.monthsToHire;
  if (m <= 1) return 'Within 1 month';
  if (m <= 3) return '1–3 months';
  if (m <= 6) return '3–6 months';
  if (m <= 12) return '6 months to 1 year';
  return 'After 1 year';
}

function deriveLocationLabel(a: AlumniRecord): string {
  const sd = (a as Record<string, unknown>).surveyData as Record<string, unknown> | undefined;
  if (sd?.currentJobLocation) return String(sd.currentJobLocation);
  const loc = (a.workLocation || '').toLowerCase();
  if (loc.includes('abroad') || loc.includes('singapore') || loc.includes('dubai') ||
    loc.includes('ofw') || loc.includes('foreign')) return 'Abroad / Remote Foreign Employer';
  return 'Local (Philippines)';
}

function safeName(a: AlumniRecord): string {
  return a.name ?? 'Unnamed Graduate';
}

function safeInitials(a: AlumniRecord): string {
  return safeName(a)
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .slice(0, 2);
}

type FaceScans = { front?: string; left?: string; right?: string };
function getFaceScans(a: AlumniRecord): FaceScans {
  const scansRaw = (a as Record<string, unknown>).registrationFaceScans;
  const scans = scansRaw && typeof scansRaw === 'object' ? (scansRaw as Record<string, unknown>) : {};
  return {
    front: (scans.front ?? scans.face_front ?? (a as Record<string, unknown>).facePhotoUrl) as string | undefined,
    left: (scans.left ?? scans.face_left) as string | undefined,
    right: (scans.right ?? scans.face_right) as string | undefined,
  };
}

/** One enrolment-sweep frame, as returned by the admin payload. */
type PoseScan = { key: string; url: string; target: number | null; yaw: number | null };

function getPoseScans(a: AlumniRecord): PoseScan[] {
  const raw = (a as Record<string, unknown>).registrationPoseScans;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is PoseScan => !!p && typeof p === 'object' && typeof (p as PoseScan).url === 'string')
    // Graduate's left (positive yaw) first, matching the registration screen.
    .sort((p, q) => (q.target ?? 0) - (p.target ?? 0));
}

function getCaptureSummary(a: AlumniRecord): { engine?: string | null; frames?: number | null; samples?: number | null } {
  const raw = (a as Record<string, unknown>).captureSummary;
  return raw && typeof raw === 'object' ? (raw as Record<string, number | string | null>) : {};
}

const POSE_LABELS: Record<number, string> = {
  24: 'Left', 12: 'Slight left', 0: 'Front', [-12]: 'Slight right', [-24]: 'Right',
};

function poseLabel(pose: PoseScan): string {
  return pose.target !== null ? POSE_LABELS[pose.target] ?? `${pose.target}°` : pose.key;
}

/** Every face image in viewing order, for the full-screen viewer. */
function faceImages(a: AlumniRecord): LightboxImage[] {
  const scans = getFaceScans(a);
  const out: LightboxImage[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined, label: string) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push({ url, label });
    }
  };
  add(scans.front, 'Front photo');
  add(scans.left, 'Left');
  add(scans.right, 'Right');
  for (const pose of getPoseScans(a)) add(pose.url, `Sweep · ${poseLabel(pose)}`);
  return out;
}

/** "2 yrs 3 mos" from a day count — how long ago a record was confirmed. */
function formatDuration(days: number): string {
  const totalMonths = Math.floor(days / 30.44);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} yr${years !== 1 ? 's' : ''}`);
  if (months) parts.push(`${months} mo${months !== 1 ? 's' : ''}`);
  return parts.length ? parts.join(' ') : `${days} day${days !== 1 ? 's' : ''}`;
}

function needsRetracing(a: AlumniRecord): boolean {
  return a.requiresRetracking === true;
}

function RetraceBadge({ a }: { a: AlumniRecord }) {
  if (!needsRetracing(a)) return null;
  const since = typeof a.daysSinceRetrace === 'number' ? formatDuration(a.daysSinceRetrace) : null;
  return (
    <span
      title={a.lastRetracedAt ? `Employment record last confirmed ${a.lastRetracedAt}` : undefined}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100 whitespace-nowrap"
      style={{ fontWeight: 600 }}
    >
      <RefreshCw className="size-3" />
      Needs retracing{since ? ` · ${since}` : ''}
    </span>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-gray-400 text-xs shrink-0 w-28 sm:w-40 pt-0.5">{label}</span>
      {/* min-w-0 + anywhere: a long email has no spaces to break at and
          pushed the sheet sideways on phones. */}
      <span className={`text-xs flex-1 min-w-0 [overflow-wrap:anywhere] ${value && value !== '-' ? 'text-gray-700' : 'text-gray-300 italic'}`}
        style={{ fontWeight: value && value !== '-' ? 500 : 400 }}>
        {value && value !== '-' ? value : 'Not provided'}
      </span>
    </div>
  );
}

// ── Retracking History ────────────────────────────────────────────────────────

type HistoryFilter = 'all' | 'confirmations' | 'reminders' | 'employer';

const HISTORY_FILTERS: { key: HistoryFilter; label: string; match: (kind: RetrackingEventKind) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'confirmations', label: 'Confirmations', match: (k) => k === 'registered' || k === 'retraced' },
  { key: 'reminders', label: 'Reminders', match: (k) => k === 'reminder' },
  { key: 'employer', label: 'Employer', match: (k) => k === 'employer_confirmed' || k === 'employer_denied' },
];

const CHANGE_LABELS: Record<string, string> = {
  employment_status: 'Status',
  job_title: 'Job title',
  company: 'Company',
};

function eventLook(kind: RetrackingEventKind): { title: string; icon: React.ElementType; dot: string } {
  switch (kind) {
    case 'registered':
      return { title: 'Registered', icon: UserPlus, dot: 'bg-gray-100 text-gray-600 ring-gray-200' };
    case 'retraced':
      return { title: 'Employment record confirmed', icon: RefreshCw, dot: 'bg-emerald-50 text-emerald-700 ring-emerald-100' };
    case 'reminder':
      return { title: 'Reminder email sent', icon: Mail, dot: 'bg-amber-50 text-amber-700 ring-amber-100' };
    case 'employer_confirmed':
      return { title: 'Employer confirmed employment', icon: ShieldCheck, dot: 'bg-emerald-50 text-emerald-700 ring-emerald-100' };
    default:
      return { title: 'Employer denied employment', icon: ShieldX, dot: 'bg-red-50 text-red-700 ring-red-100' };
  }
}

function HistoryEntry({ e, last }: { e: RetrackingHistoryEvent; last: boolean }) {
  const look = eventLook(e.kind);
  const when = new Date(e.occurredAt);
  const job = [e.jobTitle, e.company].filter(Boolean).join(' at ');
  const snapshot = [e.employmentStatus, job].filter(Boolean).join(' · ');

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Rail connecting the dots; stops at the last entry. */}
      {!last && <span aria-hidden className="absolute left-4 top-9 bottom-0 w-px -translate-x-1/2 bg-gray-200" />}
      <span className={`relative flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${look.dot}`}>
        <look.icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1 rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="text-sm text-gray-900" style={{ fontWeight: 600 }}>{look.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {e.kind === 'retraced' && e.overdueDays != null && e.overdueDays > 0 && (
              <span className="rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[11px] text-red-700" style={{ fontWeight: 600 }}>
                {formatDuration(e.overdueDays)} overdue
              </span>
            )}
            {e.kind === 'retraced' && e.overdueDays === 0 && (
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700" style={{ fontWeight: 600 }}>
                On time
              </span>
            )}
            {e.flagged && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800" style={{ fontWeight: 600 }}>
                Flagged for review
              </span>
            )}
          </div>
        </div>
        <time dateTime={e.occurredAt} className="mt-0.5 block text-[11px] text-gray-500">
          {when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}
          {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </time>

        <div className="mt-1.5 space-y-1 text-xs text-gray-700 [overflow-wrap:anywhere]">
          {(e.kind === 'registered' || e.kind === 'retraced') && !e.backfilled && (
            <p>{snapshot || 'No job on record'}</p>
          )}

          {e.kind === 'retraced' && !e.backfilled && (
            e.changes.length > 0 ? (
              <ul className="space-y-1 pt-0.5">
                {e.changes.map((c) => (
                  <li key={c.field} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="text-gray-500">{CHANGE_LABELS[c.field] ?? c.field}:</span>
                    <span className="text-gray-400 line-through">{c.from || 'none'}</span>
                    <ArrowRight className="size-3 shrink-0 text-gray-400" aria-label="changed to" />
                    <span className="text-gray-900" style={{ fontWeight: 600 }}>{c.to || 'none'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">No change to status, job title or company.</p>
            )
          )}

          {e.kind === 'retraced' && e.daysSincePrevious != null && (
            <p className="text-gray-500">{formatDuration(e.daysSincePrevious)} after the previous confirmation.</p>
          )}

          {e.kind === 'reminder' && (
            <p className="text-gray-500">
              {e.sentBy === 'auto' ? 'Sent automatically' : e.sentBy ? `Sent by ${e.sentBy}` : 'Sender not recorded'}
            </p>
          )}

          {(e.kind === 'employer_confirmed' || e.kind === 'employer_denied') && (
            <>
              {job && <p>{job}</p>}
              {e.verifier && <p className="text-gray-500">By {e.verifier}</p>}
            </>
          )}

          {e.backfilled && (
            <p className="italic text-gray-400">From saved dates. Details were not recorded before history tracking started.</p>
          )}
        </div>
      </div>
    </li>
  );
}

function RetrackingHistoryTab({ alumniId, version }: { alumniId: string; version: number }) {
  const [data, setData] = useState<RetrackingHistory | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<HistoryFilter>('all');

  useEffect(() => {
    let active = true;
    setError('');
    fetchRetrackingHistory(alumniId)
      .then((res) => { if (active) setData(res); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load the history.'); });
    return () => { active = false; };
  }, [alumniId, version, attempt]);

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center">
        <p className="text-sm text-red-800">{error}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="mt-3 inline-flex min-h-11 sm:min-h-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-700 hover:bg-red-100 transition"
          style={{ fontWeight: 600 }}
        >
          <RefreshCw className="size-3.5" /> Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading history">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="size-8 rounded-full bg-gray-100 animate-pulse" />
            <div className="h-16 flex-1 rounded-xl bg-gray-100 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const { summary } = data;
  const tiles = [
    { label: 'Confirmations', value: summary.confirmations, hint: 'Employment form submitted', tone: 'text-gray-900' },
    { label: 'Confirmed late', value: summary.lateConfirmations, hint: 'After the 2-year due date', tone: summary.lateConfirmations ? 'text-red-700' : 'text-gray-900' },
    { label: 'Reminders sent', value: summary.reminders, hint: 'Automatic and by admins', tone: 'text-gray-900' },
    { label: 'Employer checks', value: summary.employerDecisions, hint: 'Confirmed or denied', tone: 'text-gray-900' },
  ];

  const active = HISTORY_FILTERS.find((f) => f.key === filter) ?? HISTORY_FILTERS[0];
  const shown = data.events.filter((e) => active.match(e.kind));
  const byYear = shown.reduce<{ year: number; items: RetrackingHistoryEvent[] }[]>((groups, e) => {
    const year = new Date(e.occurredAt).getFullYear();
    const group = groups[groups.length - 1];
    if (group && group.year === year) group.items.push(e);
    else groups.push({ year, items: [e] });
    return groups;
  }, []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3">
            <p className="text-[11px] text-gray-500">{t.label}</p>
            <p className={`text-xl leading-tight ${t.tone}`} style={{ fontWeight: 700 }}>{t.value}</p>
            <p className="hidden sm:block text-[11px] text-gray-400">{t.hint}</p>
          </div>
        ))}
      </div>

      {/* Filter chips scroll sideways on narrow phones instead of wrapping into a block. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Filter history">
        {HISTORY_FILTERS.map((f) => {
          const count = data.events.filter((e) => f.match(e.kind)).length;
          const on = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.key)}
              className={`inline-flex shrink-0 min-h-10 sm:min-h-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${on
                ? 'border-[#166534] bg-[#166534] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
              style={{ fontWeight: 600 }}
            >
              {f.label}
              <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <History className="mx-auto size-6 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            {data.events.length === 0 ? 'No history recorded for this graduate yet.' : 'Nothing in this category yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {byYear.map((group) => (
            <section key={group.year}>
              <h4 className="mb-2 text-xs text-[#166534]" style={{ fontWeight: 700 }}>{group.year}</h4>
              <ol>
                {group.items.map((e, i) => (
                  <HistoryEntry key={e.id} e={e} last={i === group.items.length - 1} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function GraduateDetailModal({ a, onClose, bsisCore, onReminderSent }: {
  a: AlumniRecord;
  onClose: () => void;
  bsisCore: string[];
  onReminderSent: (alumniId: string, sentAt: string) => void;
}) {
  const [tab, setTab] = useState<ModalTab>('profile');
  const [reminder, setReminder] = useState<{ state: 'idle' | 'sending' | 'sent' | 'error'; message?: string }>({ state: 'idle' });
  // Bumped after a reminder goes out so the History tab reloads with it.
  const [historyVersion, setHistoryVersion] = useState(0);

  const handleSendReminder = async () => {
    if (!a.id) return;
    setReminder({ state: 'sending' });
    try {
      const res = await sendRetrackingReminder(String(a.id));
      setReminder({ state: 'sent', message: res.message ?? 'Reminder sent.' });
      setHistoryVersion((v) => v + 1);
      onReminderSent(String(a.id), res.sentAt ?? new Date().toISOString());
    } catch (err) {
      setReminder({ state: 'error', message: err instanceof Error ? err.message : 'Could not send the reminder.' });
    }
  };
  const [viewer, setViewer] = useState<number | null>(null);
  const images = useMemo(() => faceImages(a), [a]);
  const sd = ((a as Record<string, unknown>).surveyData ?? {}) as Record<string, unknown>;

  const skills = a.skills ?? [];
  const coreCount = skills.filter((s: string) => bsisCore.includes(s)).length;
  const additional = skills.filter((s: string) => !bsisCore.includes(s));

  const empStatusLabel =
    a.employmentStatus === 'employed' ? 'Employed'
      : a.employmentStatus === 'self-employed' ? 'Self-Employed'
        : 'Unemployed';

  const empStatusColor =
    a.employmentStatus === 'employed' ? 'bg-emerald-50 text-emerald-700'
      : a.employmentStatus === 'self-employed' ? 'bg-[#166534]/10 text-[#166534]'
        : 'bg-gray-100 text-gray-600';

  const tabs: { key: ModalTab; label: string; icon: React.ElementType }[] = [
    { key: 'profile', label: 'Profile & Education', icon: Camera },
    { key: 'employment', label: 'Employment (CHED)', icon: Briefcase },
    { key: 'skills', label: 'Skills', icon: Star },
    { key: 'history', label: 'History', icon: History },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60">
      {viewer !== null && (
        <ImageLightbox images={images} index={viewer} onIndexChange={setViewer} onClose={() => setViewer(null)} />
      )}
      <div className="bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl xl:max-w-4xl max-h-[100dvh] sm:max-h-[90vh] rounded-t-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] shrink-0"
            style={{ fontWeight: 700, fontSize: '0.9rem' }}>
            {safeInitials(a)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-gray-900 truncate" style={{ fontWeight: 700 }}>{safeName(a)}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="text-gray-400 text-xs">Batch {a.graduationYear}</span>
              <span className="text-gray-300">·</span>
              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full ${empStatusColor}`} style={{ fontWeight: 600 }}>
                {empStatusLabel}
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700" style={{ fontWeight: 600 }}>
                <CheckCircle2 className="size-3" /> Verified
              </span>
              <RetraceBadge a={a} />
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center rounded-lg hover:bg-gray-100 transition shrink-0">
            <X className="size-5 text-gray-500" />
          </button>
        </div>

        {/* Retracing: the record is over two years old, so what the tabs show is
            the graduate's last known information, not their current situation. */}
        {needsRetracing(a) && (
          <div className="shrink-0 border-b border-red-100 bg-red-50 px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <AlertTriangle className="size-4 text-red-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-red-800 text-xs" style={{ fontWeight: 700 }}>
                  Needs retracing{typeof a.daysSinceRetrace === 'number' ? ` · outdated ${formatDuration(a.daysSinceRetrace)}` : ''}
                </p>
                <p className="text-red-700 text-[11px] leading-snug mt-0.5">
                  Employment last confirmed {a.lastRetracedAt ?? 'on an unknown date'}. The details below are the last known information.{' '}
                  {a.lastRetrackingReminderAt
                    ? `Reminder last sent ${new Date(a.lastRetrackingReminderAt).toLocaleDateString()}.`
                    : 'No reminder sent yet.'}
                </p>
                {reminder.state === 'sent' && (
                  <p className="text-emerald-700 text-[11px] mt-1" style={{ fontWeight: 600 }}>{reminder.message}</p>
                )}
                {reminder.state === 'error' && (
                  <p className="text-red-800 text-[11px] mt-1" style={{ fontWeight: 600 }}>{reminder.message}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {tab !== 'history' && (
                <button
                  type="button"
                  onClick={() => setTab('history')}
                  className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 min-h-11 sm:min-h-0 px-3 py-2 rounded-lg border border-red-200 bg-white hover:bg-red-100 text-red-700 text-xs transition"
                  style={{ fontWeight: 600 }}
                >
                  <History className="size-3.5" /> View history
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSendReminder()}
                disabled={reminder.state === 'sending'}
                className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs transition"
                style={{ fontWeight: 600 }}
              >
                <Send className="size-3.5" />
                {reminder.state === 'sending' ? 'Sending…' : reminder.state === 'sent' ? 'Send again' : 'Send reminder email'}
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        {/* Four tabs: on narrow phones the row scrolls sideways rather than
            squeezing the labels. */}
        <div role="tablist" className="flex border-b border-gray-100 shrink-0 px-2 sm:px-5 overflow-x-auto [scrollbar-width:none]">
          {tabs.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`flex flex-1 sm:flex-none shrink-0 items-center justify-center gap-1.5 min-h-11 px-2.5 sm:px-4 py-3 text-xs whitespace-nowrap border-b-2 transition -mb-px ${tab === t.key ? 'border-[#166534] text-[#166534]' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              style={{ fontWeight: tab === t.key ? 700 : 400 }}>
              <t.icon className="size-3.5" />
              <span className="sm:hidden">{t.label.split(' ')[0]}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content - scrollable */}
        <div className="overflow-y-auto flex-1 p-5">

          {/* ── Retracking history ── */}
          {tab === 'history' && a.id != null && (
            <RetrackingHistoryTab alumniId={String(a.id)} version={historyVersion} />
          )}

          {/* ── Profile & Education ── */}
          {tab === 'profile' && (
            <div className="space-y-5">
              {/* Face capture: the front photo large enough to compare, then the
                  enrolment sweep. Every image opens full screen in the page;
                  the old 80px strip cropped faces and could not be enlarged. */}
              {(() => {
                if (images.length === 0) return null;
                const faceScans = getFaceScans(a);
                const poses = getPoseScans(a);
                const summary = getCaptureSummary(a);
                const front = faceScans.front ?? faceScans.left ?? faceScans.right;
                // Legacy 3-shot registrations: left/right beside the front photo.
                const extras = (['left', 'right'] as const).filter((k) => faceScans[k] && faceScans[k] !== front);
                const open = (url?: string) => {
                  const i = images.findIndex((img) => img.url === url);
                  if (i >= 0) setViewer(i);
                };
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] gap-4">
                    {front && (
                      <button
                        type="button"
                        onClick={() => open(front)}
                        aria-label="Enlarge front photo"
                        className="block mx-auto w-full max-w-[220px] sm:max-w-none overflow-hidden rounded-2xl border border-gray-200 bg-gray-900"
                      >
                        <div className="aspect-[3/4]">
                          <img src={front} alt={`${safeName(a)} front photo`} className="h-full w-full object-cover object-center" />
                        </div>
                        <span className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-gray-200">
                          <Maximize2 className="size-3" /> Front photo · tap to enlarge
                        </span>
                      </button>
                    )}
                    <div className="min-w-0 space-y-3">
                      {extras.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 max-w-[260px]">
                          {extras.map((k) => (
                            <button key={k} type="button" onClick={() => open(faceScans[k])} aria-label={`Enlarge ${k} photo`}
                              className="overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
                              <div className="aspect-[3/4]">
                                <img src={faceScans[k]} alt={k} className="h-full w-full object-cover object-center" />
                              </div>
                              <p className="py-1 text-center text-[10px] capitalize text-gray-200">{k}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      {poses.length > 0 ? (
                        <div>
                          <p className="text-[#166534] text-xs mb-2" style={{ fontWeight: 700 }}>
                            ENROLMENT SWEEP · {poses.length} ANGLES
                          </p>
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                            {poses.map((pose) => {
                              const label = poseLabel(pose);
                              return (
                                <button key={pose.key} type="button" onClick={() => open(pose.url)} aria-label={`Enlarge ${label}`}
                                  className="overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
                                  <div className="aspect-[3/4]">
                                    <img src={pose.url} alt={`${safeName(a)} ${label}`} className="h-full w-full object-cover object-center" />
                                  </div>
                                  <p className="py-1 text-center text-[10px] leading-tight text-gray-200">
                                    {label}
                                    {pose.yaw !== null && <span className="block text-gray-400">{Math.round(pose.yaw)}°</span>}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                          {summary.frames != null && (
                            <p className="mt-1.5 text-[11px] text-gray-500">
                              {summary.frames} frames captured · {summary.samples ?? 0} used for face matching
                              {summary.engine ? ` (${summary.engine})` : ''}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">No enrolment sweep on file for this graduate.</p>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Camera className="size-3.5" /> ACCOUNT & BIOMETRIC
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Full Name" value={safeName(a)} />
                  <Row label="Email Address" value={a.email} />
                  <Row label="Graduation Batch" value={`Batch ${a.graduationYear}`} />
                  <Row label="Last Updated" value={a.dateUpdated} />
                  <Row label="Last Retraced" value={
                    a.lastRetracedAt
                      ? `${a.lastRetracedAt}${typeof a.daysSinceRetrace === 'number' ? ` (${formatDuration(a.daysSinceRetrace)} ago)` : ''}`
                      : '-'
                  } />
                  <Row label="Next Retrace Due" value={a.retrackingDueAt ?? '-'} />
                  <Row label="Face Recognition Capture" value={a.biometricCaptured ? 'Captured' : 'Not captured'} />
                  {a.biometricDate && <Row label="Capture Date" value={a.biometricDate} />}
                  {a.lat && a.lng && (
                    <Row label="GPS Coordinates" value={`${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`} />
                  )}
                  <Row label="Home Location" value={
                    [sd.city, sd.province].filter(Boolean).join(', ') || '-'
                  } />
                  <Row label="Work Location" value={
                    [a.workCity, a.workLocation].filter(Boolean).join(' · ') || '-'
                  } />
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Award className="size-3.5" /> EDUCATION (PART II)
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Degree" value="BS Information Systems" />
                  <Row label="Campus" value="CHMSU – Talisay" />
                  <Row label="Graduation Year" value={String(a.graduationYear)} />
                  <Row label="Scholarship" value={sd.scholarship ? String(sd.scholarship) : '-'} />
                  <Row label="Highest Attainment" value={sd.highestAttainment ? String(sd.highestAttainment) : '-'} />
                  <Row label="Graduate School" value="Carlos Hilado Memorial State University" />
                  <Row label="Prof. Eligibility" value={
                    Array.isArray(sd.profEligibility) && sd.profEligibility.length
                      ? (sd.profEligibility as string[]).join(', ')
                      : '-'
                  } />
                </div>
              </div>
            </div>
          )}

          {/* ── Employment (CHED Part III) ── */}
          {tab === 'employment' && (
            <div className="space-y-5">
              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Briefcase className="size-3.5" /> Q1–Q2 · EMPLOYMENT STATUS
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Q1 - Status" value={
                    a.employmentStatus === 'employed' ? 'Presently Employed'
                      : a.employmentStatus === 'self-employed' ? 'Self-Employed / Freelancer'
                        : sd.neverEmployed ? 'Never Been Employed' : 'Not Currently Employed'
                  } />
                  <Row label="Q2 - Time to Hire" value={deriveTimeToHire(a)} />
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Building2 className="size-3.5" /> Q3 · FIRST JOB
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Sector" value={sd.firstJobSector ? String(sd.firstJobSector) : '-'} />
                  <Row label="Employment Status" value={sd.firstJobStatus ? String(sd.firstJobStatus) : '-'} />
                  <Row label="Job Title" value={sd.firstJobTitle ? String(sd.firstJobTitle) : (a.jobTitle ?? '-')} />
                  <Row label="BSIS-Related" value={
                    sd.firstJobRelated === 'Yes' ? 'Yes - Related to BSIS'
                      : sd.firstJobRelated === 'No' ? 'No - Not related'
                        : a.jobAlignment === 'related' ? 'Yes - Related to BSIS'
                          : a.jobAlignment === 'not-related' ? 'No - Not related' : '-'
                  } />
                  {(sd.firstJobRelated === 'No' || a.jobAlignment === 'not-related') && (
                    <Row label="Reason (unrelated)" value={sd.firstJobUnrelatedReason ? String(sd.firstJobUnrelatedReason) : '-'} />
                  )}
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <MapPin className="size-3.5" /> Q4 · CURRENT JOB
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Sector" value={sd.currentJobSector ? String(sd.currentJobSector) : '-'} />
                  <Row label="Position" value={sd.currentJobPosition ? String(sd.currentJobPosition) : (a.jobTitle ?? '-')} />
                  <Row label="Company" value={sd.currentJobCompany ? String(sd.currentJobCompany) : (a.company ?? '-')} />
                  <Row label="Industry" value={a.industry ?? '-'} />
                  <Row label="Work Location" value={a.workLocation ?? '-'} />
                  <Row label="Location Type" value={deriveLocationLabel(a)} />
                  <Row label="BSIS-Related" value={
                    a.jobAlignment === 'related' ? 'Yes - Related to BSIS'
                      : a.jobAlignment === 'not-related' ? 'No - Not related' : '-'
                  } />
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Clock className="size-3.5" /> Q5–Q6 · JOB SOURCE & APPLICATIONS
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Q5 - Job Source" value={sd.jobSource ? String(sd.jobSource) : '-'} />
                  <Row label="Q6 - Applications Sent" value={sd.jobApplications ? String(sd.jobApplications) : '-'} />
                  {a.unemploymentReason && (
                    <Row label="Unemployment Reason" value={a.unemploymentReason} />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Skills (CHED Part IV) ── */}
          {tab === 'skills' && (
            <div className="space-y-5">
              {(() => {
                const totalCore = bsisCore.length || 12;
                return (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[#166534] text-xs flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                          <Star className="size-3.5" /> BSIS CORE COMPETENCIES
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[#166534] text-xs" style={{ fontWeight: 700 }}>{coreCount}/{totalCore}</span>
                          <div className="w-20 bg-gray-100 rounded-full h-2">
                            <div className="h-2 rounded-full bg-[#166534]" style={{ width: `${(coreCount / totalCore) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {bsisCore.map(skill => {
                          const has = skills.includes(skill);
                          return (
                            <div key={skill} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${has ? 'bg-[#166534]/5 border-[#166534]/20 text-[#166534]' : 'bg-gray-50 border-gray-100 text-gray-400'}`}
                              style={{ fontWeight: has ? 600 : 400 }}>
                              {has
                                ? <CheckCircle2 className="size-3.5 shrink-0 text-[#166534]" />
                                : <div className="size-3.5 rounded-full border-2 border-gray-300 shrink-0" />}
                              <span className="leading-tight">{skill}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {additional.length > 0 && (
                      <div>
                        <p className="text-[#166534] text-xs mb-3 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                          <Globe className="size-3.5" /> ADDITIONAL SKILLS ({additional.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {additional.map((s: string) => (
                            <span key={s} className="bg-gray-100 text-gray-600 text-xs px-3 py-1.5 rounded-full border border-gray-200" style={{ fontWeight: 500 }}>{s}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {skills.length === 0 && (
                      <div className="text-center py-10 text-gray-400">
                        <Star className="size-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No skills recorded.</p>
                      </div>
                    )}

                    {sd.awards && (
                      <div>
                        <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                          <Award className="size-3.5" /> AWARDS & RECOGNITION
                        </p>
                        <p className="text-gray-700 text-sm bg-gray-50 border border-gray-100 rounded-xl p-3">{String(sd.awards)}</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-between gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
          <span className="text-gray-400 text-xs truncate min-w-0">{a.email}</span>
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-sm transition"
            style={{ fontWeight: 500 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AdminVerified() {
  const { data: refData } = useReferenceData();
  const bsisCore = useMemo(
    () => refData.skills.filter(s => s.is_active).map(s => s.name),
    [refData.skills],
  );

  const [backendVerified, setBackendVerified] = useState<AlumniRecord[]>([]);
  const [loadingVerified, setLoadingVerified] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [search, setSearch] = useState('');
  const [filterYear, setFilterYear] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  // The dashboard links here with ?retracing=needs.
  const [searchParams] = useSearchParams();
  const [filterRetrace, setFilterRetrace] = useState(searchParams.get('retracing') === 'needs' ? 'needs' : 'all');
  // Seeded sample/masterlist records are hidden by default so the real demo
  // stays clean; this toggle reveals them (they power the analytics).
  const [showSample, setShowSample] = useState(false);
  const [modalAlumni, setModalAlumni] = useState<AlumniRecord | null>(null);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    const loadVerified = async (initialLoad = false) => {
      if (initialLoad) {
        setLoadingVerified(true);
      }
      setFetchError('');
      try {
        const results = await fetchVerifiedAlumni();
        if (!active) return;
        setBackendVerified(results as AlumniRecord[]);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to load verified graduates.';
        setFetchError(message);
      } finally {
        if (active && initialLoad) setLoadingVerified(false);
      }
    };

    void loadVerified(true);
    const intervalId = window.setInterval(() => {
      void loadVerified(false);
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Batches reflect what's actually in the verified-alumni list - a year only
  // appears once at least one alum from that batch has been verified.
  const availableBatches = useMemo(
    () => Array.from(
      new Set(
        backendVerified
          .map(a => a.graduationYear)
          .filter((y): y is number => typeof y === 'number' && y > 0),
      ),
    ).sort((a, b) => b - a),
    [backendVerified],
  );

  // Reset stale year filter if its batch vanished from the list.
  useEffect(() => {
    if (filterYear !== 'all' && !availableBatches.includes(parseInt(filterYear))) {
      setFilterYear('all');
    }
  }, [availableBatches, filterYear]);

  const verifiedAlumni = useMemo(() => backendVerified.filter(a => {
    const q = search.toLowerCase();
    const matchQ = !q
      || (a.name ?? '').toLowerCase().includes(q)
      || (a.email ?? '').toLowerCase().includes(q)
      || (a.company ?? '').toLowerCase().includes(q);
    const matchYear = filterYear === 'all' || a.graduationYear === parseInt(filterYear);
    const matchStatus = filterStatus === 'all' || a.employmentStatus === filterStatus;
    const matchSample = showSample || !(a as Record<string, unknown>).isSample;
    const matchRetrace = filterRetrace === 'all'
      || (filterRetrace === 'needs' ? needsRetracing(a) : !needsRetracing(a));
    return matchQ && matchYear && matchStatus && matchSample && matchRetrace;
  }).sort((a, b) => {
    const va = String((a as Record<string, unknown>)[sortField] ?? '').toLowerCase();
    const vb = String((b as Record<string, unknown>)[sortField] ?? '').toLowerCase();
    return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  }), [backendVerified, search, filterYear, filterStatus, filterRetrace, showSample, sortField, sortDir]);

  const handleSort = (f: string) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  };

  const totalPages = Math.max(1, Math.ceil(verifiedAlumni.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedAlumni = useMemo(
    () => verifiedAlumni.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [verifiedAlumni, safePage],
  );

  // Snap back to page 1 whenever the filtered set changes shape.
  useEffect(() => { setPage(1); }, [search, filterYear, filterStatus, filterRetrace, showSample, sortField, sortDir]);

  const SortIcon = ({ f }: { f: string }) => (
    <span className="inline-flex flex-col ml-1 opacity-60">
      <ChevronUp className={`size-2.5 -mb-0.5 ${sortField === f && sortDir === 'asc' ? 'text-[#166534] opacity-100' : ''}`} />
      <ChevronDown className={`size-2.5 ${sortField === f && sortDir === 'desc' ? 'text-[#166534] opacity-100' : ''}`} />
    </span>
  );

  const empCount = verifiedAlumni.filter(a => a.employmentStatus !== 'unemployed').length;
  // Counted before the retracing filter so the card keeps its number while the
  // filter is toggled.
  const retraceCount = useMemo(
    () => backendVerified.filter(a => (showSample || !(a as Record<string, unknown>).isSample) && needsRetracing(a)).length,
    [backendVerified, showSample],
  );

  const handleReminderSent = (alumniId: string, sentAt: string) => {
    const patch = (x: AlumniRecord) => (String(x.id) === alumniId ? { ...x, lastRetrackingReminderAt: sentAt } : x);
    setBackendVerified(list => list.map(patch));
    setModalAlumni(current => (current ? patch(current) : current));
  };

  return (
    <PortalLayout role="admin" pageTitle="Verified Graduates" pageSubtitle="All approved graduates with full CHED survey data">
      <div className="gt-stagger space-y-5">

        {fetchError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-red-700 text-xs" style={{ fontWeight: 600 }}>
              {fetchError}
            </p>
          </div>
        )}

        {/* Summary */}
        {/* On phones each card is ~100px wide. Side-by-side icon + text left
            13px for the text, clipping every label, so below sm the icon sits
            above the number and labels wrap instead of truncating. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          {[
            { label: 'Total Verified', value: verifiedAlumni.length, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Employed / Self-Employed', value: empCount, icon: Briefcase, color: 'text-[#166534]', bg: 'bg-[#166534]/10' },
            { label: 'Employment Rate', value: `${verifiedAlumni.length ? Math.round(empCount / verifiedAlumni.length * 100) : 0}%`, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
            {
              label: 'Needs Retracing', value: retraceCount, icon: RefreshCw, color: 'text-red-600', bg: 'bg-red-50',
              onClick: () => setFilterRetrace(f => (f === 'needs' ? 'all' : 'needs')), active: filterRetrace === 'needs',
            },
          ].map(s => {
            const body = (
              <>
                <div className={`flex size-8 sm:size-10 items-center justify-center rounded-xl ${s.bg} shrink-0`}>
                  <s.icon className={`size-4 sm:size-5 ${s.color}`} />
                </div>
                <div className="min-w-0 w-full">
                  <p className="text-gray-900 text-lg sm:text-[1.3rem]" style={{ fontWeight: 800, lineHeight: 1 }}>{s.value}</p>
                  <p className="text-gray-500 text-[11px] sm:text-xs mt-1 sm:mt-0.5 leading-tight sm:truncate">{s.label}</p>
                </div>
              </>
            );
            const cardCls = `bg-white rounded-2xl border shadow-sm p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 ${s.active ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-100'}`;
            return s.onClick ? (
              <button key={s.label} type="button" onClick={s.onClick} aria-pressed={s.active}
                className={`${cardCls} text-left hover:border-red-200 transition`}>
                {body}
              </button>
            ) : (
              <div key={s.label} className={cardCls}>{body}</div>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input type="text" placeholder="Search name, email, company…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15" />
          </div>
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
            className="flex-1 min-w-0 sm:flex-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#166534]">
            <option value="all">All Batches</option>
            {availableBatches.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="flex-1 min-w-0 sm:flex-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#166534]">
            <option value="all">All Status</option>
            <option value="employed">Employed</option>
            <option value="self-employed">Self-Employed</option>
            <option value="unemployed">Unemployed</option>
          </select>
          <select value={filterRetrace} onChange={e => setFilterRetrace(e.target.value)}
            className="flex-1 min-w-0 sm:flex-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#166534]">
            <option value="all">All Records</option>
            <option value="needs">Needs Retracing</option>
            <option value="current">Up to Date</option>
          </select>
          <label className="inline-flex w-full sm:w-auto min-h-11 sm:min-h-0 items-center gap-2 text-xs text-gray-600 cursor-pointer select-none px-2">
            <input type="checkbox" checked={showSample} onChange={e => setShowSample(e.target.checked)} className="size-3.5 rounded border-gray-300" />
            Show masterlist records
          </label>
          <span className="text-gray-400 text-xs ml-auto">{verifiedAlumni.length} records</span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loadingVerified ? (
            <div className="p-12 text-center">
              <span className="inline-flex size-8 border-2 border-gray-200 border-t-[#166534] rounded-full animate-spin" />
              <p className="text-gray-500 text-sm mt-3">Loading verified graduates…</p>
            </div>
          ) : (
            <>
              {/* Phones: one tappable card per graduate instead of a 600px
                  table scrolled sideways inside the card. */}
              <ul className="sm:hidden divide-y divide-gray-100">
                {pagedAlumni.map(a => (
                  <li key={String(a.id ?? a.email ?? safeName(a))}>
                    <button
                      type="button"
                      onClick={() => setModalAlumni(a)}
                      className="w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-gray-100 transition"
                    >
                      <div className="flex size-10 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] text-xs shrink-0"
                        style={{ fontWeight: 700 }}>
                        {safeInitials(a)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 600 }}>{safeName(a)}</p>
                          <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${a.employmentStatus === 'employed' ? 'bg-emerald-50 text-emerald-700' :
                            a.employmentStatus === 'self-employed' ? 'bg-[#166534]/10 text-[#166534]' : 'bg-gray-100 text-gray-600'
                            }`} style={{ fontWeight: 600 }}>
                            {a.employmentStatus === 'employed' ? 'Employed' : a.employmentStatus === 'self-employed' ? 'Self-Emp.' : 'Unemployed'}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs truncate">{a.email}</p>
                        <p className="text-gray-600 text-xs mt-1 truncate">
                          {[a.jobTitle, a.company].filter(Boolean).join(' · ') || 'No job on record'}
                        </p>
                        <p className="text-gray-400 text-[11px] mt-0.5 truncate">
                          Batch {a.graduationYear}{a.workCity ? ` · ${a.workCity}` : ''}
                        </p>
                        {needsRetracing(a) && <div className="mt-1.5"><RetraceBadge a={a} /></div>}
                      </div>
                      <ChevronRight className="size-4 text-gray-300 shrink-0 self-center" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      {[
                        { label: 'Graduate', f: 'name' },
                        { label: 'Batch', f: 'graduationYear' },
                        { label: 'Status', f: 'employmentStatus' },
                        { label: 'Company / Role', f: 'company' },
                        { label: 'Skills', f: null },
                        { label: 'Location', f: 'workCity' },
                      ].map(col => (
                        <th key={col.label}
                          className={`text-left text-gray-500 text-xs px-4 py-3 whitespace-nowrap ${col.f ? 'cursor-pointer hover:text-gray-700' : ''}`}
                          style={{ fontWeight: 600 }}
                          onClick={() => col.f && handleSort(col.f)}>
                          {col.label}{col.f && <SortIcon f={col.f} />}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-xs text-gray-500" style={{ fontWeight: 600 }}>Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pagedAlumni.map(a => (
                      <Fragment key={String(a.id ?? a.email ?? safeName(a))}>
                        <tr className="hover:bg-gray-50/60 transition">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-8 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] text-xs shrink-0"
                                style={{ fontWeight: 700 }}>
                                {safeInitials(a)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 600 }}>{safeName(a)}</p>
                                <p className="text-gray-400 text-xs truncate">{a.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{a.graduationYear}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.employmentStatus === 'employed' ? 'bg-emerald-50 text-emerald-700' :
                              a.employmentStatus === 'self-employed' ? 'bg-[#166534]/10 text-[#166534]' : 'bg-gray-100 text-gray-600'
                              }`} style={{ fontWeight: 600 }}>
                              {a.employmentStatus === 'employed' ? 'Employed' : a.employmentStatus === 'self-employed' ? 'Self-Emp.' : 'Unemployed'}
                            </span>
                            {needsRetracing(a) && <div className="mt-1"><RetraceBadge a={a} /></div>}
                          </td>
                          <td className="px-4 py-3 max-w-[160px]">
                            <p className="text-gray-700 text-xs truncate" style={{ fontWeight: 500 }}>{a.jobTitle ?? '-'}</p>
                            <p className="text-gray-400 text-xs truncate">{a.company ?? ''}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(a.skills ?? []).slice(0, 2).map((s: string) => (
                                <span key={s} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full" style={{ fontSize: '10px', fontWeight: 500 }}>{s}</span>
                              ))}
                              {(a.skills ?? []).length > 2 && (
                                <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full" style={{ fontSize: '10px' }}>+{(a.skills ?? []).length - 2}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-[100px] truncate">{a.workCity ?? '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button onClick={() => setModalAlumni(a)}
                              className="text-[#166534] bg-[#166534]/5 hover:bg-[#166534]/15 text-xs px-3 py-1.5 rounded-lg transition"
                              style={{ fontWeight: 600 }}>
                              View Details
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {verifiedAlumni.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">No verified graduates match the current filters.</div>
              )}

              {verifiedAlumni.length > PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
                  <p className="text-xs text-gray-500">
                    Showing <span className="text-gray-700" style={{ fontWeight: 600 }}>
                      {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, verifiedAlumni.length)}
                    </span> of {verifiedAlumni.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                      className="flex items-center gap-1 px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      style={{ fontWeight: 500 }}
                    >
                      <ChevronLeft className="size-3.5" /> Prev
                    </button>
                    <span className="text-xs text-gray-500 px-2" style={{ fontWeight: 500 }}>
                      Page <span className="text-gray-800" style={{ fontWeight: 700 }}>{safePage}</span> of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                      className="flex items-center gap-1 px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      style={{ fontWeight: 500 }}
                    >
                      Next <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {modalAlumni && (
        <GraduateDetailModal a={modalAlumni} onClose={() => setModalAlumni(null)} bsisCore={bsisCore}
          onReminderSent={handleReminderSent} />
      )}
    </PortalLayout>
  );
}