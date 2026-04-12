import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import {
  YEARLY_EMPLOYMENT_RATES, TIME_TO_HIRE_DATA, INDUSTRY_TRENDS,
  TOP_SKILLS, VALID_ALUMNI,
} from '../../data/app-data';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, RadarChart,
  Radar, PolarGrid, PolarAngleAxis, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, Clock, Globe, Zap, BarChart2, Cpu } from 'lucide-react';

// Projected data extending 5 years
const PROJECTED_RATES = [
  ...YEARLY_EMPLOYMENT_RATES,
  { year: '2026', rate: 86, projected: true },
  { year: '2027', rate: 88, projected: true },
  { year: '2028', rate: 90, projected: true },
];

const PROJECTED_HIRE = [
  ...TIME_TO_HIRE_DATA,
  { year: '2026', avgMonths: 1.8, projected: true },
  { year: '2027', avgMonths: 1.5, projected: true },
];

const SKILL_FORECAST = [
  { skill: 'AI/ML', '2023': 28, '2024': 45, '2025F': 62, '2026F': 78 },
  { skill: 'Cloud', '2023': 42, '2024': 55, '2025F': 68, '2026F': 79 },
  { skill: 'Cybersec', '2023': 35, '2024': 48, '2025F': 60, '2026F': 71 },
  { skill: 'DevOps', '2023': 30, '2024': 42, '2025F': 54, '2026F': 65 },
  { skill: 'React/JS', '2023': 65, '2024': 72, '2025F': 76, '2026F': 80 },
  { skill: 'PHP/WP', '2023': 32, '2024': 25, '2025F': 18, '2026F': 12 },
];

const RADAR_DATA = [
  { subject: 'Employment Rate', A: 82 },
  { subject: 'BSIS Alignment', A: 68 },
  { subject: 'Biometric Comply', A: 72 },
  { subject: 'Skill Diversity', A: 65 },
  { subject: 'Avg Salary (rel)', A: 58 },
  { subject: 'Time-to-Hire', A: 75 },
];

export function AdminAnalytics() {
  const [projectionView, setProjectionView] = useState<'employment' | 'hire' | 'skills'>('employment');

  const avgHire = VALID_ALUMNI.filter(a => a.monthsToHire).reduce((s, a) => s + (a.monthsToHire ?? 0), 0)
    / VALID_ALUMNI.filter(a => a.monthsToHire).length;

  return (
    <PortalLayout role="admin" pageTitle="Analytics & Reports" pageSubtitle="Employment trend analysis and data export">
      <div className="space-y-6">
        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Projected Emp. Rate 2026', value: '86%', sub: '+4% over 2025', icon: TrendingUp, bg: 'bg-emerald-50', color: 'text-emerald-600', trend: '↑ Forecast', up: true },
            { label: 'Avg. Time-to-Hire 2025', value: `${avgHire.toFixed(1)}mo`, sub: 'Declining trend', icon: Clock, bg: 'bg-blue-50', color: 'text-blue-600', trend: '↓ Improving', up: true },
            { label: 'Fastest Growing Skill', value: 'AI/ML', sub: '+60% year-over-year', icon: Cpu, bg: 'bg-purple-50', color: 'text-purple-600' },
            { label: 'Declining Skill', value: 'PHP/WP', sub: '-14% demand drop', icon: TrendingDown, bg: 'bg-red-50', color: 'text-red-500' },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`flex size-10 items-center justify-center rounded-xl ${k.bg}`}>
                  <k.icon className={`size-5 ${k.color}`} />
                </div>
                {k.trend && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${k.up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}
                    style={{ fontWeight: 600 }}>{k.trend}</span>
                )}
              </div>
              <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1 }}>{k.value}</p>
              <p className="text-gray-500 text-sm mt-1" style={{ fontWeight: 500 }}>{k.label}</p>
              <p className="text-gray-400 text-xs mt-0.5">{k.sub}</p>
            </div>
          ))}
        </div>

        {/* Projection Tabs */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Zap className="size-4 text-[#1B3A6B]" /> Trend Projections
            </h3>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 self-start sm:self-auto">
              {(['employment', 'hire', 'skills'] as const).map(v => (
                <button key={v} onClick={() => setProjectionView(v)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs transition capitalize ${projectionView === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  style={{ fontWeight: projectionView === v ? 600 : 400 }}>
                  {v === 'hire' ? 'Time-to-Hire' : v === 'skills' ? 'Skill Demand' : 'Employment'}
                </button>
              ))}
            </div>
          </div>

          {projectionView === 'employment' && (
            <>
              <p className="text-gray-500 text-xs mb-4">Historical data (2020–2025) + AI-projected rates (2026–2028). Dashed line indicates projection boundary.</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={PROJECTED_RATES}>
                  <defs>
                    <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1B3A6B" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#1B3A6B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[60, 100]} unit="%" />
                  <Tooltip formatter={(v: any) => [`${v}%`, 'Employment Rate']} />
                  <ReferenceLine x="2025" stroke="#9ca3af" strokeDasharray="4 4" label={{ value: 'Projection →', position: 'top', fontSize: 11, fill: '#9ca3af' }} />
                  <Area type="monotone" dataKey="rate" stroke="#1B3A6B" fill="url(#projGrad)" strokeWidth={2.5}
                    dot={(props: any) => {
                      const isProj = PROJECTED_RATES.find(r => r.year === props.payload.year)?.projected;
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={isProj ? '#6b7280' : '#1B3A6B'} stroke="white" strokeWidth={2} />;
                    }} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}

          {projectionView === 'hire' && (
            <>
              <p className="text-gray-500 text-xs mb-4">Average months from graduation to first employment — declining trend indicates improving market alignment.</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={PROJECTED_HIRE}>
                  <defs>
                    <linearGradient id="hireGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="mo" domain={[0, 6]} />
                  <Tooltip formatter={(v: any) => [`${v} months`, 'Avg. Time-to-Hire']} />
                  <ReferenceLine x="2025" stroke="#9ca3af" strokeDasharray="4 4" label={{ value: 'Projection →', position: 'top', fontSize: 11, fill: '#9ca3af' }} />
                  <Area type="monotone" dataKey="avgMonths" stroke="#10b981" fill="url(#hireGrad)" strokeWidth={2.5} dot={{ fill: '#10b981', r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}

          {projectionView === 'skills' && (
            <>
              <p className="text-gray-500 text-xs mb-4">% of BSIS graduates with each skill — 2025F and 2026F are projected based on current hiring trends.</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={SKILL_FORECAST}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="skill" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="2023" fill="#e5e7eb" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="2024" fill="#1B3A6B" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="2025F" fill="#10b981" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="2026F" fill="#6ee7b7" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* Industry Trends */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Globe className="size-4 text-[#1B3A6B]" /> Industry Absorption (% of grads)
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={[
                { year: '2020', ...Object.fromEntries(INDUSTRY_TRENDS.map(i => [i.industry, i.y2020])) },
                { year: '2021', ...Object.fromEntries(INDUSTRY_TRENDS.map(i => [i.industry, i.y2021])) },
                { year: '2022', ...Object.fromEntries(INDUSTRY_TRENDS.map(i => [i.industry, i.y2022])) },
                { year: '2023', ...Object.fromEntries(INDUSTRY_TRENDS.map(i => [i.industry, i.y2023])) },
                { year: '2024', ...Object.fromEntries(INDUSTRY_TRENDS.map(i => [i.industry, i.y2024])) },
                { year: '2025', ...Object.fromEntries(INDUSTRY_TRENDS.map(i => [i.industry, i.y2025])) },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {INDUSTRY_TRENDS.map((ind, i) => (
                  <Line key={ind.industry} type="monotone" dataKey={ind.industry}
                    stroke={['#1B3A6B', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'][i]}
                    strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Program Health Radar */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <BarChart2 className="size-4 text-[#1B3A6B]" /> Program Health Index
            </h3>
            <p className="text-gray-500 text-xs mb-2">Composite score across key BSIS program indicators</p>
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={RADAR_DATA}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                <Radar dataKey="A" stroke="#1B3A6B" fill="#1B3A6B" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Skills table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <TrendingUp className="size-4 text-[#1B3A6B]" /> Skill Demand Full Analysis
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Skill', 'Alumni Count', 'Growth Rate', 'Trend', 'Forecast 2026'].map(h => (
                    <th key={h} className="text-left text-gray-400 text-xs pb-2 pr-4" style={{ fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {TOP_SKILLS.map(s => (
                  <tr key={s.skill}>
                    <td className="py-2.5 pr-4">
                      <span className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>{s.skill}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-gray-600 text-xs">{s.count} alumni</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-xs ${s.trend === 'rising' ? 'text-emerald-600' : s.trend === 'falling' ? 'text-red-500' : 'text-gray-500'}`}
                        style={{ fontWeight: 600 }}>{s.growth}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${s.trend === 'rising' ? 'bg-emerald-50 text-emerald-700' : s.trend === 'falling' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}
                        style={{ fontWeight: 600 }}>
                        {s.trend === 'rising' ? '↑ Rising' : s.trend === 'falling' ? '↓ Declining' : '→ Stable'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-gray-100 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(100, s.count / 12 * 100)}%`,
                              background: s.trend === 'rising' ? '#10b981' : s.trend === 'falling' ? '#ef4444' : '#6b7280'
                            }} />
                        </div>
                        <span className="text-gray-400 text-xs">{s.trend === 'rising' ? 'High demand' : s.trend === 'falling' ? 'Declining' : 'Stable'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}