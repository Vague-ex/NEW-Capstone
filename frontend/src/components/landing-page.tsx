"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  GraduationCap, BarChart2, ShieldCheck, ArrowRight,
  CheckCircle2, TrendingUp, FileText, Building2,
  MapPin, Eye, EyeOff, User, Lock, ChevronDown,
} from 'lucide-react';
import { VALID_ALUMNI, GRADUATION_YEARS } from '../data/app-data';
const schoolLogo = '/favicon.ico';

const FEATURES = [
  { icon: ShieldCheck, title: 'Biometric Verification', desc: 'Face capture + GPS stamp ensures authentic data and prevents fraudulent submissions.', color: 'text-green-700', bg: 'bg-green-50' },
  { icon: MapPin, title: 'Geomapping View', desc: 'Interactive employment map plots where BSIS graduates are working across the Philippines.', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { icon: TrendingUp, title: 'Predictive Analytics', desc: '5-year trend forecasts highlight rising industries and in-demand tech skills for BSIS graduates.', color: 'text-teal-600', bg: 'bg-teal-50' },
  { icon: BarChart2, title: 'Employment Analytics', desc: 'Real-time charts track employment rates by batch, industry, and job alignment.', color: 'text-orange-600', bg: 'bg-orange-50' },
  { icon: Building2, title: 'Employer Portal', desc: 'Verified companies can search graduate records and view anonymized skill trend reports.', color: 'text-rose-600', bg: 'bg-rose-50' },
  { icon: FileText, title: 'Accreditation Reports', desc: 'One-click export to PDF or Excel generates accreditation-ready tracer study reports.', color: 'text-amber-600', bg: 'bg-amber-50' },
];

const STATS = [
  { value: '25+', label: 'Registered Alumni' },
  { value: '82%', label: 'Employment Rate' },
  { value: '6', label: 'Batch Years (2020–2025)' },
  { value: '3', label: 'User Portals' },
];

type LoginTab = 'alumni' | 'employer' | 'admin';

export function LandingPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LoginTab>('alumni');
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Alumni login state
  const [studentId, setStudentId] = useState('');
  const [gradYear, setGradYear] = useState('');

  // Employer/Admin login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleAlumniLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 900));
    const found = VALID_ALUMNI.find(a => a.studentId === studentId.trim() && a.graduationYear === parseInt(gradYear));
    if (found) {
      sessionStorage.setItem('alumni_user', JSON.stringify(found));
      router.push('/alumni/dashboard');
    } else {
      setError('No matching graduate found. Check your Student ID and graduation year, or register a new account.');
    }
    setIsLoading(false);
  };

  const handleEmployerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 900));
    if (username === 'employer' && password === 'employer123') {
      sessionStorage.setItem('employer_user', JSON.stringify({ company: 'Demo Company', contact: username }));
      router.push('/employer/dashboard');
    } else {
      setError('Invalid credentials. Demo: employer / employer123');
    }
    setIsLoading(false);
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 900));
    if (username === 'admin' && password === 'chmsu2024') {
      sessionStorage.setItem('admin_authenticated', 'true');
      router.push('/admin/dashboard');
    } else {
      setError('Invalid credentials. Demo: admin / chmsu2024');
    }
    setIsLoading(false);
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  const TAB_CONFIG: Record<LoginTab, { label: string; color: string; activeBg: string }> = {
    alumni: { label: 'Alumni', color: 'text-emerald-600', activeBg: 'bg-emerald-500' },
    employer: { label: 'Employer', color: 'text-teal-600', activeBg: 'bg-teal-500' },
    admin: { label: 'Admin', color: 'text-green-700', activeBg: 'bg-green-700' },
  };

  return (
    <div className="min-h-screen bg-white">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={schoolLogo} alt="CHMSU Logo" className="size-8 rounded-full object-cover" />
            <div>
              <span className="text-[#166534] text-sm" style={{ fontWeight: 700 }}>CHMSU Talisay</span>
              <span className="text-gray-400 text-xs ml-1.5 hidden sm:inline">BSIS Graduate Tracer System</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => router.push('/register/alumni')} className="hidden sm:block px-3 py-1.5 rounded-lg text-[#166534] hover:bg-green-50 transition" style={{ fontWeight: 500 }}>Register</button>
            <button onClick={() => { setActiveTab('admin'); document.getElementById('login-form')?.scrollIntoView({ behavior: 'smooth' }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#166534]/20 text-[#166534] hover:bg-green-50 transition" style={{ fontWeight: 500 }}>
              <ShieldCheck className="size-3.5" /> Admin
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero + Login ── */}
      <section className="bg-gradient-to-br from-[#052e16] via-[#166534] to-[#15803d] min-h-[92vh] flex items-center">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-16 grid lg:grid-cols-2 gap-14 items-center w-full">
          {/* Left — Hero copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 mb-6 backdrop-blur-sm">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white/90 text-xs" style={{ fontWeight: 500 }}>AY 2025–2026</span>
            </div>
            <h1 className="text-white mb-4" style={{ fontWeight: 800, fontSize: 'clamp(2rem, 4vw, 3rem)', lineHeight: 1.15 }}>
              BSIS Graduate Tracer<br />
              <span className="text-emerald-400">& Employability</span><br />
              Tracking System
            </h1>
            <p className="text-white/70 text-base leading-relaxed max-w-md mb-8">
              The official platform for CHMSU Talisay's BSIS program — tracking alumni employment
              with biometric verification, geomapping, and predictive analytics.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mb-8">
              {['Biometric + GPS Verified', 'Accreditation-Ready Reports', 'Predictive Trend Engine'].map(t => (
                <div key={t} className="flex items-center gap-1.5 text-white/60 text-xs">
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                  {t}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {STATS.map(s => (
                <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                  <p className="text-white" style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1 }}>{s.value}</p>
                  <p className="text-white/50 text-xs mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Login Card */}
          <div id="login-form" className="w-full max-w-md mx-auto">
            <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-gray-100">
                {(Object.keys(TAB_CONFIG) as LoginTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => { setActiveTab(tab); setError(''); setUsername(''); setPassword(''); }}
                    className={`flex-1 py-3.5 text-xs transition relative ${activeTab === tab ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                    style={{ fontWeight: activeTab === tab ? 700 : 400 }}
                  >
                    {TAB_CONFIG[tab].label}
                    {activeTab === tab && (
                      <span className={`absolute bottom-0 left-0 right-0 h-0.5 ${TAB_CONFIG[tab].activeBg}`} />
                    )}
                  </button>
                ))}
              </div>

              <div className="p-7">
                {/* Header */}
                <div className="mb-5">
                  {activeTab === 'alumni' && (
                    <>
                      <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 mb-3">
                        <GraduationCap className="size-5 text-emerald-600" />
                      </div>
                      <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.2rem' }}>Alumni Sign In</h2>
                      <p className="text-gray-500 text-xs mt-0.5">BSIS graduates — use your Student ID to log in</p>
                    </>
                  )}
                  {activeTab === 'employer' && (
                    <>
                      <div className="flex size-10 items-center justify-center rounded-xl bg-teal-50 mb-3">
                        <Building2 className="size-5 text-teal-600" />
                      </div>
                      <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.2rem' }}>Employer Sign In</h2>
                      <p className="text-gray-500 text-xs mt-0.5">Approved corporate partners and recruiters</p>
                    </>
                  )}
                  {activeTab === 'admin' && (
                    <>
                      <div className="flex size-10 items-center justify-center rounded-xl bg-green-50 mb-3">
                        <ShieldCheck className="size-5 text-green-700" />
                      </div>
                      <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.2rem' }}>Admin Sign In</h2>
                      <p className="text-gray-500 text-xs mt-0.5">Program Chair and system administrators</p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                    <span className="text-red-500 text-xs mt-0.5">⚠</span>
                    <p className="text-red-700 text-xs">{error}</p>
                  </div>
                )}

                {/* Alumni Form */}
                {activeTab === 'alumni' && (
                  <form onSubmit={handleAlumniLogin} className="space-y-4">
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Student ID</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input type="text" placeholder="e.g. BSIS-2023-001" value={studentId}
                          onChange={e => setStudentId(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Graduation Year</label>
                      <div className="relative">
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
                        <select value={gradYear} onChange={e => setGradYear(e.target.value)}
                          className={`${inputCls} pl-3 pr-9 appearance-none`}>
                          <option value="">Select year…</option>
                          {GRADUATION_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>
                    </div>
                    <button type="submit" disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm transition disabled:opacity-70"
                      style={{ fontWeight: 600 }}>
                      {isLoading ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying…</> : <>Sign In <ArrowRight className="size-4" /></>}
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-100" />
                      <span className="text-gray-400 text-xs">or</span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>
                    <button type="button" onClick={() => router.push('/register/alumni')}
                      className="w-full border border-gray-200 hover:border-[#166534]/30 hover:bg-green-50 text-gray-600 py-2.5 rounded-xl text-xs transition"
                      style={{ fontWeight: 500 }}>
                      First time? Register your account →
                    </button>
                  </form>
                )}

                {/* Employer Form */}
                {activeTab === 'employer' && (
                  <form onSubmit={handleEmployerLogin} className="space-y-4">
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Username</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input type="text" placeholder="Employer username" value={username}
                          onChange={e => setUsername(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Password</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input type={showPass ? 'text' : 'password'} placeholder="Password" value={password}
                          onChange={e => setPassword(e.target.value)} className={`${inputCls} pr-10`} />
                        <button type="button" onClick={() => setShowPass(!showPass)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <button type="submit" disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white py-2.5 rounded-xl text-sm transition disabled:opacity-70"
                      style={{ fontWeight: 600 }}>
                      {isLoading ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in…</> : <>Sign In <ArrowRight className="size-4" /></>}
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-100" />
                      <span className="text-gray-400 text-xs">or</span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>
                    <button type="button" onClick={() => router.push('/register/employer')}
                      className="w-full border border-gray-200 hover:border-teal-300 hover:bg-teal-50 text-gray-600 py-2.5 rounded-xl text-xs transition"
                      style={{ fontWeight: 500 }}>
                      New company? Apply for employer access →
                    </button>
                  </form>
                )}

                {/* Admin Form */}
                {activeTab === 'admin' && (
                  <form onSubmit={handleAdminLogin} className="space-y-4">
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Username</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input type="text" placeholder="Admin username" value={username}
                          onChange={e => setUsername(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Password</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input type={showPass ? 'text' : 'password'} placeholder="Password" value={password}
                          onChange={e => setPassword(e.target.value)} className={`${inputCls} pr-10`} />
                        <button type="button" onClick={() => setShowPass(!showPass)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <button type="submit" disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition disabled:opacity-70"
                      style={{ fontWeight: 600 }}>
                      {isLoading ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Authenticating…</> : <>Sign In <ArrowRight className="size-4" /></>}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.9rem' }}>
              A complete graduate tracking platform
            </h2>
            <p className="text-gray-500 text-sm mt-2 max-w-lg mx-auto">
              Built specifically for BSIS program management, accreditation, and predictive employability analysis.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className={`flex size-11 items-center justify-center rounded-xl ${f.bg} mb-4`}>
                  <f.icon className={`size-5 ${f.color}`} />
                </div>
                <h3 className="text-gray-800 mb-1.5" style={{ fontWeight: 600, fontSize: '0.95rem' }}>{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Portal Info ── */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 lg:px-8">
          <h2 className="text-gray-900 text-center mb-10" style={{ fontWeight: 700, fontSize: '1.7rem' }}>
            Three portals, one system
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: GraduationCap, title: 'Alumni Portal', color: 'from-emerald-500 to-emerald-700', items: ['Update employment status', 'Biometric face capture', 'View career trend insights', 'Track peer batch data'], action: 'Alumni Login', tab: 'alumni' as LoginTab },
              { icon: Building2, title: 'Employer Portal', color: 'from-teal-500 to-teal-700', items: ['Verify graduate credentials', 'View skill trend aggregates', 'Search by batch & industry', 'Download graduate summaries'], action: 'Employer Login', tab: 'employer' as LoginTab },
              { icon: ShieldCheck, title: 'Admin Portal', color: 'from-[#166534] to-[#14532d]', items: ['Full geomapping dashboard', 'Predictive analytics engine', 'Manage user records & approvals', 'Generate accreditation reports'], action: 'Admin Login', tab: 'admin' as LoginTab },
            ].map(portal => (
              <div key={portal.title} className="rounded-2xl overflow-hidden shadow-md border border-gray-100">
                <div className={`bg-gradient-to-br ${portal.color} p-6`}>
                  <portal.icon className="size-8 text-white/80 mb-3" />
                  <h3 className="text-white" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{portal.title}</h3>
                </div>
                <div className="bg-white p-5">
                  <ul className="space-y-2 mb-5">
                    {portal.items.map(item => (
                      <li key={item} className="flex items-center gap-2 text-gray-600 text-sm">
                        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => { setActiveTab(portal.tab); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className="w-full text-center text-xs py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                    style={{ fontWeight: 600 }}>
                    {portal.action} →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[#14532d] py-8">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src={schoolLogo} alt="CHMSU Logo" className="size-7 rounded-full object-cover bg-white/20" />
            <div>
              <p className="text-white text-sm" style={{ fontWeight: 600 }}>CHMSU Talisay · BSIS Graduate Tracer System</p>
              <p className="text-white/40 text-xs">College of Computing Studies</p>
            </div>
          </div>
          <p className="text-white/30 text-xs text-center">
            © 2026 Carlos Hilado Memorial State University — Talisay Campus. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}