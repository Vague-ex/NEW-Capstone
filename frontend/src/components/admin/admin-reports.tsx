import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI, GRADUATION_YEARS, YEARLY_EMPLOYMENT_RATES } from '../../data/app-data';
import {
  FileText, Download, Filter, CheckCircle2, Loader2,
  BarChart2, Users, Briefcase, FileSpreadsheet, ChevronRight,
  Calendar, Building2,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

type ReportType = 'employment-summary' | 'batch-tracer' | 'skill-demand' | 'biometric-compliance' | 'employer-engagement';

interface ReportConfig {
  title: string;
  desc: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  formats: ('PDF' | 'Excel')[];
}

const REPORT_TYPES: Record<ReportType, ReportConfig> = {
  'employment-summary': {
    title: 'Employment Summary Report',
    desc: 'Overall employment rates, status breakdown, and industry distribution across all batches.',
    icon: Briefcase, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', formats: ['PDF', 'Excel'],
  },
  'batch-tracer': {
    title: 'Graduate Tracer Study',
    desc: 'Individual-level alumni data with employment status, job titles, and company.',
    icon: Users, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', formats: ['PDF', 'Excel'],
  },
  'skill-demand': {
    title: 'Skills Demand Analysis',
    desc: 'Trending and declining technical skills among BSIS graduates with growth projections.',
    icon: BarChart2, iconBg: 'bg-purple-50', iconColor: 'text-purple-600', formats: ['PDF', 'Excel'],
  },
  'biometric-compliance': {
    title: 'Biometric Compliance Report',
    desc: 'Audit log of which alumni have completed face capture + GPS verification.',
    icon: CheckCircle2, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', formats: ['Excel'],
  },
  'employer-engagement': {
    title: 'Employer Engagement Summary',
    desc: 'List of registered and approved employer partners with access history.',
    icon: Building2, iconBg: 'bg-rose-50', iconColor: 'text-rose-600', formats: ['PDF', 'Excel'],
  },
};

export function AdminReports() {
  const [selectedReport, setSelectedReport] = useState<ReportType>('employment-summary');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterIndustry, setFilterIndustry] = useState<string>('all');
  const [generating, setGenerating] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string[]>([]);

  const industries = [...new Set(VALID_ALUMNI.map(a => a.industry).filter(Boolean))];

  const filteredData = VALID_ALUMNI.filter(a => {
    const yearMatch = filterYear === 'all' || a.graduationYear === parseInt(filterYear);
    const statusMatch = filterStatus === 'all' || a.employmentStatus === filterStatus;
    const indMatch = filterIndustry === 'all' || a.industry === filterIndustry;
    return yearMatch && statusMatch && indMatch;
  });

  const employed = filteredData.filter(a => a.employmentStatus === 'employed').length;
  const selfEmp = filteredData.filter(a => a.employmentStatus === 'self-employed').length;
  const unemployed = filteredData.filter(a => a.employmentStatus === 'unemployed').length;

  const handleGenerate = async (format: 'PDF' | 'Excel') => {
    const key = `${selectedReport}-${format}`;
    setGenerating(key);
    await new Promise(r => setTimeout(r, 2000));
    setGenerating(null);
    setGenerated(prev => [...prev, key]);
    // Simulate a file download by creating a fake anchor
    const el = document.createElement('a');
    el.href = '#';
    el.download = `CHMSU_BSIS_${selectedReport}_${filterYear}_${new Date().toISOString().split('T')[0]}.${format === 'PDF' ? 'pdf' : 'xlsx'}`;
    // Don't actually trigger navigation in demo
  };

  const batchSummary = GRADUATION_YEARS.map(yr => {
    const batch = filteredData.filter(a => a.graduationYear === yr);
    const emp = batch.filter(a => a.employmentStatus !== 'unemployed').length;
    return {
      year: String(yr),
      total: batch.length,
      employed: emp,
      rate: batch.length ? Math.round(emp / batch.length * 100) : 0,
    };
  }).filter(d => filterYear === 'all' || d.year === filterYear);

  const config = REPORT_TYPES[selectedReport];
  const isGenerating = (format: string) => generating === `${selectedReport}-${format}`;
  const wasGenerated = (format: string) => generated.includes(`${selectedReport}-${format}`);

  return (
    <PortalLayout role="admin" pageTitle="Export & Reporting" pageSubtitle="Generate PDF and Excel reports from graduate tracer data">
      <div className="space-y-5">
        {/* Banner */}
        <div className="bg-gradient-to-r from-[#1B3A6B] to-[#2a5298] rounded-2xl p-5 text-white flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white/20 shrink-0">
            <FileText className="size-6 text-white" />
          </div>
          <div>
            <h3 className="text-white" style={{ fontWeight: 700 }}>Graduate Tracer Reports</h3>
            <p className="text-white/70 text-sm mt-0.5">
              Generate formatted tracer study documents for program reporting, faculty review, and institutional data use.
              All reports are timestamped from the BSIS Graduate Tracer System database.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Left — Report Type Selector */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-gray-600 text-xs mb-3" style={{ fontWeight: 700 }}>Select Report Type</p>
            <div className="space-y-1">
              {(Object.entries(REPORT_TYPES) as [ReportType, ReportConfig][]).map(([key, r]) => (
                <button key={key} onClick={() => setSelectedReport(key)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition text-left ${selectedReport === key ? 'bg-[#1B3A6B] text-white' : 'hover:bg-gray-50 text-gray-700'}`}>
                  <div className={`flex size-8 items-center justify-center rounded-lg shrink-0 ${selectedReport === key ? 'bg-white/20' : r.iconBg}`}>
                    <r.icon className={`size-4 ${selectedReport === key ? 'text-white' : r.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate" style={{ fontWeight: 600 }}>{r.title}</p>
                    <p className={`text-xs truncate mt-0.5 ${selectedReport === key ? 'text-white/60' : 'text-gray-400'}`}>
                      {r.formats.join(' & ')}
                    </p>
                  </div>
                  <ChevronRight className={`size-3.5 shrink-0 ml-auto ${selectedReport === key ? 'text-white/60' : 'text-gray-300'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Right — Config + Preview */}
          <div className="lg:col-span-2 space-y-4">
            {/* Report header */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className={`flex size-12 items-center justify-center rounded-xl ${config.iconBg} shrink-0`}>
                  <config.icon className={`size-6 ${config.iconColor}`} />
                </div>
                <div>
                  <h3 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1rem' }}>{config.title}</h3>
                  <p className="text-gray-500 text-xs mt-0.5">{config.desc}</p>
                </div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div>
                  <label className="block text-gray-600 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    <Calendar className="size-3 inline mr-1" />Batch Year
                  </label>
                  <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-[#1B3A6B]">
                    <option value="all">All Years</option>
                    {GRADUATION_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-600 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    <Filter className="size-3 inline mr-1" />Employment Status
                  </label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-[#1B3A6B]">
                    <option value="all">All Status</option>
                    <option value="employed">Employed</option>
                    <option value="self-employed">Self-Employed</option>
                    <option value="unemployed">Unemployed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-600 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    <Building2 className="size-3 inline mr-1" />Industry
                  </label>
                  <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-[#1B3A6B]">
                    <option value="all">All Industries</option>
                    {industries.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>

              {/* Data summary */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  { label: 'Records', value: filteredData.length, color: 'text-[#1B3A6B]' },
                  { label: 'Employed', value: employed, color: 'text-emerald-600' },
                  { label: 'Self-Emp.', value: selfEmp, color: 'text-blue-600' },
                  { label: 'Unemployed', value: unemployed, color: 'text-red-500' },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className={`${s.color}`} style={{ fontWeight: 800, fontSize: '1.3rem', lineHeight: 1 }}>{s.value}</p>
                    <p className="text-gray-500 text-xs mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                {config.formats.map(fmt => (
                  <button key={fmt} onClick={() => handleGenerate(fmt)} disabled={!!generating}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition disabled:opacity-60 ${
                      wasGenerated(fmt)
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        : fmt === 'PDF'
                          ? 'bg-[#1B3A6B] hover:bg-[#163060] text-white'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                    style={{ fontWeight: 600 }}>
                    {isGenerating(fmt) ? (
                      <><Loader2 className="size-4 animate-spin" /> Generating {fmt}…</>
                    ) : wasGenerated(fmt) ? (
                      <><CheckCircle2 className="size-4" /> Download {fmt}</>
                    ) : (
                      <>{fmt === 'PDF' ? <FileText className="size-4" /> : <FileSpreadsheet className="size-4" />} Export as {fmt}</>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview chart */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <BarChart2 className="size-4 text-[#1B3A6B]" /> Report Preview — Employment by Batch
              </h3>
              {batchSummary.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={batchSummary}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v, n) => [v, n === 'employed' ? 'Employed/Self-Emp.' : 'Total']} />
                    <Bar dataKey="employed" name="employed" fill="#10b981" radius={[3, 3, 0, 0]}>
                      {batchSummary.map((_, i) => <Cell key={i} fill="#10b981" />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                  No data matching current filters
                </div>
              )}
            </div>

            {/* Recent exports */}
            {generated.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-gray-800 mb-3" style={{ fontWeight: 700 }}>Generated Files</h3>
                <div className="space-y-2">
                  {generated.map((g, i) => {
                    const [type, fmt] = g.split('-').reduce((acc: string[], cur, idx, arr) => {
                      if (idx === arr.length - 1) return [...acc, cur];
                      return idx === 0 ? [cur] : acc.length === 1 ? [acc[0] + '-' + cur] : [...acc];
                    }, []);
                    return (
                      <div key={i} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="size-4 text-emerald-500" />
                          <div>
                            <p className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                              CHMSU_BSIS_{g.replace('-PDF', '').replace('-Excel', '').toUpperCase()}.{fmt?.toLowerCase() === 'pdf' ? 'pdf' : 'xlsx'}
                            </p>
                            <p className="text-gray-400 text-xs">Generated {new Date().toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })}</p>
                          </div>
                        </div>
                        <button className="flex items-center gap-1.5 text-emerald-700 text-xs bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg transition"
                          style={{ fontWeight: 600 }}>
                          <Download className="size-3.5" /> Download
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}