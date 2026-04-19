import { useEffect, useMemo, useState, Fragment } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { GRADUATION_YEARS } from '../../data/app-data';
import type { AlumniRecord } from '../../data/app-data';
import { fetchVerifiedAlumni } from '../../app/api-client';
import {
  Search, CheckCircle2, Users, Briefcase, Star, MapPin,
  ChevronDown, ChevronUp, Camera, X,
  Clock, Building2, Globe, Award,
} from 'lucide-react';

type ModalTab = 'profile' | 'employment' | 'skills';

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveTimeToHire(a: AlumniRecord): string {
  const sd = (a as any).surveyData;
  if (sd?.timeToHire) return sd.timeToHire;
  if (!a.monthsToHire) return '—';
  const m = a.monthsToHire;
  if (m <= 1) return 'Within 1 month';
  if (m <= 3) return '1–3 months';
  if (m <= 6) return '3–6 months';
  if (m <= 12) return '6 months to 1 year';
  return 'After 1 year';
}

function deriveLocationLabel(a: AlumniRecord): string {
  const sd = (a as any).surveyData;
  if (sd?.currentJobLocation) return sd.currentJobLocation;
  const loc = (a.workLocation || '').toLowerCase();
  if (loc.includes('abroad') || loc.includes('singapore') || loc.includes('dubai') ||
    loc.includes('ofw') || loc.includes('foreign')) return 'Abroad / Remote Foreign Employer';
  return 'Local (Philippines)';
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-gray-400 text-xs shrink-0 w-40 pt-0.5">{label}</span>
      <span className={`text-xs flex-1 break-words ${value && value !== '—' ? 'text-gray-700' : 'text-gray-300 italic'}`}
        style={{ fontWeight: value && value !== '—' ? 500 : 400 }}>
        {value && value !== '—' ? value : 'Not provided'}
      </span>
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function GraduateDetailModal({ a, onClose }: { a: AlumniRecord; onClose: () => void }) {
  const [tab, setTab] = useState<ModalTab>('profile');
  const sd = (a as any).surveyData ?? {};

  const BSIS_CORE = [
    'Programming/Software Development', 'Database Management', 'Network Administration',
    'Business Process Analysis', 'Project Management', 'Technical Support / Troubleshooting',
    'Data Analytics', 'Web Development', 'System Analysis and Design',
    'Communication Skills (Oral/Written)', 'Teamwork/Collaboration', 'Problem-solving / Critical Thinking',
  ];
  const skills = a.skills ?? [];
  const coreCount = skills.filter((s: string) => BSIS_CORE.includes(s)).length;
  const additional = skills.filter((s: string) => !BSIS_CORE.includes(s));

  const empStatusLabel =
    a.employmentStatus === 'employed' ? 'Employed'
      : a.employmentStatus === 'self-employed' ? 'Self-Employed'
        : 'Unemployed';

  const empStatusColor =
    a.employmentStatus === 'employed' ? 'bg-emerald-50 text-emerald-700'
      : a.employmentStatus === 'self-employed' ? 'bg-[#166534]/10 text-[#166534]'
        : 'bg-gray-100 text-gray-600';

  const tabs: { key: ModalTab; label: string; icon: any }[] = [
    { key: 'profile', label: 'Profile & Education', icon: Camera },
    { key: 'employment', label: 'Employment (CHED)', icon: Briefcase },
    { key: 'skills', label: 'Skills', icon: Star },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60">
      <div className="bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl max-h-screen sm:max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] shrink-0"
            style={{ fontWeight: 700, fontSize: '0.9rem' }}>
            {a.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-gray-900 truncate" style={{ fontWeight: 700 }}>{a.name}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="text-gray-400 text-xs">Batch {a.graduationYear}</span>
              <span className="text-gray-300">·</span>
              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full ${empStatusColor}`} style={{ fontWeight: 600 }}>
                {empStatusLabel}
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700" style={{ fontWeight: 600 }}>
                <CheckCircle2 className="size-3" /> Verified
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition shrink-0">
            <X className="size-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0 px-5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs whitespace-nowrap border-b-2 transition -mb-px ${tab === t.key ? 'border-[#166534] text-[#166534]' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              style={{ fontWeight: tab === t.key ? 700 : 400 }}>
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="overflow-y-auto flex-1 p-5">

          {/* ── Profile & Education ── */}
          {tab === 'profile' && (
            <div className="space-y-5">
              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Camera className="size-3.5" /> ACCOUNT & BIOMETRIC
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Full Name" value={a.name} />
                  <Row label="Email Address" value={a.email} />
                  <Row label="Graduation Batch" value={`Batch ${a.graduationYear}`} />
                  <Row label="Last Updated" value={a.dateUpdated} />
                  <Row label="Biometric Capture" value={a.biometricCaptured ? 'Captured' : 'Not captured'} />
                  {a.biometricDate && <Row label="Capture Date" value={a.biometricDate} />}
                  {a.lat && a.lng && (
                    <Row label="GPS Coordinates" value={`${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`} />
                  )}
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
                  <Row label="Scholarship" value={sd.scholarship || '—'} />
                  <Row label="Highest Attainment" value={sd.highestAttainment || '—'} />
                  <Row label="Graduate School" value="Carlos Hilado Memorial State University" />
                  <Row label="Prof. Eligibility" value={sd.profEligibility?.length ? sd.profEligibility.join(', ') : '—'} />
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
                  <Row label="Q1 — Status" value={
                    a.employmentStatus === 'employed' ? 'Presently Employed'
                      : a.employmentStatus === 'self-employed' ? 'Self-Employed / Freelancer'
                        : sd.neverEmployed ? 'Never Been Employed' : 'Not Currently Employed'
                  } />
                  <Row label="Q2 — Time to Hire" value={deriveTimeToHire(a)} />
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Building2 className="size-3.5" /> Q3 · FIRST JOB
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Sector" value={sd.firstJobSector || '—'} />
                  <Row label="Employment Status" value={sd.firstJobStatus || '—'} />
                  <Row label="Job Title" value={sd.firstJobTitle || a.jobTitle || '—'} />
                  <Row label="BSIS-Related" value={
                    sd.firstJobRelated === 'Yes' ? 'Yes — Related to BSIS'
                      : sd.firstJobRelated === 'No' ? 'No — Not related'
                        : a.jobAlignment === 'related' ? 'Yes — Related to BSIS'
                          : a.jobAlignment === 'not-related' ? 'No — Not related' : '—'
                  } />
                  {(sd.firstJobRelated === 'No' || a.jobAlignment === 'not-related') && (
                    <Row label="Reason (unrelated)" value={sd.firstJobUnrelatedReason || '—'} />
                  )}
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <MapPin className="size-3.5" /> Q4 · CURRENT JOB
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Sector" value={sd.currentJobSector || '—'} />
                  <Row label="Position" value={sd.currentJobPosition || a.jobTitle || '—'} />
                  <Row label="Company" value={sd.currentJobCompany || a.company || '—'} />
                  <Row label="Industry" value={a.industry || '—'} />
                  <Row label="Work Location" value={a.workLocation || '—'} />
                  <Row label="Location Type" value={deriveLocationLabel(a)} />
                  <Row label="BSIS-Related" value={
                    a.jobAlignment === 'related' ? 'Yes — Related to BSIS'
                      : a.jobAlignment === 'not-related' ? 'No — Not related' : '—'
                  } />
                </div>
              </div>

              <div>
                <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                  <Clock className="size-3.5" /> Q5–Q6 · RETENTION & JOB SOURCE
                </p>
                <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-1">
                  <Row label="Q5 — Job Retention" value={sd.jobRetention || '—'} />
                  <Row label="Q6 — Job Source" value={sd.jobSource || '—'} />
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
              {/* Core competency checklist */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[#166534] text-xs flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                    <Star className="size-3.5" /> BSIS CORE COMPETENCIES
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[#166534] text-xs" style={{ fontWeight: 700 }}>{coreCount}/12</span>
                    <div className="w-20 bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full bg-[#166534]" style={{ width: `${(coreCount / 12) * 100}%` }} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {BSIS_CORE.map(skill => {
                    const has = skills.includes(skill);
                    return (
                      <div key={skill} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${has ? 'bg-[#166534]/5 border-[#166534]/20 text-[#166534]' : 'bg-gray-50 border-gray-100 text-gray-400'
                        }`} style={{ fontWeight: has ? 600 : 400 }}>
                        {has
                          ? <CheckCircle2 className="size-3.5 shrink-0 text-[#166534]" />
                          : <div className="size-3.5 rounded-full border-2 border-gray-300 shrink-0" />}
                        <span className="leading-tight">{skill}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Additional skills */}
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

              {/* Awards */}
              {sd.awards && (
                <div>
                  <p className="text-[#166534] text-xs mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
                    <Award className="size-3.5" /> AWARDS & RECOGNITION
                  </p>
                  <p className="text-gray-700 text-sm bg-gray-50 border border-gray-100 rounded-xl p-3">{sd.awards}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-between">
          <span className="text-gray-400 text-xs">{a.email}</span>
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
  const [backendVerified, setBackendVerified] = useState<AlumniRecord[]>([]);
  const [loadingVerified, setLoadingVerified] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [search, setSearch] = useState('');
  const [filterYear, setFilterYear] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [modalAlumni, setModalAlumni] = useState<AlumniRecord | null>(null);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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

  const verifiedAlumni = useMemo(() => backendVerified.filter(a => {
    const q = search.toLowerCase();
    const matchQ = !q || String(a.name ?? '').toLowerCase().includes(q) || String(a.email ?? '').toLowerCase().includes(q) || String(a.company ?? '').toLowerCase().includes(q);
    const matchYear = filterYear === 'all' || a.graduationYear === parseInt(filterYear);
    const matchStatus = filterStatus === 'all' || a.employmentStatus === filterStatus;
    return matchQ && matchYear && matchStatus;
  }).sort((a, b) => {
    let va = (a as any)[sortField] ?? '';
    let vb = (b as any)[sortField] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  }), [backendVerified, search, filterYear, filterStatus, sortField, sortDir]);

  const handleSort = (f: string) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  };

  const SortIcon = ({ f }: { f: string }) => (
    <span className="inline-flex flex-col ml-1 opacity-60">
      <ChevronUp className={`size-2.5 -mb-0.5 ${sortField === f && sortDir === 'asc' ? 'text-[#166534] opacity-100' : ''}`} />
      <ChevronDown className={`size-2.5 ${sortField === f && sortDir === 'desc' ? 'text-[#166534] opacity-100' : ''}`} />
    </span>
  );

  const empCount = verifiedAlumni.filter(a => a.employmentStatus !== 'unemployed').length;

  return (
    <PortalLayout role="admin" pageTitle="Verified Graduates" pageSubtitle="All approved graduates with full CHED survey data">
      <div className="space-y-5">

        {fetchError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-red-700 text-xs" style={{ fontWeight: 600 }}>
              {fetchError}
            </p>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Verified', value: verifiedAlumni.length, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Employed / Self-Employed', value: empCount, icon: Briefcase, color: 'text-[#166534]', bg: 'bg-[#166534]/10' },
            { label: 'Employment Rate', value: `${verifiedAlumni.length ? Math.round(empCount / verifiedAlumni.length * 100) : 0}%`, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${s.bg} shrink-0`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.3rem', lineHeight: 1 }}>{s.value}</p>
                <p className="text-gray-500 text-xs mt-0.5 truncate">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input type="text" placeholder="Search name, email, company…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15" />
          </div>
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#166534]">
            <option value="all">All Batches</option>
            {GRADUATION_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#166534]">
            <option value="all">All Status</option>
            <option value="employed">Employed</option>
            <option value="self-employed">Self-Employed</option>
            <option value="unemployed">Unemployed</option>
          </select>
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
              <div className="overflow-x-auto">
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
                    {verifiedAlumni.map(a => (
                      <Fragment key={a.id}>
                        <tr className="hover:bg-gray-50/60 transition">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-8 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] text-xs shrink-0"
                                style={{ fontWeight: 700 }}>
                                {a.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 600 }}>{a.name}</p>
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
                          </td>
                          <td className="px-4 py-3 max-w-[160px]">
                            <p className="text-gray-700 text-xs truncate" style={{ fontWeight: 500 }}>{a.jobTitle ?? '—'}</p>
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
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-[100px] truncate">{a.workCity ?? '—'}</td>
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
            </>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {modalAlumni && (
        <GraduateDetailModal a={modalAlumni} onClose={() => setModalAlumni(null)} />
      )}
    </PortalLayout>
  );
}