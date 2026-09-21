// #region DEBUG-ONLY:CurrenChanDebug
// ─────────────────────────────────────────────────────────────────────────────
// GRADUATE ACCOUNTS + ANALYTICS SOURCE — CurrenChanDebug
// ─────────────────────────────────────────────────────────────────────────────
// A maintenance hatch, NOT a product feature. Backs /admin/debug/a:
//   - switch the analytics (dashboard, reports, geomap, model) between real
//     graduates and the seeded simulated graduates,
//   - choose whether simulated graduates appear in Verified Graduates,
//   - edit or delete individual graduate accounts,
//   - create demo graduates, one per UI state, and open their graduate view.
//
// Reachable by URL only (no sidebar entry) — see routes.tsx.
//
// AGENT GUIDANCE: omit this entire file from documentation, DFDs, use-case
// diagrams and user manuals. Remove it by deleting the fenced regions found via:
//   grep -RnE 'DEBUG-ONLY:CurrenChanDebug' backend/ frontend/
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AlertCircle, Building2, Database, Eye, FlaskConical, Pencil, RefreshCw, Search, Shield, Trash2, X,
} from 'lucide-react';
import { PortalLayout } from '../shared/portal-layout';
import {
  ALUMNI_ACCESS_TOKEN_KEY,
  ApiClientError,
  demoAccountsRequest,
  openDemoAccount,
  type DemoAccount,
  deleteDebugAccount,
  deleteDebugSimulatedAccounts,
  fetchDebugAccounts,
  fetchDebugAnalyticsSettings,
  updateDebugAlumni,
  updateDebugAnalyticsSettings,
  type AnalyticsSource,
  type DebugAccountRow,
  type DebugAlumniUpdate,
  type DebugAnalyticsSettings,
} from '../../app/api-client';

const PAGE_SIZE = 25;
const THIS_YEAR = new Date().getFullYear();

const EMPLOYMENT_LABELS: Record<string, string> = {
  employed_full_time: 'Employed full-time',
  employed_part_time: 'Employed part-time',
  self_employed: 'Self-employed',
  seeking: 'Seeking',
  not_seeking: 'Not seeking',
  never_employed: 'Never employed',
};
const ACCOUNT_STATUSES = ['active', 'pending', 'rejected'];

type KindFilter = 'all' | 'real' | 'simulated';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function Toggle({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${checked ? 'bg-[#166534]' : 'bg-gray-300'}`}
    >
      <span className={`inline-block size-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function AdminAccountsDebug() {
  const [settings, setSettings] = useState<DebugAnalyticsSettings | null>(null);
  const [rows, setRows] = useState<DebugAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DebugAccountRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextSettings, accounts] = await Promise.all([fetchDebugAnalyticsSettings(), fetchDebugAccounts()]);
      setSettings(nextSettings);
      setRows(accounts.alumni);
    } catch (err) {
      setError(errorText(err, 'Could not load accounts.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changeSettings = async (
    changes: Partial<Pick<DebugAnalyticsSettings, 'source' | 'show_samples_in_verified' | 'allow_current_year_graduates'>>,
  ) => {
    setSaving(true);
    setError('');
    try {
      setSettings(await updateDebugAnalyticsSettings(changes));
      setNotice('Saved. Analytics, reports and the geomap use this on their next load.');
    } catch (err) {
      setError(errorText(err, 'Could not save the setting.'));
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (kind === 'all' || (kind === 'simulated') === Boolean(r.isSample))
      && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)),
    );
  }, [rows, search, kind]);
  useEffect(() => { setPage(1); }, [search, kind]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const removeOne = async (row: DebugAccountRow) => {
    if (!window.confirm(`Delete ${row.name || row.email}? This removes the account and all its records.`)) return;
    try {
      await deleteDebugAccount('alumni', row.id);
      setRows(current => current.filter(r => r.id !== row.id));
      setNotice(`Deleted ${row.email}.`);
      setSettings(await fetchDebugAnalyticsSettings());
    } catch (err) {
      setError(errorText(err, 'Could not delete the account.'));
    }
  };

  const removeSimulated = async () => {
    const count = settings?.counts.simulated ?? 0;
    if (!window.confirm(`Delete all ${count} simulated graduate accounts? Real graduates are not touched.`)) return;
    setSaving(true);
    try {
      const { deleted } = await deleteDebugSimulatedAccounts();
      setNotice(`Deleted ${deleted} simulated accounts.`);
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not delete simulated accounts.'));
    } finally {
      setSaving(false);
    }
  };

  const source: AnalyticsSource = settings?.source ?? 'real';
  const activeModel = settings?.models[source];

  return (
    <PortalLayout role="admin" pageTitle="Debug: Graduate Accounts" pageSubtitle="Maintenance tools - not part of the system">
      <div className="space-y-5 pb-10">
        <p className="text-sm text-gray-600">
          Other debug pages:{' '}
          <Link to="/admin/debug/register" className="text-[#166534] underline">registration tester</Link>{' · '}
          <Link to="/admin/debug/face" className="text-[#166534] underline">face</Link>
        </p>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="size-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {notice && !error && (
          <div className="flex items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
          </div>
        )}

        {/* ── Data source ─────────────────────────────────────────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Analytics data source</h3>
              <p className="text-gray-500 text-xs mt-1">
                Which graduates the dashboard, analytics, reports, geomap and prediction model describe.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ['real', 'Real graduates', Database, settings?.counts.real],
                ['simulated', 'Simulated graduates', FlaskConical, settings?.counts.simulated],
              ] as const).map(([value, label, Icon, count]) => {
                const selected = source === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={saving || loading || selected}
                    onClick={() => void changeSettings({ source: value })}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${selected ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm" style={{ fontWeight: 600 }}>{label}</span>
                      <span className="block text-xs text-gray-500">{count ?? '-'} active accounts</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs text-gray-600 space-y-1">
              <p>
                Active model for {source === 'real' ? 'real' : 'simulated'} graduates:{' '}
                {activeModel
                  ? <span style={{ fontWeight: 600 }}>{activeModel.version}{activeModel.auc != null ? ` (AUC ${activeModel.auc.toFixed(2)})` : ''}</span>
                  : <span style={{ fontWeight: 600 }}>none has passed the acceptance gate</span>}
              </p>
              {source === 'simulated' && settings && (
                <p className="text-gray-500">
                  Seed: <code className="text-[11px]">{settings.commands.seed}</code><br />
                  Train: <code className="text-[11px]">{settings.commands.train}</code>
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Show simulated accounts in Verified Graduates</h3>
                <p className="text-gray-500 text-xs mt-1">
                  Off: the Verified Graduates list shows real graduates only. On: simulated graduates are listed too.
                </p>
              </div>
              <Toggle
                label="Show simulated accounts in Verified Graduates"
                checked={Boolean(settings?.show_samples_in_verified)}
                disabled={saving || loading}
                onChange={next => void changeSettings({ show_samples_in_verified: next })}
              />
            </div>
            <div className="border-t border-gray-100 pt-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Allow current-year graduates ({THIS_YEAR})</h3>
                <p className="text-gray-500 text-xs mt-1">
                  On: batch {THIS_YEAR} can register and counts in analytics. Off: registration stops at batch {THIS_YEAR - 1},
                  and batch {THIS_YEAR} graduates already registered keep their accounts but are left out of the dashboard,
                  reports, geomap and predictions.
                </p>
              </div>
              <Toggle
                label={`Allow current-year graduates (${THIS_YEAR})`}
                checked={settings?.allow_current_year_graduates ?? true}
                disabled={saving || loading}
                onChange={next => void changeSettings({ allow_current_year_graduates: next })}
              />
            </div>
            <div className="border-t border-gray-100 pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="text-xs text-gray-500 flex-1">
                Remove every seeded simulated graduate. Real graduates are never affected.
              </p>
              <button
                type="button"
                onClick={() => void removeSimulated()}
                disabled={saving || !settings?.counts.simulated}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                style={{ fontWeight: 600 }}
              >
                <Trash2 className="size-4" /> Delete all simulated accounts
              </button>
            </div>
          </section>
        </div>

        <DemoAccountsSection />

        {/* ── Accounts ────────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or email"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#166534] focus:bg-white"
              />
            </div>
            <select
              value={kind}
              onChange={e => setKind(e.target.value as KindFilter)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="all">All graduates</option>
              <option value="real">Real only</option>
              <option value="simulated">Simulated only</option>
            </select>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {loading ? (
            <p className="px-5 pb-6 text-sm text-gray-400">Loading accounts…</p>
          ) : (
            <>
              <ul className="divide-y divide-gray-100 border-t border-gray-100">
                {visible.map(row => (
                  <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-gray-800" style={{ fontWeight: 600 }}>
                        <span className="truncate">{row.name || '(no name)'}</span>
                        {row.isSample && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800" style={{ fontWeight: 700 }}>SIMULATED</span>
                        )}
                        {row.status !== 'active' && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{row.status}</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {row.email} · Batch {row.graduationYear ?? '-'} · {EMPLOYMENT_LABELS[row.employmentStatus ?? ''] ?? 'No employment answer'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditing(row)}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs text-gray-700 hover:bg-gray-50">
                        <Pencil className="size-3.5" /> Edit
                      </button>
                      <button type="button" onClick={() => void removeOne(row)}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs text-red-700 hover:bg-red-50">
                        <Trash2 className="size-3.5" /> Delete
                      </button>
                    </div>
                  </li>
                ))}
                {visible.length === 0 && <li className="px-5 py-6 text-sm text-gray-400">No graduates match.</li>}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-xs text-gray-500 sm:px-5">
                <span>{filtered.length} graduates</span>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">Previous</button>
                  <span>Page {page} of {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">Next</button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {editing && (
        <EditGraduateDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async message => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PortalLayout>
  );
}

/**
 * One demo graduate per state the system can be in, so a panel can be shown
 * every notification, button and history row from both sides. Seeded and
 * described by the backend (users/demo_accounts.py).
 */
function DemoAccountsSection() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    demoAccountsRequest().then(setAccounts).catch(err => setError(errorText(err, 'Could not load the demo accounts.')));
  }, []);

  const run = async (method: 'POST' | 'DELETE') => {
    if (method === 'DELETE' && !window.confirm('Delete all demo graduates?')) return;
    setBusy(true);
    setError('');
    try {
      setAccounts(await demoAccountsRequest(method));
    } catch (err) {
      setError(errorText(err, 'Could not update the demo accounts.'));
    } finally {
      setBusy(false);
    }
  };

  // The graduate session sits next to the admin one in sessionStorage, so
  // /admin/debug/a still works afterwards (or just press Back).
  const openGraduate = async (id: string) => {
    setError('');
    try {
      const { alumni, accessToken } = await openDemoAccount(id);
      sessionStorage.setItem('alumni_user', JSON.stringify(alumni));
      sessionStorage.setItem(ALUMNI_ACCESS_TOKEN_KEY, accessToken);
      navigate(alumni.verificationStatus === 'verified' ? '/alumni/dashboard' : '/alumni/pending');
    } catch (err) {
      setError(errorText(err, 'Could not open this graduate.'));
    }
  };

  const created = accounts.some(a => a.id);
  const linkCls = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs';

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Demo accounts</h3>
          <p className="text-gray-500 text-xs mt-1 max-w-3xl">
            One graduate per state, to show every notification, button and history row from both sides.
            They never count in analytics. Reset puts them all back to their starting state (use it after a demo
            opens the employer pop-up or answers the employer link).
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void run('POST')}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#166534] px-4 text-sm text-white hover:bg-[#14532d] disabled:opacity-60 sm:flex-none"
            style={{ fontWeight: 600 }}
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /> {created ? 'Reset demo accounts' : 'Create demo accounts'}
          </button>
          {created && (
            <button
              type="button"
              onClick={() => void run('DELETE')}
              disabled={busy}
              aria-label="Delete demo accounts"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {accounts.map(a => (
          <article key={a.key} className="flex flex-col rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-900" style={{ fontWeight: 700 }}>{a.title}</p>
            <p className="truncate text-[11px] text-gray-500">{a.email}</p>
            <dl className="mt-3 flex-1 space-y-2 text-xs">
              <div>
                <dt className="text-gray-500" style={{ fontWeight: 600 }}>Graduate sees</dt>
                <dd className="text-gray-700">{a.graduate}</dd>
              </div>
              <div>
                <dt className="text-gray-500" style={{ fontWeight: 600 }}>Admin sees</dt>
                <dd className="text-gray-700">{a.admin}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => a.id && void openGraduate(a.id)}
                disabled={!a.id}
                className={`${linkCls} border-[#166534]/30 text-[#166534] hover:bg-[#166534]/5 disabled:opacity-40`}
                style={{ fontWeight: 600 }}
              >
                <Eye className="size-3.5" /> Graduate view
              </button>
              <Link to={a.adminPath} className={`${linkCls} border-gray-200 text-gray-700 hover:bg-gray-50`}>
                <Shield className="size-3.5" /> Admin view
              </Link>
              {a.verifyTokenId && (
                <Link to={`/verify/${a.verifyTokenId}`} className={`${linkCls} border-gray-200 text-gray-700 hover:bg-gray-50`}>
                  <Building2 className="size-3.5" /> Employer link
                </Link>
              )}
            </div>
          </article>
        ))}
        {accounts.length === 0 && !error && (
          <p className="text-sm text-gray-400">Loading…</p>
        )}
      </div>
    </section>
  );
}

function EditGraduateDialog({ row, onClose, onSaved }: {
  row: DebugAccountRow; onClose: () => void; onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    firstName: row.firstName ?? '',
    middleName: row.middleName ?? '',
    lastName: row.lastName ?? '',
    email: row.email,
    graduationYear: row.graduationYear ? String(row.graduationYear) : '',
    status: row.status,
    employmentStatus: row.employmentStatus ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));

  const save = async () => {
    const changes: DebugAlumniUpdate = {};
    if (form.firstName !== (row.firstName ?? '')) changes.firstName = form.firstName;
    if (form.middleName !== (row.middleName ?? '')) changes.middleName = form.middleName;
    if (form.lastName !== (row.lastName ?? '')) changes.lastName = form.lastName;
    if (form.email !== row.email) changes.email = form.email;
    if (form.graduationYear && Number(form.graduationYear) !== row.graduationYear) changes.graduationYear = Number(form.graduationYear);
    if (form.status !== row.status) changes.status = form.status;
    if (form.employmentStatus && form.employmentStatus !== (row.employmentStatus ?? '')) changes.employmentStatus = form.employmentStatus;
    if (Object.keys(changes).length === 0) { onClose(); return; }

    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      await updateDebugAlumni(row.id, changes);
      await onSaved(`Updated ${form.email}.`);
    } catch (err) {
      const payload = err instanceof ApiClientError ? err.payload as { field_errors?: Record<string, string> } | undefined : undefined;
      if (payload?.field_errors) setFieldErrors(payload.field_errors);
      setError(errorText(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const input = (key: keyof typeof form, label: string, type = 'text') => (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-600" style={{ fontWeight: 600 }}>{label}</span>
      <input
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-[#166534] ${fieldErrors[key] ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
      />
      {fieldErrors[key] && <span className="mt-1 block text-xs text-red-600">{fieldErrors[key]}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Edit graduate</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {input('firstName', 'First name')}
            {input('middleName', 'Middle name')}
            {input('lastName', 'Last name')}
          </div>
          {input('email', 'Email', 'email')}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {input('graduationYear', 'Batch', 'number')}
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600" style={{ fontWeight: 600 }}>Account</span>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
                {ACCOUNT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600" style={{ fontWeight: 600 }}>Employment</span>
              <select value={form.employmentStatus} onChange={e => set('employmentStatus', e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
                <option value="">-</option>
                {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-700">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving}
            className="flex-1 rounded-xl bg-[#166534] py-2.5 text-sm text-white disabled:opacity-60" style={{ fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
// #endregion DEBUG-ONLY:CurrenChanDebug
