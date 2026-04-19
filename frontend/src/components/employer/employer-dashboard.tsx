import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import { StatCard } from '../shared/stat-card';
import {
  ApiClientError,
  fetchEmployerAccountStatus,
  fetchEmployerVerifiableGraduates,
  type EmployerVerifiableGraduateResponse,
} from '../../app/api-client';
import {
  Users, CheckCircle2, TrendingUp, Search, Briefcase,
  ArrowRight, BarChart2, Building2, UserX, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const PIE_COLORS = ['#166534', '#22c55e', '#ef4444'];

export function EmployerDashboard() {
  const navigate = useNavigate();
  const [employer, setEmployer] = useState<Record<string, unknown>>(() => {
    const rawUser = sessionStorage.getItem('employer_user');
    return rawUser ? JSON.parse(rawUser) : { company: 'Accenture Philippines' };
  });
  const [myAlumni, setMyAlumni] = useState<EmployerVerifiableGraduateResponse[]>([]);
  const [loadingAlumni, setLoadingAlumni] = useState(true);
  const [alumniError, setAlumniError] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const employerId = String(employer?.id ?? '').trim();
  const employerCompany = String(employer?.company ?? employer?.companyName ?? 'Accenture Philippines');
  const employerStatus = String(employer?.status ?? '').toLowerCase();
  const isPendingEmployer = employerStatus === 'pending';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncViewport = () => {
      setIsMobileViewport(window.innerWidth < 640);
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);

    return () => {
      window.removeEventListener('resize', syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!employerId) {
      return;
    }

    let active = true;

    const syncEmployerStatus = async () => {
      try {
        const latest = await fetchEmployerAccountStatus(employerId);
        if (!active || !latest || Object.keys(latest).length === 0) {
          return;
        }

        setEmployer((current) => {
          const normalizedStatus = String(
            latest.status
            ?? latest.accountStatus
            ?? current.status
            ?? '',
          ).toLowerCase();

          const normalizedCompany = String(
            latest.company
            ?? latest.companyName
            ?? current.company
            ?? current.companyName
            ?? 'Accenture Philippines',
          );

          const merged = {
            ...current,
            ...latest,
            company: normalizedCompany,
            status: normalizedStatus,
          };

          sessionStorage.setItem('employer_user', JSON.stringify(merged));
          return merged;
        });
      } catch {
        // Keep session state when live account-status sync is temporarily unavailable.
      }
    };

    const handleFocus = () => {
      void syncEmployerStatus();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncEmployerStatus();
      }
    };

    void syncEmployerStatus();
    const intervalId = window.setInterval(() => {
      void syncEmployerStatus();
    }, 30000);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [employerId]);

  useEffect(() => {
    let active = true;

    const loadEmployerAlumni = async () => {
      setLoadingAlumni(true);
      setAlumniError('');

      try {
        const records = await fetchEmployerVerifiableGraduates();
        if (!active) {
          return;
        }

        // Business rule: only currently employed alumni should be counted/displayed.
        const employedOnly = records.filter(
          (record) => String(record.employmentStatus ?? '').toLowerCase() === 'employed',
        );
        setMyAlumni(employedOnly);
      } catch (err) {
        if (!active) {
          return;
        }

        if (err instanceof ApiClientError) {
          if (err.status === 401) {
            setAlumniError('Your employer session expired. Please sign in again.');
          } else if (err.status === 403) {
            setAlumniError(
              err.message || 'Your account cannot access currently employed alumni data right now.',
            );
          } else {
            setAlumniError(err.message || 'Unable to load currently employed alumni right now.');
          }
        } else {
          setAlumniError('Unable to load currently employed alumni right now.');
        }

        setMyAlumni([]);
      } finally {
        if (active) {
          setLoadingAlumni(false);
        }
      }
    };

    const handleFocus = () => {
      void loadEmployerAlumni();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadEmployerAlumni();
      }
    };

    void loadEmployerAlumni();
    const intervalId = window.setInterval(() => {
      void loadEmployerAlumni();
    }, 30000);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [employerCompany]);

  const employed = myAlumni.length;
  const selfEmp = 0;
  const unemployed = 0;
  const total = myAlumni.length;

  // Skill distribution from myAlumni
  const skillMap: Record<string, number> = {};
  myAlumni.forEach(a => {
    (a.skills ?? []).forEach(s => {
      skillMap[s] = (skillMap[s] ?? 0) + 1;
    });
  });
  const skillData = Object.entries(skillMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  const formatSkillLabel = (label: string) => {
    const value = String(label ?? '');
    const maxChars = isMobileViewport ? 12 : 20;
    return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
  };

  const pieData = [
    { name: 'Employed', value: employed },
    { name: 'Self-Employed', value: selfEmp },
    { name: 'Unemployed', value: unemployed },
  ].filter(d => d.value > 0);

  // For demo: if no alumni found, show sample data indicator
  const hasAlumni = myAlumni.length > 0;

  return (
    <PortalLayout role="employer" pageTitle="Employer Dashboard" pageSubtitle={`Welcome, ${employerCompany}`}>
      <div className="space-y-6">
        {isPendingEmployer && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-800 text-sm" style={{ fontWeight: 700 }}>
                Employer account pending admin verification
              </p>
              <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
                You can continue the graduate verification workflow, but all submitted verification data is placed on hold.
                Held submissions are excluded from analytics and only applied after admin approval.
              </p>
            </div>
          </div>
        )}

        {/* Welcome Banner */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-6 text-white relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-40 opacity-10"
            style={{ background: 'radial-gradient(circle at 100% 50%, white 0%, transparent 70%)' }} />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="size-5 text-emerald-200" />
                <h2 className="text-white" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{employerCompany}</h2>
              </div>
              <p className="text-emerald-100 text-sm">
                Showing data for <span style={{ fontWeight: 600 }}>{total} BSIS alumni</span> currently employed at your company.
              </p>
              <p className="text-emerald-200 text-xs mt-1">
                {isPendingEmployer
                  ? 'Verification submissions are accepted and held until admin approval.'
                  : 'Employer records are synced from the Employment Verification tool.'}
              </p>
            </div>
            <button onClick={() => navigate('/employer/verify')}
              className="flex items-center gap-2 bg-white text-[#166534] px-5 py-2.5 rounded-xl text-sm hover:bg-green-50 transition shrink-0"
              style={{ fontWeight: 600 }}>
              <Search className="size-4" /> Verify Employment
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Currently Employed Alumni" value={total} sub="At your company"
            icon={Users} iconBg="bg-green-50" iconColor="text-green-700" />
          <StatCard label="Employment Match" value={employed}
            sub={total > 0 ? 'Verified employed records' : 'No data'}
            icon={Briefcase} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
          <StatCard label="Skills on File" value={Object.keys(skillMap).length}
            sub="Across your alumni"
            icon={TrendingUp} iconBg="bg-green-50" iconColor="text-green-700" />
          <StatCard label="Avg. Verification"
            value={total > 0 ? `${Math.round((myAlumni.filter(a => a.biometricCaptured).length / total) * 100)}%` : '—'}
            sub="Biometric verified"
            icon={CheckCircle2} iconBg="bg-amber-50" iconColor="text-amber-600" />
        </div>

        {loadingAlumni ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <span className="inline-block size-8 border-2 border-[#166534]/20 border-t-[#166534] rounded-full animate-spin mb-3" />
            <p className="text-gray-700 text-sm" style={{ fontWeight: 600 }}>Loading currently employed alumni…</p>
            <p className="text-gray-400 text-xs mt-1">Fetching live employer employment records.</p>
          </div>
        ) : alumniError ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-red-700 text-sm" style={{ fontWeight: 700 }}>
                  Unable to load currently employed alumni
                </p>
                <p className="text-red-600 text-xs mt-0.5 leading-relaxed">{alumniError}</p>
              </div>
            </div>
          </div>
        ) : hasAlumni ? (
          <>
            <div className="grid lg:grid-cols-2 gap-5">
              {/* Skills Distribution */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <BarChart2 className="size-4 text-[#166534]" /> Skills Distribution
                </h3>
                <p className="text-gray-500 text-xs mb-4">Skills held by your company's BSIS alumni</p>
                {skillData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={isMobileViewport ? 240 : 220}>
                    <BarChart
                      data={skillData}
                      layout="vertical"
                      margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: isMobileViewport ? 10 : 11 }}
                        allowDecimals={false}
                      />
                      <YAxis
                        dataKey="name"
                        type="category"
                        tick={{ fontSize: isMobileViewport ? 9 : 11 }}
                        tickFormatter={formatSkillLabel}
                        width={isMobileViewport ? 72 : 104}
                      />
                      <Tooltip formatter={(v) => [`${v} alumni`, 'Count']} />
                      <Bar dataKey="value" fill="#15803d" radius={[0, 4, 4, 0]} name="Alumni" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <BarChart2 className="size-10 text-gray-200 mb-2" />
                    <p className="text-gray-400 text-sm">No skills data available</p>
                  </div>
                )}
              </div>

              {/* Employment Breakdown */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Users className="size-4 text-[#166534]" /> Employment Status
                </h3>
                <p className="text-gray-500 text-xs mb-4">Currently employed records at your company</p>
                {pieData.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="55%" height={180}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                          dataKey="value" paddingAngle={3}>
                          {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => [`${v} alumni`]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-3 flex-1">
                      {pieData.map((d, i) => (
                        <div key={d.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                            <span className="text-gray-700 text-xs">{d.name}</span>
                          </div>
                          <span className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>
                            {d.value} <span className="text-gray-400" style={{ fontWeight: 400 }}>
                              ({total > 0 ? Math.round(d.value / total * 100) : 0}%)
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <Users className="size-10 text-gray-200 mb-2" />
                    <p className="text-gray-400 text-sm">No employment data</p>
                  </div>
                )}
              </div>
            </div>

            {/* Alumni list for this company */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-800" style={{ fontWeight: 700 }}>
                  Currently Employed BSIS Alumni ({total})
                </h3>
                <button onClick={() => navigate('/employer/verify')}
                  className="flex items-center gap-1.5 bg-[#166534] hover:bg-[#14532d] text-white text-xs px-3 py-1.5 rounded-lg transition"
                  style={{ fontWeight: 600 }}>
                  <Search className="size-3.5" /> Verify
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {myAlumni.map(a => (
                  <div key={String(a.id ?? `${a.name}-${a.email}`)} className="flex items-center gap-3 py-2.5 hover:bg-gray-50/60 rounded-xl px-2 transition">
                    <div className="flex size-9 items-center justify-center rounded-full bg-green-50 text-green-700 text-xs shrink-0"
                      style={{ fontWeight: 700 }}>
                      {String(a.name ?? 'Unknown').split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 500 }}>{a.name ?? 'Unknown Graduate'}</p>
                      <p className="text-gray-400 text-xs truncate">{a.jobTitle ?? '—'} · Batch {a.graduationYear ?? '—'}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${a.verificationStatus === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`} style={{ fontWeight: 600 }}>
                      {a.verificationStatus === 'verified' ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* No alumni linked to this company yet */
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-gray-100 mx-auto mb-4">
              <UserX className="size-8 text-gray-400" />
            </div>
            <h3 className="text-gray-700 mb-2" style={{ fontWeight: 700 }}>No alumni linked yet</h3>
            <p className="text-gray-500 text-sm max-w-sm mx-auto mb-6">
              No BSIS alumni are currently employed at <span style={{ fontWeight: 600 }}>{employerCompany}</span> yet.
              Alumni must update their Employment Details in their dashboard for data to appear here.
            </p>
            <button onClick={() => navigate('/employer/verify')}
              className="flex items-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-5 py-2.5 rounded-xl text-sm mx-auto transition"
              style={{ fontWeight: 600 }}>
              <Search className="size-4" /> Verify an Alumni <ArrowRight className="size-4" />
            </button>
          </div>
        )}

        {/* Verification CTA */}
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="size-5 text-[#166534] mt-0.5 shrink-0" />
            <div>
              <p className="text-green-800 text-sm" style={{ fontWeight: 600 }}>Need to verify an applicant?</p>
              <p className="text-green-700 text-xs mt-0.5">
                Search by name or Student ID, confirm employment, and leave an endorsement.
              </p>
            </div>
          </div>
          <button onClick={() => navigate('/employer/verify')}
            className="flex items-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-5 py-2.5 rounded-xl text-sm transition shrink-0"
            style={{ fontWeight: 600 }}>
            Employment Verification <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </PortalLayout>
  );
}