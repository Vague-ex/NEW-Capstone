import { useState, useRef } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI, EMPLOYER_ACCOUNTS, GRADUATION_YEARS } from '../../data/app-data';
import {
  Search, Filter, Users, Building2, Camera, Upload, Download,
  CheckCircle2, XCircle, Clock, AlertTriangle, MoreVertical,
  ChevronUp, ChevronDown, Eye, UserCheck,
} from 'lucide-react';

type Tab = 'alumni' | 'employers' | 'biometric';

export function AdminRecords() {
  const [activeTab, setActiveTab] = useState<Tab>('alumni');
  const [search, setSearch] = useState('');
  const [filterYear, setFilterYear] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortField, setSortField] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [employers, setEmployers] = useState(EMPLOYER_ACCOUNTS);
  const [csvImported, setCsvImported] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredAlumni = VALID_ALUMNI
    .filter(a => {
      const q = search.toLowerCase();
      const matchQ = !q || a.name.toLowerCase().includes(q) || a.studentId.toLowerCase().includes(q) || (a.company ?? '').toLowerCase().includes(q);
      const matchYear = filterYear === 'all' || a.graduationYear === parseInt(filterYear);
      const matchStatus = filterStatus === 'all' || a.employmentStatus === filterStatus;
      return matchQ && matchYear && matchStatus;
    })
    .sort((a, b) => {
      let va = (a as any)[sortField] ?? '';
      let vb = (b as any)[sortField] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleEmployerAction = (id: string, action: 'approve' | 'reject') => {
    setEmployers(prev => prev.map(e => e.id === id ? { ...e, status: action === 'approve' ? 'approved' : 'rejected' } : e));
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setTimeout(() => setCsvImported(true), 800);
    }
  };

  const SortIcon = ({ field }: { field: string }) => (
    <span className="inline-flex flex-col ml-1">
      <ChevronUp className={`size-2.5 -mb-0.5 ${sortField === field && sortDir === 'asc' ? 'text-[#1B3A6B]' : 'text-gray-300'}`} />
      <ChevronDown className={`size-2.5 ${sortField === field && sortDir === 'desc' ? 'text-[#1B3A6B]' : 'text-gray-300'}`} />
    </span>
  );

  const TABS: { key: Tab; label: string; icon: React.ElementType; count: number }[] = [
    { key: 'alumni', label: 'Alumni Records', icon: Users, count: VALID_ALUMNI.length },
    { key: 'employers', label: 'Employer Accounts', icon: Building2, count: EMPLOYER_ACCOUNTS.length },
    { key: 'biometric', label: 'Biometric Audit', icon: Camera, count: VALID_ALUMNI.filter(a => a.biometricCaptured).length },
  ];

  return (
    <PortalLayout role="admin" pageTitle="Master User Management" pageSubtitle="Manage alumni records, employer accounts, and biometric logs">
      <div className="space-y-5">
        {/* Tab bar */}
        <div className="flex gap-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs transition ${activeTab === tab.key ? 'bg-[#1B3A6B] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              style={{ fontWeight: activeTab === tab.key ? 600 : 400 }}>
              <tab.icon className="size-3.5" />
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}
                style={{ fontSize: '10px', fontWeight: 700 }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── Alumni Records ── */}
        {activeTab === 'alumni' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-50">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input type="text" placeholder="Search name, student ID, company…" value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm placeholder-gray-400 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15" />
              </div>
              <div className="flex gap-2">
                <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-[#1B3A6B]">
                  <option value="all">All Batches</option>
                  {GRADUATION_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-[#1B3A6B]">
                  <option value="all">All Status</option>
                  <option value="employed">Employed</option>
                  <option value="self-employed">Self-Employed</option>
                  <option value="unemployed">Unemployed</option>
                </select>
              </div>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 bg-[#1B3A6B]/10 hover:bg-[#1B3A6B]/20 text-[#1B3A6B] px-3 py-2 rounded-lg text-xs transition"
                  style={{ fontWeight: 600 }}>
                  <Upload className="size-3.5" /> Import CSV
                </button>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
              </div>
            </div>

            {csvImported && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                <p className="text-emerald-700 text-xs" style={{ fontWeight: 500 }}>CSV imported successfully. New records have been added to the master list.</p>
              </div>
            )}

            <p className="px-4 py-2 text-gray-400 text-xs">{filteredAlumni.length} of {VALID_ALUMNI.length} records</p>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {[
                      { label: 'Name', field: 'name' },
                      { label: 'Student ID', field: 'studentId' },
                      { label: 'Batch', field: 'graduationYear' },
                      { label: 'Status', field: 'employmentStatus' },
                      { label: 'Company', field: 'company' },
                      { label: 'Industry', field: 'industry' },
                      { label: 'Biometric', field: 'biometricCaptured' },
                      { label: 'Updated', field: 'dateUpdated' },
                    ].map(col => (
                      <th key={col.field}
                        className="text-left text-gray-500 text-xs px-4 py-3 cursor-pointer hover:text-gray-700 whitespace-nowrap select-none"
                        style={{ fontWeight: 600 }}
                        onClick={() => handleSort(col.field)}>
                        {col.label}<SortIcon field={col.field} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredAlumni.map(a => (
                    <tr key={a.id} className="hover:bg-gray-50/70 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full bg-[#1B3A6B]/10 text-[#1B3A6B] text-xs shrink-0"
                            style={{ fontWeight: 700 }}>
                            {a.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </div>
                          <span className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>{a.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">{a.studentId}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{a.graduationYear}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          a.employmentStatus === 'employed' ? 'bg-emerald-50 text-emerald-700' :
                          a.employmentStatus === 'self-employed' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-600'
                        }`} style={{ fontWeight: 600 }}>
                          {a.employmentStatus === 'employed' ? 'Employed' : a.employmentStatus === 'self-employed' ? 'Self-Emp.' : 'Unemployed'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[140px] truncate">{a.company ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[120px] truncate">{a.industry ?? '—'}</td>
                      <td className="px-4 py-3">
                        {a.biometricCaptured
                          ? <CheckCircle2 className="size-4 text-emerald-500" />
                          : <AlertTriangle className="size-4 text-amber-400" />}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(a.dateUpdated).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Employer Accounts ── */}
        {activeTab === 'employers' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-50">
              <p className="text-gray-600 text-xs">{employers.filter(e => e.status === 'pending').length} pending approval</p>
              <div className="flex gap-2">
                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700" style={{ fontWeight: 600 }}>
                  <CheckCircle2 className="size-3" /> {employers.filter(e => e.status === 'approved').length} Approved
                </span>
                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700" style={{ fontWeight: 600 }}>
                  <Clock className="size-3" /> {employers.filter(e => e.status === 'pending').length} Pending
                </span>
                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600" style={{ fontWeight: 600 }}>
                  <XCircle className="size-3" /> {employers.filter(e => e.status === 'rejected').length} Rejected
                </span>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {employers.map(emp => (
                <div key={emp.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 hover:bg-gray-50/60 transition">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-violet-100 shrink-0">
                      <Building2 className="size-5 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-gray-800 text-sm" style={{ fontWeight: 600 }}>{emp.company}</p>
                      <p className="text-gray-500 text-xs">{emp.industry} · {emp.contact} · {emp.email}</p>
                      <p className="text-gray-400 text-xs">Applied: {new Date(emp.date).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-3 py-1 rounded-full ${
                      emp.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                      emp.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                    }`} style={{ fontWeight: 600 }}>
                      {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
                    </span>
                    {emp.status === 'pending' && (
                      <>
                        <button onClick={() => handleEmployerAction(emp.id, 'approve')}
                          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs transition"
                          style={{ fontWeight: 600 }}>
                          <UserCheck className="size-3.5" /> Approve
                        </button>
                        <button onClick={() => handleEmployerAction(emp.id, 'reject')}
                          className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs transition"
                          style={{ fontWeight: 600 }}>
                          <XCircle className="size-3.5" /> Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Biometric Audit ── */}
        {activeTab === 'biometric' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Biometric Captured', value: VALID_ALUMNI.filter(a => a.biometricCaptured).length, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: CheckCircle2 },
                { label: 'Not Captured', value: VALID_ALUMNI.filter(a => !a.biometricCaptured).length, color: 'text-amber-600', bg: 'bg-amber-50', icon: AlertTriangle },
                { label: 'Compliance Rate', value: `${Math.round(VALID_ALUMNI.filter(a => a.biometricCaptured).length / VALID_ALUMNI.length * 100)}%`, color: 'text-[#1B3A6B]', bg: 'bg-[#1B3A6B]/10', icon: Eye },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className={`flex size-10 items-center justify-center rounded-xl ${s.bg} mb-3`}>
                    <s.icon className={`size-5 ${s.color}`} />
                  </div>
                  <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1 }}>{s.value}</p>
                  <p className="text-gray-500 text-sm mt-1" style={{ fontWeight: 500 }}>{s.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <p className="text-gray-700 text-sm" style={{ fontWeight: 700 }}>Biometric Capture Audit Log</p>
                <button className="flex items-center gap-1.5 text-[#1B3A6B] text-xs bg-[#1B3A6B]/10 hover:bg-[#1B3A6B]/20 px-3 py-1.5 rounded-lg transition"
                  style={{ fontWeight: 600 }}>
                  <Download className="size-3.5" /> Export Log
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {VALID_ALUMNI.map(a => (
                  <div key={a.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50/60 transition">
                    <div className="flex size-8 items-center justify-center rounded-full bg-[#1B3A6B]/10 text-[#1B3A6B] text-xs shrink-0"
                      style={{ fontWeight: 700 }}>
                      {a.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 500 }}>{a.name}</p>
                      <p className="text-gray-400 text-xs">{a.studentId} · Batch {a.graduationYear}</p>
                    </div>
                    <div className="text-center">
                      {a.biometricCaptured ? (
                        <div>
                          <div className="flex items-center gap-1 justify-end">
                            <CheckCircle2 className="size-4 text-emerald-500" />
                            <span className="text-emerald-700 text-xs" style={{ fontWeight: 600 }}>Captured</span>
                          </div>
                          <p className="text-gray-400 text-xs">{a.biometricDate ?? a.dateUpdated}</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="size-4 text-amber-400" />
                          <span className="text-amber-600 text-xs" style={{ fontWeight: 600 }}>Pending</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
