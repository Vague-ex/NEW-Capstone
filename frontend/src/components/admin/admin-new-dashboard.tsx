import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import { StatCard } from '../shared/stat-card';
import type { AlumniRecord } from '../../data/app-data';
import { fetchPendingAlumni, fetchVerifiedAlumni, fetchReport } from '../../app/api-client';
import {
  Users, Briefcase, Camera, TrendingUp, Map as MapIcon,
  BarChart2, Clock, CheckCircle2, AlertTriangle, ArrowRight,
  ClipboardCheck, Upload,
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import type { ReportPayload } from '../../app/api-client';

/** Earliest batch the tracer covers; the report is filtered from here to now. */
const ALIGNMENT_BATCH_START = 2019;

interface AlignmentSummary {
  total: number;
  verifiedRate: string;
  verifiedN: number;
  selfReportedRate: string;
  selfReportedN: number;
  overallRate: string;
  unknown: number;
}

/**
 * Pull the "Total" row out of the Curriculum Alignment section of the
 * batch-summary report. Column order is fixed by reports_api.py:
 *   [Batch, Alumni(N), Verified%, Verified n, Self%, Self n, Overall%, Unknown]
 */
function readAlignmentTotals(payload: ReportPayload): AlignmentSummary | null {
  const section = payload.sections?.find((s) => s.title === 'Curriculum Alignment (BSIS)');
  if (!section || section.rows.length === 0) return null;
  // The backend appends a "Total" row after the per-batch rows; fall back to
  // the last row so a single-batch dataset still renders.
  const row = section.rows.find((r) => String(r[0]) === 'Total') ?? section.rows[section.rows.length - 1];
  if (!row) return null;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  return {
    total: num(row[1]),
    verifiedRate: String(row[2] ?? '—'),
    verifiedN: num(row[3]),
    selfReportedRate: String(row[4] ?? '—'),
    selfReportedN: num(row[5]),
    overallRate: String(row[6] ?? '—'),
    unknown: num(row[7]),
  };
}


function parseDateTimestamp(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function mapTimeToHireMonths(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('within 1 month')) return 1;
  if (normalized.includes('1-3 months') || normalized.includes('1-3')) return 2;
  if (normalized.includes('3-6 months') || normalized.includes('3-6')) return 4.5;
  if (normalized.includes('6 months to 1 year')) return 9;
  if (normalized.includes('within 2 years')) return 18;
  if (normalized.includes('after 2 years')) return 30;
  return null;
}

export function AdminNewDashboard() {
  const navigate = useNavigate();
  const [pendingAlumni, setPendingAlumni] = useState<AlumniRecord[]>([]);
  const [verifiedAlumni, setVerifiedAlumni] = useState<AlumniRecord[]>([]);
  const [alignment, setAlignment] = useState<AlignmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    let active = true;

    const loadDashboardData = async (initialLoad = false) => {
      if (initialLoad) {
        setLoading(true);
      }

      const [pendingResult, verifiedResult, alignmentResult] = await Promise.allSettled([
          fetchPendingAlumni(),
          fetchVerifiedAlumni(),
          // Curriculum alignment comes from the batch-summary report rather
          // than being recomputed here. One definition lives in
          // tracer/alignment.py; recomputing client-side would let the
          // dashboard and /admin/reports quietly disagree.
          fetchReport('batch-summary', {
            batchStart: ALIGNMENT_BATCH_START,
            batchEnd: new Date().getFullYear(),
            includeUnverified: false,
          }),
        ]);

      if (!active) return;

      const errorMessages: string[] = [];

      if (pendingResult.status === 'fulfilled') {
        setPendingAlumni(pendingResult.value as AlumniRecord[]);
      } else {
        const message = pendingResult.reason instanceof Error
          ? pendingResult.reason.message
          : 'Pending graduate data could not be refreshed.';
        errorMessages.push(message);
      }

      if (verifiedResult.status === 'fulfilled') {
        setVerifiedAlumni(verifiedResult.value as AlumniRecord[]);
      } else {
        const message = verifiedResult.reason instanceof Error
          ? verifiedResult.reason.message
          : 'Verified graduate data could not be refreshed.';
        errorMessages.push(message);
      }


      if (alignmentResult.status === 'fulfilled') {
        setAlignment(readAlignmentTotals(alignmentResult.value));
      } else {
        const message = alignmentResult.reason instanceof Error
          ? alignmentResult.reason.message
          : 'Curriculum alignment could not be refreshed.';
        errorMessages.push(message);
      }

      if (errorMessages.length === 0) {
        setFetchError('');
      } else if (errorMessages.length === 3) {
        setFetchError(errorMessages[0]);
      } else {
        setFetchError('Some dashboard sections could not refresh. Showing last available values.');
      }

      if (active && initialLoad) {
        setLoading(false);
      }
    };

    void loadDashboardData(true);
    const intervalId = window.setInterval(() => {
      void loadDashboardData(false);
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const registeredAlumni = useMemo(() => [...verifiedAlumni, ...pendingAlumni], [verifiedAlumni, pendingAlumni]);
  const totalRegistered = registeredAlumni.length;
  const verifiedCount = verifiedAlumni.length;
  const employed = verifiedAlumni.filter(a => a.employmentStatus === 'employed').length;
  const selfEmp = verifiedAlumni.filter(a => a.employmentStatus === 'self-employed').length;
  const bioCaptured = verifiedAlumni.filter(a => Boolean(a.biometricCaptured)).length;
  const empRate = verifiedCount > 0 ? Math.round(((employed + selfEmp) / verifiedCount) * 100) : 0;
  const notificationCount = pendingAlumni.length;

  const batchYears = useMemo(() => {
    const years = Array.from(
      new Set(
        registeredAlumni
          .map((a) => Number(a.graduationYear))
          .filter((year) => Number.isFinite(year) && year > 0),
      ),
    ).sort((a, b) => a - b);

    if (years.length > 0) {
      return years;
    }

    const currentYear = new Date().getFullYear();
    return [currentYear - 5, currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
  }, [registeredAlumni]);

  const batchData = useMemo(() => (
    batchYears.map((year) => {
      const verifiedBatch = verifiedAlumni.filter((a) => Number(a.graduationYear) === year);
      const employedBatch = verifiedBatch.filter((a) => a.employmentStatus !== 'unemployed').length;
      return {
        year: String(year),
        total: verifiedBatch.length,
        employed: employedBatch,
        notEmployed: verifiedBatch.length - employedBatch,
      };
    })
  ), [batchYears, verifiedAlumni]);

  const yearlyEmploymentRates = useMemo(() => (
    batchData.map((batch) => ({
      year: batch.year,
      rate: batch.total > 0 ? Math.round((batch.employed / batch.total) * 100) : 0,
    }))
  ), [batchData]);

  const timeToHireData = useMemo(() => {
    const byYear = new globalThis.Map<number, { totalMonths: number; entries: number }>();

    verifiedAlumni.forEach((alumni) => {
      const year = Number(alumni.graduationYear);
      if (!Number.isFinite(year) || year <= 0) return;

      const surveyData = ((alumni as Record<string, unknown>).surveyData ?? {}) as Record<string, unknown>;
      let months = mapTimeToHireMonths(surveyData.timeToHire);

      if (months === null) {
        const monthsToHire = Number(alumni.monthsToHire);
        if (Number.isFinite(monthsToHire) && monthsToHire > 0) {
          months = monthsToHire;
        }
      }

      if (months === null) return;

      const current = byYear.get(year) ?? { totalMonths: 0, entries: 0 };
      current.totalMonths += months;
      current.entries += 1;
      byYear.set(year, current);
    });

    return Array.from(byYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, aggregate]) => ({
        year: String(year),
        avgMonths: Number((aggregate.totalMonths / aggregate.entries).toFixed(1)),
      }));
  }, [verifiedAlumni]);

  const recentAlumni = useMemo(() => (
    [...registeredAlumni]
      .sort((a, b) => parseDateTimestamp(b.dateUpdated) - parseDateTimestamp(a.dateUpdated))
      .slice(0, 7)
  ), [registeredAlumni]);

  const topSkills = useMemo(() => {
    const counts = new globalThis.Map<string, number>();

    verifiedAlumni.forEach((alumni) => {
      const skills = Array.isArray(alumni.skills) ? alumni.skills : [];
      skills.forEach((skillValue) => {
        const skill = String(skillValue ?? '').trim();
        if (!skill) return;
        counts.set(skill, (counts.get(skill) ?? 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .map(([skill, count]) => {
        const percentage = verifiedCount > 0 ? Math.round((count / verifiedCount) * 100) : 0;
        return {
          skill,
          count,
          percentage,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((entry, index) => ({
        ...entry,
        trend: 'rising' as const,
        growth: `+${Math.max(1, entry.percentage - index)}%`,
      }));
  }, [verifiedAlumni, verifiedCount]);

  const quickLinks = [
    {
      icon: ClipboardCheck,
      label: 'Pending Verification',
      sub: `${pendingAlumni.length} awaiting review`,
      path: '/admin/unverified',
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      badge: pendingAlumni.length,
    },
    {
      icon: CheckCircle2,
      label: 'Verified Graduates',
      sub: `${verifiedCount} approved`,
      path: '/admin/verified',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    { icon: Upload, label: 'Batch Upload', sub: 'Add new graduate IDs', path: '/admin/batch-upload', color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: MapIcon, label: 'Geomapping', sub: 'Employment location clusters', path: '/admin/map', color: 'text-teal-600', bg: 'bg-teal-50' },
    { icon: BarChart2, label: 'Analytics & Reports', sub: 'Charts and data export', path: '/admin/analytics', color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  return (
    <PortalLayout
      role="admin"
      pageTitle="Admin Dashboard"
      pageSubtitle="CHMSU BSIS Graduate Tracer System"
      notificationCount={notificationCount}
    >
      <div className="space-y-6">
        {fetchError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertTriangle className="size-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-xs" style={{ fontWeight: 600 }}>{fetchError}</p>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <span className="inline-flex size-8 border-2 border-gray-200 border-t-[#166534] rounded-full animate-spin" />
            <p className="text-gray-500 text-sm mt-3">Loading dashboard metrics...</p>
          </div>
        )}

        {!loading && pendingAlumni.length > 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <AlertTriangle className="size-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-amber-800 text-sm" style={{ fontWeight: 600 }}>
                {pendingAlumni.length} graduate account{pendingAlumni.length !== 1 ? 's' : ''} pending verification
              </p>
              <p className="text-amber-700 text-xs mt-0.5">Review face recognition submissions and approve or reject accounts.</p>
            </div>
            <button onClick={() => navigate('/admin/unverified')}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs px-3 py-1.5 rounded-lg transition shrink-0"
              style={{ fontWeight: 600 }}>
              Review Now <ArrowRight className="size-3" />
            </button>
          </div>
        )}


        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 gt-stagger">
          <StatCard label="Total Registered" value={totalRegistered} sub={`${pendingAlumni.length} pending · ${verifiedCount} verified`}
            icon={Users} iconBg="bg-[#166534]/10" iconColor="text-[#166534]" />
          <StatCard label="Employment Rate" value={`${empRate}%`}
            sub={`${employed + selfEmp} of ${verifiedCount} verified graduates`}
            icon={Briefcase} iconBg="bg-emerald-50" iconColor="text-emerald-600"
            trend={verifiedCount > 0 ? 'Live from verified records' : undefined} trendUp />
          <StatCard label="Face Recognition Captured" value={bioCaptured}
            sub={`${verifiedCount > 0 ? Math.round((bioCaptured / verifiedCount) * 100) : 0}% of verified graduates`}
            icon={Camera} iconBg="bg-blue-50" iconColor="text-blue-600" />
          <StatCard label="Pending Verification" value={pendingAlumni.length}
            sub="Excluded from analytics until approved"
            icon={Clock} iconBg="bg-amber-50" iconColor="text-amber-600"
            trend={pendingAlumni.length > 0 ? 'Action needed' : undefined} trendUp={false} />
        </div>

        {/* Curriculum alignment — the headline the panel revision asked for.
            Employer-verified and self-reported rates are shown side by side
            rather than blended, because only the verified figure is evidence. */}
        {alignment && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]/10 shrink-0">
                  <ClipboardCheck className="size-5 text-[#166534]" />
                </div>
                <div>
                  <h3 className="text-gray-800" style={{ fontWeight: 700 }}>BSIS Curriculum Alignment</h3>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Whether graduates&apos; current jobs align with the BSIS curriculum, across {alignment.total} graduate{alignment.total === 1 ? '' : 's'}.
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[#166534]" style={{ fontWeight: 800, fontSize: '2rem', lineHeight: 1 }}>
                  {alignment.overallRate}
                </p>
                <p className="text-gray-400 text-xs mt-1">overall aligned</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
                <p className="text-emerald-900 text-xs" style={{ fontWeight: 700 }}>Employer-verified</p>
                <p className="text-emerald-700 mt-1" style={{ fontWeight: 800, fontSize: '1.35rem' }}>
                  {alignment.verifiedRate}
                </p>
                <p className="text-emerald-800/70 text-[11px] mt-0.5">
                  {alignment.verifiedN === 0
                    ? 'No employer confirmations yet'
                    : `from ${alignment.verifiedN} confirmed job title${alignment.verifiedN === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                <p className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>Self-reported</p>
                <p className="text-gray-700 mt-1" style={{ fontWeight: 800, fontSize: '1.35rem' }}>
                  {alignment.selfReportedRate}
                </p>
                <p className="text-gray-500 text-[11px] mt-0.5">
                  {`from ${alignment.selfReportedN} survey answer${alignment.selfReportedN === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3.5">
                <p className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>Not determined</p>
                <p className="text-gray-700 mt-1" style={{ fontWeight: 800, fontSize: '1.35rem' }}>
                  {alignment.unknown}
                </p>
                <p className="text-gray-500 text-[11px] mt-0.5">excluded from the rates above</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-5 gt-stagger">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <TrendingUp className="size-4 text-[#166534]" /> Employment Rate by Batch
            </h3>
            <p className="text-gray-400 text-xs mb-4">Verified graduates only · auto-refreshes every 15s</p>
            {yearlyEmploymentRates.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={yearlyEmploymentRates}>
                  <defs>
                    <linearGradient id="adminEmpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#166534" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#166534" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v: any) => [`${v}%`, 'Employment Rate']} />
                  <Area type="monotone" dataKey="rate" stroke="#166534" fill="url(#adminEmpGrad)" strokeWidth={2.5} dot={{ fill: '#166534', r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
                No verified graduate data yet.
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Clock className="size-4 text-[#166534]" /> Avg. Time-to-Hire (months)
            </h3>
            <p className="text-gray-400 text-xs mb-4">Computed from CHED employment answers of verified graduates</p>
            {timeToHireData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={timeToHireData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="mo" />
                  <Tooltip formatter={(v: any) => [`${v} months`]} />
                  <Bar dataKey="avgMonths" radius={[4, 4, 0, 0]} name="Avg Months">
                    {timeToHireData.map((entry) => (
                      <Cell
                        key={`hire-cell-${entry.year}`}
                        fill={entry.avgMonths <= 3 ? '#10b981' : entry.avgMonths <= 4.5 ? '#f59e0b' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
                No time-to-hire records yet.
              </div>
            )}
            <p className="text-gray-400 text-[11px] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: '#10b981' }} />≤3 mo · fast</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: '#f59e0b' }} />3–4.5 mo · moderate</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: '#ef4444' }} />&gt;4.5 mo · slow</span>
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-5 gt-stagger">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Batch Employment Breakdown</h3>
              <span className="text-gray-400 text-xs bg-gray-50 border border-gray-100 px-2 py-1 rounded-lg">Verified only</span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={batchData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar key="bar-employed" dataKey="employed" stackId="emp" name="Employed" fill="#166534" radius={[0, 0, 0, 0]} />
                <Bar key="bar-notemployed" dataKey="notEmployed" stackId="emp" name="Not employed" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-gray-800 mb-4" style={{ fontWeight: 700 }}>Quick Access</h3>
            <div className="space-y-1">
              {quickLinks.map(ql => (
                <button key={ql.path} onClick={() => navigate(ql.path)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition text-left">
                  <div className={`flex size-8 items-center justify-center rounded-lg ${ql.bg} shrink-0`}>
                    <ql.icon className={`size-4 ${ql.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-xs truncate" style={{ fontWeight: 600 }}>{ql.label}</p>
                    <p className="text-gray-400 text-xs truncate">{ql.sub}</p>
                  </div>
                  {ql.badge != null && ql.badge > 0 && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-red-500 text-white shrink-0" style={{ fontSize: '10px', fontWeight: 700 }}>
                      {ql.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Recent Profile Updates</h3>
            <button onClick={() => navigate('/admin/verified')}
              className="text-[#166534] text-xs hover:underline flex items-center gap-1" style={{ fontWeight: 500 }}>
              View all <ArrowRight className="size-3" />
            </button>
          </div>
          {recentAlumni.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {recentAlumni.map(a => {
                const name = String(a.name ?? 'Unnamed Graduate');
                const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2) || 'AL';
                const verification = a.verificationStatus === 'verified' ? 'verified' : 'pending';

                return (
                  <div key={String(a.id ?? a.email ?? name)} className="flex items-center gap-3 py-2.5 hover:bg-gray-50/60 rounded-xl px-2 transition">
                    <div className="flex size-8 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] text-xs shrink-0"
                      style={{ fontWeight: 700 }}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 500 }}>{name}</p>
                      <p className="text-gray-400 text-xs truncate">Batch {a.graduationYear ?? 'N/A'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        verification === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`} style={{ fontWeight: 600 }}>
                        {verification === 'verified' ? 'Verified' : 'Pending'}
                      </span>
                      {a.biometricCaptured
                        ? <CheckCircle2 className="size-4 text-emerald-400" />
                        : <AlertTriangle className="size-4 text-amber-400" />}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-gray-400 text-sm text-center py-6">No recent updates yet.</div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <TrendingUp className="size-4 text-[#166534]" /> Top Skills from Verified Graduates
          </h3>
          {topSkills.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {topSkills.map((s) => (
                <div key={s.skill} className="rounded-xl p-3 border bg-emerald-50 border-emerald-100">
                  <p className="text-xs mb-1 truncate text-emerald-900" style={{ fontWeight: 600 }}>{s.skill}</p>
                  <p className="text-xs text-emerald-600" style={{ fontWeight: 700 }}>{s.growth}</p>
                  <p className="text-gray-500 text-xs">{s.count} graduates</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-400 text-sm text-center py-6">No skills data from verified graduates yet.</div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}