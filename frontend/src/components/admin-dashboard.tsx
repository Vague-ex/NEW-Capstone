import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Users, Briefcase, UserCheck, UserX, LogOut, GraduationCap,
  Download, FileSpreadsheet, FileText, ChevronDown, Search,
  TrendingUp, Filter, ShieldCheck, RefreshCw,
  BarChart2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { VALID_ALUMNI, GRADUATION_YEARS, type AlumniRecord } from '../data/app-data';
import { StatusBadge } from './ui/status-badge';

const COLORS = {
  employed: '#16a34a',
  'self-employed': '#2563eb',
  unemployed: '#ea580c',
};

function MetricCard({
  title, value, subtitle, icon: Icon, color, bg,
}: {
  title: string; value: number | string; subtitle: string;
  icon: React.ElementType; color: string; bg: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
      <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${bg}`}>
        <Icon className={`size-5 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-gray-500 text-xs truncate">{title}</p>
        <p className="text-gray-900 mt-0.5" style={{ fontWeight: 700, fontSize: '1.6rem', lineHeight: 1.1 }}>
          {value}
        </p>
        <p className="text-gray-400 text-xs mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

function ExportToast({ visible, type, onClose }: { visible: boolean; type: string; onClose: () => void }) {
  useEffect(() => {
    if (visible) {
      const t = setTimeout(onClose, 3000);
      return () => clearTimeout(t);
    }
  }, [visible, onClose]);

  if (!visible) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 shadow-2xl text-white text-sm animate-in slide-in-from-bottom-2">
      <Download className="size-4 text-emerald-400" />
      <span>
        {type === 'excel' ? 'Excel' : 'PDF'} export initiated — file ready for download.
      </span>
    </div>
  );
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const [batchFilter, setBatchFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastType, setToastType] = useState('excel');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 8;

  useEffect(() => {
    const auth = sessionStorage.getItem('admin_authenticated');
    if (!auth) navigate('/admin/login');
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.removeItem('admin_authenticated');
    navigate('/admin/login');
  };

  const handleExport = (type: string) => {
    setToastType(type);
    setToastVisible(true);
  };

  // Filtered alumni
  const filtered = useMemo(() => {
    return VALID_ALUMNI.filter((a) => {
      const matchBatch = batchFilter === 'all' || a.graduationYear === parseInt(batchFilter);
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.studentId.toLowerCase().includes(q) ||
        (a.company || '').toLowerCase().includes(q) ||
        (a.jobTitle || '').toLowerCase().includes(q);
      return matchBatch && matchSearch;
    });
  }, [batchFilter, searchQuery]);

  // Metrics from filtered set
  const metrics = useMemo(() => {
    const total = filtered.length;
    const employed = filtered.filter((a) => a.employmentStatus === 'employed').length;
    const selfEmployed = filtered.filter((a) => a.employmentStatus === 'self-employed').length;
    const unemployed = filtered.filter((a) => a.employmentStatus === 'unemployed').length;
    const rate = total > 0 ? Math.round(((employed + selfEmployed) / total) * 100) : 0;
    return { total, employed, selfEmployed, unemployed, rate };
  }, [filtered]);

  // Pie data
  const pieData = [
    { name: 'Employed', value: metrics.employed, color: COLORS.employed },
    { name: 'Self-Employed', value: metrics.selfEmployed, color: COLORS['self-employed'] },
    { name: 'Unemployed', value: metrics.unemployed, color: COLORS.unemployed },
  ].filter((d) => d.value > 0);

  // Bar data per batch year
  const barData = useMemo(() => {
    const years = batchFilter === 'all' ? GRADUATION_YEARS : [parseInt(batchFilter)];
    return years.map((y) => {
      const yearAlumni = VALID_ALUMNI.filter((a) => a.graduationYear === y);
      return {
        year: `'${String(y).slice(2)}`,
        Employed: yearAlumni.filter((a) => a.employmentStatus === 'employed').length,
        'Self-Employed': yearAlumni.filter((a) => a.employmentStatus === 'self-employed').length,
        Unemployed: yearAlumni.filter((a) => a.employmentStatus === 'unemployed').length,
      };
    });
  }, [batchFilter]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / rowsPerPage);
  const paginatedRows = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [batchFilter, searchQuery]);

  const industryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filtered
      .filter((a) => a.industry)
      .forEach((a) => {
        map[a.industry!] = (map[a.industry!] || 0) + 1;
      });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [filtered]);

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      {/* Top Nav */}
      <header className="bg-[#166534] sticky top-0 z-50 shadow-lg">
        <div className="max-w-screen-xl mx-auto px-4 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-white/20">
              <GraduationCap className="size-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <p className="text-white text-sm" style={{ fontWeight: 700 }}>CHMSU Talisay</p>
              <p className="text-white/60 text-xs -mt-0.5">BSIS Alumni Monitoring System</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
              <ShieldCheck className="size-3.5 text-yellow-300" />
              <span className="text-white/90 text-xs" style={{ fontWeight: 500 }}>Program Chair</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-white/80 hover:text-white text-xs transition"
            >
              <LogOut className="size-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-gray-800" style={{ fontWeight: 700, fontSize: '1.4rem' }}>
              Employment Analytics Dashboard
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              BSIS Graduate Employability — AACCUP Accreditation Data
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport('excel')}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-white text-sm transition shadow-sm"
              style={{ fontWeight: 500 }}
            >
              <FileSpreadsheet className="size-4" />
              Export Excel
            </button>
            <button
              onClick={() => handleExport('pdf')}
              className="flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2 text-white text-sm transition shadow-sm"
              style={{ fontWeight: 500 }}
            >
              <FileText className="size-4" />
              Export PDF
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2 flex-1 sm:max-w-xs">
            <Search className="size-4 text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Search alumni, company, title…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-sm text-gray-700 bg-transparent outline-none placeholder-gray-400"
            />
          </div>
          <div className="relative inline-flex items-center">
            <Filter className="absolute left-3 size-3.5 text-gray-400" />
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="appearance-none rounded-xl border border-gray-100 bg-white shadow-sm pl-9 pr-9 py-2 text-sm text-gray-700 outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10 cursor-pointer"
            >
              <option value="all">All Batch Years</option>
              {GRADUATION_YEARS.map((y) => (
                <option key={y} value={y}>Batch {y}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-gray-400" />
          </div>
          {(batchFilter !== 'all' || searchQuery) && (
            <button
              onClick={() => { setBatchFilter('all'); setSearchQuery(''); }}
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm transition"
            >
              <RefreshCw className="size-3.5" />
              Clear filters
            </button>
          )}
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Registered Alumni"
            value={metrics.total}
            subtitle={batchFilter === 'all' ? 'All batch years' : `Batch ${batchFilter}`}
            icon={Users}
            color="text-[#166534]"
            bg="bg-[#166534]/10"
          />
          <MetricCard
            title="Employed"
            value={metrics.employed}
            subtitle={`${metrics.total > 0 ? Math.round((metrics.employed / metrics.total) * 100) : 0}% of total`}
            icon={Briefcase}
            color="text-emerald-600"
            bg="bg-emerald-100"
          />
          <MetricCard
            title="Self-Employed"
            value={metrics.selfEmployed}
            subtitle={`${metrics.total > 0 ? Math.round((metrics.selfEmployed / metrics.total) * 100) : 0}% of total`}
            icon={UserCheck}
            color="text-teal-600"
            bg="bg-teal-100"
          />
          <MetricCard
            title="Unemployed"
            value={metrics.unemployed}
            subtitle={`${metrics.total > 0 ? Math.round((metrics.unemployed / metrics.total) * 100) : 0}% of total`}
            icon={UserX}
            color="text-orange-600"
            bg="bg-orange-100"
          />
        </div>

        {/* Employment Rate Banner */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-white/20">
              <TrendingUp className="size-6 text-white" />
            </div>
            <div>
              <p className="text-white/70 text-sm">Overall Employment Rate</p>
              <p className="text-white" style={{ fontWeight: 700, fontSize: '1.8rem', lineHeight: 1.1 }}>
                {metrics.rate}%
              </p>
            </div>
          </div>
          <div className="w-full sm:w-64">
            <div className="flex justify-between text-white/70 text-xs mb-1.5">
              <span>Employed + Self-Employed</span>
              <span>{metrics.employed + metrics.selfEmployed} / {metrics.total}</span>
            </div>
            <div className="h-2 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                style={{ width: `${metrics.rate}%` }}
              />
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Pie Chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="size-2 rounded-full bg-[#166534]" />
              <h3 className="text-gray-700" style={{ fontWeight: 600 }}>Status Distribution</h3>
            </div>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,.1)', fontSize: '13px' }}
                    formatter={(val: number, name: string) => [`${val} alumni`, name]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ fontSize: '12px', color: '#6b7280' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[230px] items-center justify-center text-gray-400 text-sm">
                No data for this filter
              </div>
            )}
          </div>

          {/* Bar Chart */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="size-4 text-[#166534]" />
              <h3 className="text-gray-700" style={{ fontWeight: 600 }}>Alumni by Batch Year</h3>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={barData} barSize={14} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,.1)', fontSize: '12px' }}
                />
                <Bar dataKey="Employed" fill={COLORS.employed} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Self-Employed" fill={COLORS['self-employed']} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Unemployed" fill={COLORS.unemployed} radius={[3, 3, 0, 0]} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ fontSize: '12px', color: '#6b7280' }}>{value}</span>}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Row: Table + Industry Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Table */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-gray-800" style={{ fontWeight: 600 }}>Alumni Records</h3>
                <p className="text-gray-400 text-xs">{filtered.length} records found</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    {['Student ID', 'Name', 'Batch', 'Status', 'Company / Position', 'Updated'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs text-gray-400 whitespace-nowrap"
                        style={{ fontWeight: 600, letterSpacing: '0.03em' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                        No alumni records match your search.
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((a: AlumniRecord) => (
                      <tr key={a.id} className="hover:bg-gray-50/70 transition group">
                        <td className="px-4 py-3 text-gray-500 text-xs font-mono whitespace-nowrap">{a.studentId}</td>
                        <td className="px-4 py-3">
                          <p className="text-gray-800" style={{ fontWeight: 500 }}>{a.name}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{a.graduationYear}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={a.employmentStatus} size="sm" />
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          {a.jobTitle ? (
                            <div>
                              <p className="text-gray-700 text-xs truncate" style={{ fontWeight: 500 }}>{a.jobTitle}</p>
                              <p className="text-gray-400 text-xs truncate">{a.company}</p>
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs italic">
                              {a.unemploymentReason ? a.unemploymentReason.substring(0, 28) + '…' : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                          {new Date(a.dateUpdated).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <p className="text-gray-400 text-xs">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-500 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`size-7 rounded-lg text-xs transition ${
                        p === currentPage
                          ? 'bg-[#166534] text-white'
                          : 'text-gray-500 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-500 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Industry Breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div>
              <h3 className="text-gray-800" style={{ fontWeight: 600 }}>Top Industries</h3>
              <p className="text-gray-400 text-xs">Among employed alumni</p>
            </div>
            {industryBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-gray-400 text-xs">
                No industry data
              </div>
            ) : (
              <div className="space-y-3">
                {industryBreakdown.map(([industry, count], idx) => {
                  const total = filtered.filter((a) => a.industry).length;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  const barColors = ['bg-[#166534]', 'bg-emerald-500', 'bg-teal-500', 'bg-green-500', 'bg-lime-500'];
                  return (
                    <div key={industry}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-600 text-xs truncate mr-2" style={{ maxWidth: '70%' }}>{industry}</span>
                        <span className="text-gray-400 text-xs shrink-0">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColors[idx % barColors.length]} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-gray-100">
              <p className="text-gray-400 text-xs mb-2">Job Alignment</p>
              {(() => {
                const employed = filtered.filter((a) => a.jobAlignment);
                const related = employed.filter((a) => a.jobAlignment === 'related').length;
                const total = employed.length;
                const pct = total > 0 ? Math.round((related / total) * 100) : 0;
                return (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600">Related to BSIS</span>
                      <span className="text-[#166534]" style={{ fontWeight: 600 }}>{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#166534] transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-gray-400 text-xs mt-1">{related} of {total} employed alumni</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </main>

      <ExportToast
        visible={toastVisible}
        type={toastType}
        onClose={() => setToastVisible(false)}
      />
    </div>
  );
}