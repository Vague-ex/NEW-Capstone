import { useEffect, useMemo, useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { fetchPendingAlumni, reviewAlumniRequest } from '../../app/api-client';
import type { AlumniRecord } from '../../data/app-data';
import {
  CheckCircle2, XCircle, Clock, Camera, User,
  Calendar, Briefcase, AlertTriangle, X, Search,
  Mail, MapPin, Star, Building2,
  BarChart2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ModalTab = 'biometric' | 'employment' | 'skills';

type FaceScans = {
  front?: string;
  left?: string;
  right?: string;
};

type SurveyData = {
  scholarship?: string;
  highestAttainment?: string;
  profEligibility?: string[];
  neverEmployed?: boolean;
};

function SectionRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
      <span className="text-gray-400 text-xs w-40 shrink-0 pt-0.5">{label}</span>
      <span className="text-gray-700 text-xs flex-1" style={{ fontWeight: value && value !== '—' ? 500 : 400, fontStyle: value && value !== '—' ? 'normal' : 'italic', color: value && value !== '—' ? undefined : '#d1d5db' }}>
        {value && value !== '—' ? value : 'Not provided'}
      </span>
    </div>
  );
}

function deriveTimeToHire(a: AlumniRecord): string {
  const m = a.monthsToHire;
  if (!m) return '—';
  if (m <= 1) return 'Within 1 month';
  if (m <= 3) return '1–3 months';
  if (m <= 6) return '3–6 months';
  if (m <= 12) return '6 months to 1 year';
  return 'After 1 year';
}

function getFaceScans(a: AlumniRecord): FaceScans {
  const record = a as Record<string, unknown>;
  const scansRaw = record.registrationFaceScans;
  const scans = (scansRaw && typeof scansRaw === 'object' ? scansRaw : {}) as Record<string, unknown>;

  const front = (scans.front ?? scans.face_front ?? record.facePhotoUrl) as string | undefined;
  const left = (scans.left ?? scans.face_left) as string | undefined;
  const right = (scans.right ?? scans.face_right) as string | undefined;

  return { front, left, right };
}

function getPrimaryFaceScan(scans: FaceScans): string | undefined {
  return scans.front ?? scans.left ?? scans.right;
}

function hasBiometricCapture(a: AlumniRecord, scans?: FaceScans): boolean {
  const resolvedScans = scans ?? getFaceScans(a);
  return Boolean(a.biometricCaptured || resolvedScans.front || resolvedScans.left || resolvedScans.right);
}

function getSurveyData(a: AlumniRecord): SurveyData {
  const raw = (a as Record<string, unknown>).surveyData;
  if (!raw || typeof raw !== 'object') return {};

  const source = raw as Record<string, unknown>;
  const profEligibilityRaw = source.profEligibility;

  return {
    scholarship: typeof source.scholarship === 'string' ? source.scholarship : undefined,
    highestAttainment: typeof source.highestAttainment === 'string' ? source.highestAttainment : undefined,
    profEligibility: Array.isArray(profEligibilityRaw)
      ? profEligibilityRaw.filter((item): item is string => typeof item === 'string')
      : undefined,
    neverEmployed: typeof source.neverEmployed === 'boolean' ? source.neverEmployed : undefined,
  };
}

export function AdminUnverified() {
  const [backendPending, setBackendPending] = useState<AlumniRecord[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [reviewAlumni, setReviewAlumni] = useState<AlumniRecord | null>(null);
  const [modalTab, setModalTab] = useState<ModalTab>('biometric');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    const loadPending = async () => {
      setLoadingPending(true);
      setFetchError('');
      try {
        const results = await fetchPendingAlumni();
        if (!active) return;
        setBackendPending(results as AlumniRecord[]);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to load pending graduates.';
        setFetchError(message);
      } finally {
        if (active) setLoadingPending(false);
      }
    };
    void loadPending();
    return () => {
      active = false;
    };
  }, []);

  const getRecordId = (a: AlumniRecord) => String(a.id ?? a.email ?? '');

  const pendingAlumni = useMemo(() => backendPending.filter(a => {
    const q = search.toLowerCase();
    return !q || a.name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q);
  }), [backendPending, search]);

  const handleApprove = async (id: string) => {
    if (!id) return;
    setActionError('');
    setActionLoading(id + '-approve');
    try {
      await reviewAlumniRequest(id, 'approve');
      setBackendPending((prev) => prev.filter((a) => getRecordId(a) !== id));
      setReviewAlumni(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to approve graduate right now.';
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!id) return;
    setActionError('');
    setActionLoading(id + '-reject');
    try {
      await reviewAlumniRequest(id, 'reject');
      setBackendPending((prev) => prev.filter((a) => getRecordId(a) !== id));
      setReviewAlumni(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reject graduate right now.';
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const openReview = (a: AlumniRecord) => {
    setReviewAlumni(a);
    setModalTab('biometric');
  };

  const empStatusLabel = (a: AlumniRecord) =>
    a.employmentStatus === 'employed' ? 'Employed'
      : a.employmentStatus === 'self-employed' ? 'Self-Employed'
        : 'Unemployed';

  const empStatusColor = (a: AlumniRecord) =>
    a.employmentStatus === 'employed' ? 'bg-emerald-50 text-emerald-700'
      : a.employmentStatus === 'self-employed' ? 'bg-[#166534]/10 text-[#166534]'
        : 'bg-gray-100 text-gray-500';

  return (
    <PortalLayout
      role="admin"
      pageTitle="Pending Verification"
      pageSubtitle="Graduate data is submitted and visible — excluded from analytics until verified"
      notificationCount={pendingAlumni.length}
    >
      <div className="space-y-5">

        {fetchError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-xs" style={{ fontWeight: 600 }}>
              {fetchError}
            </p>
          </div>
        )}

        {actionError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-xs" style={{ fontWeight: 600 }}>
              {actionError}
            </p>
          </div>
        )}

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <BarChart2 className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-800 text-sm" style={{ fontWeight: 600 }}>
              Pending graduates have already submitted their full employment and survey data during registration.
            </p>
            <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
              Their information is visible here for review but is <span style={{ fontWeight: 700 }}>excluded from analytics, reports, and geomapping</span> until you approve their account.
            </p>
          </div>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl shadow-sm px-4 py-2.5">
            <Clock className="size-4 text-amber-500" />
            <span className="text-gray-700 text-sm" style={{ fontWeight: 600 }}>
              {pendingAlumni.length} account{pendingAlumni.length !== 1 ? 's' : ''} awaiting verification
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 w-64"
            />
          </div>
        </div>

        {/* List */}
        {loadingPending ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <span className="inline-flex size-8 border-2 border-gray-200 border-t-[#166534] rounded-full animate-spin" />
            <p className="text-gray-500 text-sm mt-3">Loading pending graduate accounts…</p>
          </div>
        ) : pendingAlumni.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <CheckCircle2 className="size-12 text-emerald-400 mx-auto mb-4" />
            <h3 className="text-gray-700" style={{ fontWeight: 700 }}>All Verified!</h3>
            <p className="text-gray-400 text-sm mt-1">No pending graduate accounts to review.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-100">
              {pendingAlumni.map(a => {
                const rowId = getRecordId(a);
                const faceScans = getFaceScans(a);
                const primaryFaceScan = getPrimaryFaceScan(faceScans);
                const hasBiometric = hasBiometricCapture(a, faceScans);
                return (
                  <div key={rowId} className="p-4 hover:bg-gray-50/50 transition">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">

                      {/* Biometric photo */}
                      <div className="relative flex size-14 shrink-0 items-center justify-center rounded-xl bg-gray-900 overflow-hidden border-2 border-amber-300">
                        {hasBiometric && primaryFaceScan ? (
                          <>
                            <img src={primaryFaceScan} alt={`${a.name || 'Graduate'} biometric capture`} className="absolute inset-0 w-full h-full object-cover object-center" />
                            <div className="absolute bottom-0 left-0 right-0 bg-emerald-500/80 text-white text-center py-0.5">
                              <p style={{ fontWeight: 700, fontSize: '9px' }}>CAPTURED</p>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center">
                            <Camera className="size-5 text-gray-500" />
                            <p className="text-gray-600 mt-0.5" style={{ fontSize: '8px' }}>None</p>
                          </div>
                        )}
                      </div>

                      {/* Info block */}
                      <div className="flex-1 min-w-0">
                        {/* Row 1: Name + badges */}
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>{a.name || 'Unnamed Graduate'}</p>
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${empStatusColor(a)}`} style={{ fontWeight: 600 }}>
                            {empStatusLabel(a)}
                          </span>
                          {hasBiometric ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full" style={{ fontWeight: 600 }}>
                              <CheckCircle2 className="size-3" /> Biometric
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full" style={{ fontWeight: 600 }}>
                              <XCircle className="size-3" /> No biometric
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-200" style={{ fontWeight: 600 }}>
                            <BarChart2 className="size-3" /> Excl. Analytics
                          </span>
                        </div>

                        {/* Row 2: Contact + batch */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-gray-500 text-xs mb-1.5">
                          <span className="flex items-center gap-1"><Mail className="size-3" /> {a.email || 'No email'}</span>
                          <span className="flex items-center gap-1"><Calendar className="size-3" /> Batch {a.graduationYear || 'N/A'}</span>
                        </div>

                        {/* Row 3: Employment details */}
                        {a.employmentStatus !== 'unemployed' && (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                            {a.jobTitle && (
                              <span className="flex items-center gap-1 text-gray-700" style={{ fontWeight: 500 }}>
                                <Briefcase className="size-3 text-gray-400" /> {a.jobTitle}
                              </span>
                            )}
                            {a.company && (
                              <span className="flex items-center gap-1 text-gray-600">
                                <Building2 className="size-3 text-gray-400" /> {a.company}
                              </span>
                            )}
                            {a.workLocation && (
                              <span className="flex items-center gap-1 text-gray-500">
                                <MapPin className="size-3 text-gray-400" /> {a.workLocation}
                              </span>
                            )}
                            {a.industry && (
                              <span className="text-gray-400">· {a.industry}</span>
                            )}
                            {a.jobAlignment && (
                              <span className={`px-1.5 py-0.5 rounded text-xs ${a.jobAlignment === 'related' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`} style={{ fontWeight: 500, fontSize: '10px' }}>
                                {a.jobAlignment === 'related' ? 'BSIS-related' : 'Not BSIS-related'}
                              </span>
                            )}
                          </div>
                        )}
                        {a.employmentStatus === 'unemployed' && a.unemploymentReason && (
                          <p className="text-gray-400 text-xs italic">{a.unemploymentReason}</p>
                        )}

                        {/* Row 4: Skills preview */}
                        {a.skills && a.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {a.skills.slice(0, 4).map((s: string) => (
                              <span key={s} className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full" style={{ fontSize: '10px', fontWeight: 500 }}>{s}</span>
                            ))}
                            {a.skills.length > 4 && (
                              <span className="text-gray-400 px-2 py-0.5 rounded-full bg-gray-50" style={{ fontSize: '10px' }}>+{a.skills.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-center">
                        <button
                          onClick={() => openReview(a)}
                          className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs transition"
                          style={{ fontWeight: 600 }}
                        >
                          Full Review
                        </button>
                        <button
                          onClick={() => handleApprove(rowId)}
                          disabled={!rowId || actionLoading === rowId + '-approve'}
                          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs transition disabled:opacity-60"
                          style={{ fontWeight: 600 }}
                        >
                          {actionLoading === rowId + '-approve'
                            ? <span className="size-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                            : <CheckCircle2 className="size-3.5" />}
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(rowId)}
                          disabled={!rowId || actionLoading === rowId + '-reject'}
                          className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-xl text-xs transition disabled:opacity-60"
                          style={{ fontWeight: 600 }}
                        >
                          {actionLoading === rowId + '-reject'
                            ? <span className="size-3.5 border border-red-300 border-t-red-600 rounded-full animate-spin" />
                            : <XCircle className="size-3.5" />}
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Full Review Modal ── */}
      {reviewAlumni && (() => {
        const a = reviewAlumni;
        const faceScans = getFaceScans(a);
        const primaryFaceScan = getPrimaryFaceScan(faceScans);
        const hasBiometric = hasBiometricCapture(a, faceScans);
        const sd = getSurveyData(a);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[92vh] flex flex-col">

              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-sm" style={{ fontWeight: 700 }}>
                    {a.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <h3 className="text-gray-900" style={{ fontWeight: 700 }}>{a.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-gray-400 text-xs">Batch {a.graduationYear}</span>
                      <span className="text-gray-300">·</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${empStatusColor(a)}`} style={{ fontWeight: 600 }}>
                        {empStatusLabel(a)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-200" style={{ fontWeight: 600 }}>
                        <BarChart2 className="size-3" /> Excl. from Analytics
                      </span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setReviewAlumni(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
                  <X className="size-5 text-gray-500" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-100 shrink-0 px-6">
                {([
                  { key: 'biometric', label: 'Biometric & ID', icon: Camera },
                  { key: 'employment', label: 'Employment Data', icon: Briefcase },
                  { key: 'skills', label: 'Skills', icon: Star },
                ] as { key: ModalTab; label: string; icon: LucideIcon }[]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setModalTab(tab.key)}
                    className={`flex items-center gap-1.5 px-4 py-3 text-xs border-b-2 transition -mb-px ${modalTab === tab.key
                      ? 'border-[#166534] text-[#166534]'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    style={{ fontWeight: modalTab === tab.key ? 700 : 400 }}
                  >
                    <tab.icon className="size-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="overflow-y-auto flex-1">

                {/* ── TAB: Biometric & Identity ── */}
                {modalTab === 'biometric' && (
                  <div className="p-6 grid sm:grid-cols-2 gap-6">
                    {/* Biometric */}
                    <div>
                      <p className="text-gray-500 text-xs mb-3" style={{ fontWeight: 600 }}>BIOMETRIC CAPTURE (3-SHOT)</p>
                      <div className="bg-gray-900 rounded-2xl overflow-hidden" style={{ aspectRatio: '3/4' }}>
                        {hasBiometric && primaryFaceScan ? (
                          <img src={primaryFaceScan} alt={`${a.name || 'Graduate'} biometric`} className="w-full h-full object-cover object-center" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                            <div className="flex size-20 items-center justify-center rounded-full bg-gray-700">
                              <User className="size-10 text-gray-500" />
                            </div>
                            <span className="bg-red-500/20 text-red-400 border border-red-500/30 text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{ fontWeight: 600 }}>
                              <XCircle className="size-3.5" /> No Biometric Submitted
                            </span>
                          </div>
                        )}
                      </div>

                      {hasBiometric && (faceScans.left || faceScans.right) && (
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          {([
                            { key: 'front', label: 'Front', url: faceScans.front },
                            { key: 'left', label: 'Left', url: faceScans.left },
                            { key: 'right', label: 'Right', url: faceScans.right },
                          ] as const).map((scan) => (
                            <div key={scan.key} className="bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
                              <div className="h-16">
                                {scan.url ? (
                                  <img src={scan.url} alt={`${a.name || 'Graduate'} ${scan.label} biometric`} className="w-full h-full object-cover object-center" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-500 text-[10px]">
                                    Missing
                                  </div>
                                )}
                              </div>
                              <p className="text-center text-[10px] text-gray-300 py-1">{scan.label}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 space-y-1">
                        <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-3 py-1.5 rounded-full" style={{ fontWeight: 600 }}>
                          <CheckCircle2 className="size-3.5" /> {hasBiometric ? 'Biometric Submitted' : 'Pending Biometric'}
                        </span>
                        <p className="text-gray-400 text-xs">{a.biometricDate || a.dateUpdated}</p>
                        {a.lat && a.lng && (
                          <p className="text-gray-500 text-xs flex items-center gap-1">
                            <MapPin className="size-3 text-emerald-400" />
                            {a.lat.toFixed(4)}, {a.lng.toFixed(4)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Personal info */}
                    <div className="space-y-4">
                      <div>
                        <p className="text-gray-500 text-xs mb-3" style={{ fontWeight: 600 }}>PERSONAL INFORMATION</p>
                        <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                          <SectionRow label="Full Name" value={a.name} />
                          <SectionRow label="Email Address" value={a.email} />
                          <SectionRow label="Graduation Batch" value={`Batch ${a.graduationYear}`} />
                          <SectionRow label="Date Submitted" value={a.dateUpdated} />
                        </div>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs mb-3" style={{ fontWeight: 600 }}>EDUCATION (PART II)</p>
                        <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                          <SectionRow label="Degree" value="BS Information Systems" />
                          <SectionRow label="Campus" value="CHMSU – Talisay" />
                          <SectionRow label="Scholarship" value={sd.scholarship || '—'} />
                          <SectionRow label="Highest Attainment" value={sd.highestAttainment || '—'} />
                          <SectionRow label="Prof. Eligibility" value={sd.profEligibility?.length ? sd.profEligibility.join(', ') : '—'} />
                        </div>
                      </div>
                      {!hasBiometric && (
                        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2">
                          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-amber-700 text-xs" style={{ fontWeight: 600 }}>No biometric on file — verify identity manually before approving.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── TAB: Employment Data (CHED Part III) ── */}
                {modalTab === 'employment' && (
                  <div className="p-6 space-y-5">
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                      <Briefcase className="size-4 text-blue-500 shrink-0" />
                      <p className="text-blue-700 text-xs" style={{ fontWeight: 500 }}>
                        This data was submitted by the graduate during registration. It mirrors the CHED Graduate Tracer Survey (Part III).
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-5">
                      {/* Q1 + Q2 */}
                      <div>
                        <p className="text-[#166534] text-xs mb-2" style={{ fontWeight: 700 }}>Q1–Q2 · EMPLOYMENT STATUS</p>
                        <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                          <SectionRow label="Q1 — Current Status" value={
                            a.employmentStatus === 'employed' ? 'Presently Employed'
                              : a.employmentStatus === 'self-employed' ? 'Self-Employed / Freelancer'
                                : sd.neverEmployed ? 'Never Been Employed'
                                  : 'Not Currently Employed'
                          } />
                          <SectionRow label="Q2 — Time to Hire" value={deriveTimeToHire(a)} />
                        </div>
                      </div>

                      {/* Q3 First Job */}
                      <div>
                        <p className="text-[#166534] text-xs mb-2" style={{ fontWeight: 700 }}>Q3 · FIRST JOB</p>
                        <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                          <SectionRow label="Sector" value={sd.firstJobSector || '—'} />
                          <SectionRow label="Employment Status" value={sd.firstJobStatus || '—'} />
                          <SectionRow label="Job Title" value={sd.firstJobTitle || a.jobTitle || '—'} />
                          <SectionRow label="BSIS-Related?" value={
                            sd.firstJobRelated === 'Yes' ? 'Yes — Related to BSIS'
                              : sd.firstJobRelated === 'No' ? 'No — Not related'
                                : a.jobAlignment === 'related' ? 'Yes — Related to BSIS'
                                  : a.jobAlignment === 'not-related' ? 'No — Not related' : '—'
                          } />
                          {(sd.firstJobRelated === 'No' || a.jobAlignment === 'not-related') && (
                            <SectionRow label="Reason (not related)" value={sd.firstJobUnrelatedReason || '—'} />
                          )}
                        </div>
                      </div>

                      {/* Q4 Current Job */}
                      <div>
                        <p className="text-[#166534] text-xs mb-2" style={{ fontWeight: 700 }}>Q4 · CURRENT JOB</p>
                        <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                          <SectionRow label="Sector" value={sd.currentJobSector || '—'} />
                          <SectionRow label="Position" value={sd.currentJobPosition || a.jobTitle || '—'} />
                          <SectionRow label="Company" value={sd.currentJobCompany || a.company || '—'} />
                          <SectionRow label="Industry" value={a.industry || '—'} />
                          <SectionRow label="Work Location" value={a.workLocation || '—'} />
                          <SectionRow label="City" value={a.workCity || '—'} />
                          <SectionRow label="BSIS-Related?" value={
                            a.jobAlignment === 'related' ? 'Yes — Related to BSIS'
                              : a.jobAlignment === 'not-related' ? 'No — Not related' : '—'
                          } />
                        </div>
                      </div>

                      {/* Q5 + Q6 */}
                      <div>
                        <p className="text-[#166534] text-xs mb-2" style={{ fontWeight: 700 }}>Q5–Q6 · RETENTION & SOURCING</p>
                        <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                          <SectionRow label="Q5 — Job Retention" value={sd.jobRetention || '—'} />
                          <SectionRow label="Q6 — Job Source" value={sd.jobSource || '—'} />
                        </div>
                        {a.employmentStatus === 'unemployed' && (
                          <div className="mt-3">
                            <p className="text-[#166534] text-xs mb-2" style={{ fontWeight: 700 }}>UNEMPLOYMENT REASON</p>
                            <div className="bg-gray-50 rounded-xl border border-gray-100 p-3">
                              <p className="text-gray-700 text-xs">{a.unemploymentReason || 'No reason provided'}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TAB: Skills ── */}
                {modalTab === 'skills' && (
                  <div className="p-6 space-y-5">
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                      <Star className="size-4 text-blue-500 shrink-0" />
                      <p className="text-blue-700 text-xs" style={{ fontWeight: 500 }}>
                        Skills submitted during registration (CHED Part IV). Graduates may add more skills after verification.
                      </p>
                    </div>

                    {/* Core BSIS Skills */}
                    {(() => {
                      const BSIS_CORE = [
                        'Programming/Software Development', 'Database Management', 'Network Administration',
                        'Business Process Analysis', 'Project Management', 'Technical Support / Troubleshooting',
                        'Data Analytics', 'Web Development', 'System Analysis and Design',
                        'Communication Skills (Oral/Written)', 'Teamwork/Collaboration', 'Problem-solving / Critical Thinking',
                      ];
                      const coreChecked = (a.skills ?? []).filter((s: string) => BSIS_CORE.includes(s));
                      const additional = (a.skills ?? []).filter((s: string) => !BSIS_CORE.includes(s));
                      return (
                        <>
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[#166534] text-xs" style={{ fontWeight: 700 }}>BSIS CORE COMPETENCIES ({coreChecked.length}/12)</p>
                              <div className="w-24 bg-gray-100 rounded-full h-2">
                                <div className="h-2 rounded-full bg-[#166534] transition-all" style={{ width: `${(coreChecked.length / 12) * 100}%` }} />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {BSIS_CORE.map(skill => {
                                const has = (a.skills ?? []).includes(skill);
                                return (
                                  <div key={skill} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${has ? 'bg-[#166534]/5 border-[#166534]/20 text-[#166534]' : 'bg-gray-50 border-gray-100 text-gray-400'}`} style={{ fontWeight: has ? 600 : 400 }}>
                                    {has
                                      ? <CheckCircle2 className="size-3.5 shrink-0 text-[#166534]" />
                                      : <div className="size-3.5 rounded-full border-2 border-gray-300 shrink-0" />}
                                    {skill}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {additional.length > 0 && (
                            <div>
                              <p className="text-[#166534] text-xs mb-3" style={{ fontWeight: 700 }}>ADDITIONAL SKILLS ({additional.length})</p>
                              <div className="flex flex-wrap gap-2">
                                {additional.map((s: string) => (
                                  <span key={s} className="bg-gray-100 text-gray-600 text-xs px-3 py-1.5 rounded-full border border-gray-200" style={{ fontWeight: 500 }}>{s}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {(a.skills ?? []).length === 0 && (
                            <div className="text-center py-8 text-gray-400">
                              <Star className="size-10 mx-auto mb-3 opacity-30" />
                              <p className="text-sm">No skills submitted yet.</p>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Modal footer actions */}
              <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 shrink-0">
                <button
                  onClick={() => setReviewAlumni(null)}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-sm transition"
                  style={{ fontWeight: 500 }}
                >
                  Cancel
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => handleReject(String(a.id ?? ''))}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
                  style={{ fontWeight: 600 }}
                >
                  <XCircle className="size-4" /> Reject Account
                </button>
                <button
                  onClick={() => handleApprove(String(a.id ?? ''))}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
                  style={{ fontWeight: 600 }}
                >
                  {actionLoading
                    ? <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <CheckCircle2 className="size-4" />}
                  Approve & Verify
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </PortalLayout>
  );
}
