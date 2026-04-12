import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import { StatCard } from '../shared/stat-card';
import { VALID_ALUMNI, YEARLY_EMPLOYMENT_RATES, TIME_TO_HIRE_DATA, EMPLOYER_ACCOUNTS, TOP_SKILLS } from '../../data/app-data';
import {
  Users, Briefcase, Camera, Building2, TrendingUp, Map,
  BarChart2, Clock, CheckCircle2, AlertTriangle, ArrowRight,
  ClipboardCheck, Upload,
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const RECENT_ALUMNI = VALID_ALUMNI.slice(0, 7);
const pendingAlumni = VALID_ALUMNI.filter(a => a.verificationStatus === 'pending');
const verifiedAlumni = VALID_ALUMNI.filter(a => a.verificationStatus === 'verified');
const pendingEmployers = EMPLOYER_ACCOUNTS.filter(e => e.status === 'pending');

export function AdminNewDashboard() {
  const navigate = useNavigate();

  const totalRegistered = VALID_ALUMNI.length;
  // Employment stats are based on VERIFIED graduates only — pending are excluded from analytics
  const verified = VALID_ALUMNI.filter(a => a.verificationStatus === 'verified');
  const employed = verified.filter(a => a.employmentStatus === 'employed').length;
  const selfEmp = verified.filter(a => a.employmentStatus === 'self-employed').length;
  const bioCaptured = VALID_ALUMNI.filter(a => a.biometricCaptured).length;
  const empRate = verified.length > 0 ? Math.round(((employed + selfEmp) / verified.length) * 100) : 0;
  const notificationCount = pendingAlumni.length;

  const batchData = [2020, 2021, 2022, 2023, 2024, 2025].map(yr => {
    const allBatch = VALID_ALUMNI.filter(a => a.graduationYear === yr);
    const verifiedBatch = verified.filter(a => a.graduationYear === yr);
    const emp = verifiedBatch.filter(a => a.employmentStatus !== 'unemployed').length;
    return { year: String(yr), total: allBatch.length, employed: emp };
  });

  const quickLinks = [
    { icon: ClipboardCheck, label: 'Pending Verification', sub: `${pendingAlumni.length} awaiting review`, path: '/admin/unverified', color: 'text-amber-600', bg: 'bg-amber-50', badge: pendingAlumni.length },
    { icon: CheckCircle2, label: 'Verified Alumni', sub: `${verifiedAlumni.length} approved`, path: '/admin/verified', color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { icon: Building2, label: 'Employer Requests', sub: `${pendingEmployers.length} pending`, path: '/admin/employers', color: 'text-violet-600', bg: 'bg-violet-50', badge: pendingEmployers.length },
    { icon: Upload, label: 'Batch Upload', sub: 'Add new graduate IDs', path: '/admin/batch-upload', color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: Map, label: 'Geomapping', sub: 'Employment location clusters', path: '/admin/map', color: 'text-teal-600', bg: 'bg-teal-50' },
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
        {/* Alert banners */}
        {pendingAlumni.length > 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <AlertTriangle className="size-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-amber-800 text-sm" style={{ fontWeight: 600 }}>
                {pendingAlumni.length} alumni account{pendingAlumni.length !== 1 ? 's' : ''} pending verification
              </p>
              <p className="text-amber-700 text-xs mt-0.5">Review biometric submissions and approve or reject accounts.</p>
            </div>
            <button onClick={() => navigate('/admin/unverified')}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs px-3 py-1.5 rounded-lg transition shrink-0"
              style={{ fontWeight: 600 }}>
              Review Now <ArrowRight className="size-3" />
            </button>
          </div>
        )}

        {pendingEmployers.length > 0 && (
          <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl p-4">
            <Building2 className="size-5 text-violet-500 shrink-0" />
            <div className="flex-1">
              <p className="text-violet-800 text-sm" style={{ fontWeight: 600 }}>
                {pendingEmployers.length} employer access request{pendingEmployers.length !== 1 ? 's' : ''} pending
              </p>
            </div>
            <button onClick={() => navigate('/admin/employers')}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 py-1.5 rounded-lg transition shrink-0"
              style={{ fontWeight: 600 }}>
              Review <ArrowRight className="size-3" />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Registered" value={totalRegistered} sub={`${pendingAlumni.length} pending · ${verifiedAlumni.length} verified`}
            icon={Users} iconBg="bg-[#166534]/10" iconColor="text-[#166534]" />
          <StatCard label="Employment Rate" value={`${empRate}%`}
            sub={`${employed + selfEmp} of ${verified.length} verified graduates`}
            icon={Briefcase} iconBg="bg-emerald-50" iconColor="text-emerald-600"
            trend="↑ +2% vs last yr" trendUp />
          <StatCard label="Biometric Captured" value={bioCaptured}
            sub={`${Math.round(bioCaptured / totalRegistered * 100)}% of all registered`}
            icon={Camera} iconBg="bg-blue-50" iconColor="text-blue-600" />
          <StatCard label="Pending Verification" value={pendingAlumni.length}
            sub="Excl. from analytics until approved"
            icon={Clock} iconBg="bg-amber-50" iconColor="text-amber-600"
            trend={pendingAlumni.length > 0 ? 'Action needed' : undefined} trendUp={false} />
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <TrendingUp className="size-4 text-[#166534]" /> Employment Rate (2020–2025)
            </h3>
            <p className="text-gray-400 text-xs mb-4">Verified graduates only · % employed or self-employed per batch year</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={YEARLY_EMPLOYMENT_RATES}>
                <defs>
                  <linearGradient id="adminEmpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#166534" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#166534" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[60, 100]} unit="%" />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Employment Rate']} />
                <Area type="monotone" dataKey="rate" stroke="#166534" fill="url(#adminEmpGrad)" strokeWidth={2.5} dot={{ fill: '#166534', r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Clock className="size-4 text-[#166534]" /> Avg. Time-to-Hire (months)
            </h3>
            <p className="text-gray-400 text-xs mb-4">Average months from graduation to first employment</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={TIME_TO_HIRE_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="mo" />
                <Tooltip formatter={(v: any) => [`${v} months`]} />
                <Bar dataKey="avgMonths" radius={[4, 4, 0, 0]} name="Avg Months">
                  {TIME_TO_HIRE_DATA.map((entry) => (
                    <Cell
                      key={`hire-cell-${entry.year}`}
                      fill={entry.avgMonths <= 3 ? '#10b981' : entry.avgMonths <= 4.5 ? '#f59e0b' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Batch + Quick links */}
        <div className="grid lg:grid-cols-3 gap-5">
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
                <Bar key="bar-employed" dataKey="employed" name="Employed" fill="#166534" radius={[3, 3, 0, 0]} />
                <Bar key="bar-total" dataKey="total" name="Total" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
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

        {/* Recent Updates */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Recent Profile Updates</h3>
            <button onClick={() => navigate('/admin/verified')}
              className="text-[#166534] text-xs hover:underline flex items-center gap-1" style={{ fontWeight: 500 }}>
              View all <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {RECENT_ALUMNI.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2.5 hover:bg-gray-50/60 rounded-xl px-2 transition">
                <div className="flex size-8 items-center justify-center rounded-full bg-[#166534]/10 text-[#166534] text-xs shrink-0"
                  style={{ fontWeight: 700 }}>
                  {a.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 500 }}>{a.name}</p>
                  <p className="text-gray-400 text-xs truncate">Batch {a.graduationYear}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    a.verificationStatus === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`} style={{ fontWeight: 600 }}>
                    {a.verificationStatus === 'verified' ? 'Verified' : 'Pending'}
                  </span>
                  {a.biometricCaptured
                    ? <CheckCircle2 className="size-4 text-emerald-400" />
                    : <AlertTriangle className="size-4 text-amber-400" />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trending Skills */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <TrendingUp className="size-4 text-[#166534]" /> Top Trending Skills (2025 Forecast)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {TOP_SKILLS.slice(0, 5).map(s => (
              <div key={s.skill} className={`rounded-xl p-3 border ${s.trend === 'rising' ? 'bg-emerald-50 border-emerald-100' : s.trend === 'falling' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                <p className="text-xs mb-1 truncate" style={{ fontWeight: 600, color: s.trend === 'rising' ? '#065f46' : s.trend === 'falling' ? '#991b1b' : '#374151' }}>{s.skill}</p>
                <p className={`text-xs ${s.trend === 'rising' ? 'text-emerald-600' : s.trend === 'falling' ? 'text-red-500' : 'text-gray-500'}`} style={{ fontWeight: 700 }}>{s.growth}</p>
                <p className="text-gray-400 text-xs">{s.count} alumni</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}