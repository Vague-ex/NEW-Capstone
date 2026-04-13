import { useState } from 'react';
import { useNavigate } from 'react-router';
import Image from 'next/image';
import {
  Building2, Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight,
  CheckCircle2, Clock, GraduationCap, Globe, User, Phone,
  Briefcase, ArrowLeft,
} from 'lucide-react';
import { ApiClientError, employerLogin, registerEmployer } from '../../app/api-client';

type View = 'landing' | 'login' | 'register' | 'pending';
const schoolLogo = '/CHMSULogo.png';

export function EmployerPortal() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('landing');

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-[400px] shrink-0 bg-gradient-to-b from-[#052e16] via-[#166534] to-[#052e16] p-10 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, white 0px, white 1px, transparent 1px, transparent 16px)',
          backgroundSize: '24px 24px',
        }} />
        <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-white/5 blur-3xl" />

        <div className="relative">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/15 border border-white/20 mb-6">
            <Image src={schoolLogo} alt="CHMSU Logo" width={28} height={28} className="rounded-lg object-cover" priority />
          </div>
          <h1 className="text-white mb-1" style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1.2 }}>
            Employer Portal
          </h1>
          <p className="text-green-300 text-sm">CHMSU BSIS Graduate Tracer System</p>
        </div>

        <div className="relative space-y-4">
          {[
            { icon: CheckCircle2, title: 'Verify Graduates', desc: 'Confirm BSIS graduation and employment status of your candidates.' },
            { icon: Briefcase, title: 'Talent Insights', desc: 'View skills and employment data of alumni at your company.' },
            { icon: Clock, title: 'Admin-Approved Access', desc: 'All requests are reviewed by the BSIS Program Chair.' },
          ].map(item => (
            <div key={item.title} className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-white/10 shrink-0">
                <item.icon className="size-4 text-green-200" />
              </div>
              <div>
                <p className="text-white text-sm" style={{ fontWeight: 600 }}>{item.title}</p>
                <p className="text-white/50 text-xs leading-relaxed mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
          <div className="mt-4 rounded-xl bg-white/10 border border-white/10 p-4 text-xs text-green-200 leading-relaxed">
            <span style={{ fontWeight: 600 }}>How to get access:</span> Graduates share this link with their employers. Submit a request, the Program Chair reviews it, and you receive login credentials once approved.
          </div>
        </div>

        <div className="relative space-y-2">
          <p className="text-white/25 text-xs">© 2026 Carlos Hilado Memorial State University</p>
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-green-300 hover:text-white text-xs transition" style={{ fontWeight: 500 }}>
            <GraduationCap className="size-3.5" /> Alumni & Admin login →
          </button>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-4 py-12 bg-gray-50">
        <div className="w-full max-w-[420px]">

          {/* Mobile header */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534] overflow-hidden">
              <Image src={schoolLogo} alt="CHMSU Logo" width={30} height={30} className="rounded-md object-cover" priority />
            </div>
            <div>
              <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>CHMSU Employer Portal</p>
              <p className="text-gray-500 text-xs">Graduate Tracer System</p>
            </div>
          </div>

          {view === 'landing' && <LandingView onLogin={() => setView('login')} onRegister={() => setView('register')} />}
          {view === 'login' && <LoginView onBack={() => setView('landing')} onPending={() => setView('pending')} navigate={navigate} />}
          {view === 'register' && <RegisterView onBack={() => setView('landing')} onDone={() => setView('pending')} />}
          {view === 'pending' && <PendingView navigate={navigate} />}
        </div>
      </div>
    </div>
  );
}

// ── Landing ──
function LandingView({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <div>
      <h2 className="text-gray-900 mb-1" style={{ fontWeight: 700, fontSize: '1.35rem' }}>Welcome, Employer</h2>
      <p className="text-gray-500 text-sm mb-8">Sign in with your approved credentials, or submit an access request.</p>

      <div className="space-y-3">
        <button
          onClick={onLogin}
          className="w-full flex items-center gap-3 bg-[#166534] hover:bg-[#14532d] text-white p-4 rounded-2xl transition text-left"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/20 shrink-0">
            <Lock className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm" style={{ fontWeight: 600 }}>Sign In</p>
            <p className="text-green-200 text-xs mt-0.5">Already have approved credentials</p>
          </div>
          <ArrowRight className="size-5 text-green-300 shrink-0" />
        </button>

        <button
          onClick={onRegister}
          className="w-full flex items-center gap-3 bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 p-4 rounded-2xl transition text-left shadow-sm"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-green-50 shrink-0">
            <Building2 className="size-5 text-[#166534]" />
          </div>
          <div className="flex-1">
            <p className="text-sm" style={{ fontWeight: 600 }}>Request Access</p>
            <p className="text-gray-500 text-xs mt-0.5">Submit a new employer registration</p>
          </div>
          <ArrowRight className="size-5 text-gray-300 shrink-0" />
        </button>
      </div>
    </div>
  );
}

// ── Login ──
function LoginView({ onBack, onPending, navigate }: { onBack: () => void; onPending: () => void; navigate: (path: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) { setError('Please enter your credential email and password.'); return; }
    setIsLoading(true);

    try {
      const response = await employerLogin(email.trim(), password);
      const payload = (response.employer ?? {}) as Record<string, unknown>;
      const status = String(payload.status ?? payload.accountStatus ?? 'pending').toLowerCase();

      const employerForSession = {
        id: String(payload.id ?? ''),
        company: String(payload.company ?? payload.companyName ?? 'Employer Account'),
        industry: String(payload.industry ?? 'Not provided'),
        email: String(payload.credentialEmail ?? payload.email ?? email.trim()),
        status,
        date: String(payload.date ?? new Date().toISOString().split('T')[0]),
      };

      sessionStorage.setItem('employer_user', JSON.stringify(employerForSession));
      if (status === 'pending') {
        onPending();
        return;
      }
      navigate('/employer/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 403) {
          setError(err.message || 'Your employer account cannot access the portal at this time.');
        } else if (err.status === 401) {
          setError('Incorrect credentials. Please try again.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm mb-6 transition">
        <ArrowLeft className="size-4" /> Back
      </button>
      <h2 className="text-gray-900 mb-1" style={{ fontWeight: 700, fontSize: '1.2rem' }}>Employer Sign In</h2>
      <p className="text-gray-500 text-sm mb-6">Use your approved credential email and password.</p>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-xs">{error}</p>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Credential Email</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input type="email" placeholder="you@company.com" value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className={`${inputCls} pl-10 pr-4`} autoFocus />
          </div>
        </div>
        <div>
          <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Password</label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input type={showPass ? 'text' : 'password'} placeholder="Password" value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              className={`${inputCls} pl-10 pr-10`} />
            <button type="button" onClick={() => setShowPass(!showPass)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={isLoading || !email.trim() || !password.trim()}
          className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-60"
          style={{ fontWeight: 600 }}>
          {isLoading
            ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in…</>
            : <>Sign In <ArrowRight className="size-4" /></>
          }
        </button>
      </form>
    </div>
  );
}

// ── Register ──
function RegisterView({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    companyName: '', industry: '', website: '',
    contactName: '', position: '', email: '', phone: '',
    password: '', confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.companyName || !form.contactName || !form.email || !form.industry) {
      setError('Please fill in all required fields.'); return;
    }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }

    setIsLoading(true);

    try {
      const response = await registerEmployer({
        company_name: form.companyName,
        industry: form.industry,
        website: form.website,
        contact_name: form.contactName,
        position: form.position,
        credential_email: form.email,
        phone: form.phone,
        password: form.password,
        confirm_password: form.confirmPassword,
      });

      const payload = (response.employer ?? {}) as Record<string, unknown>;
      const employerForSession = {
        id: String(payload.id ?? `new-${Date.now()}`),
        company: String(payload.company ?? form.companyName),
        industry: String(payload.industry ?? form.industry),
        contact: String(payload.contact ?? form.contactName),
        email: String(payload.email ?? form.email),
        status: String(payload.status ?? 'pending'),
        date: String(payload.date ?? new Date().toISOString().split('T')[0]),
      };

      sessionStorage.setItem('employer_user', JSON.stringify(employerForSession));
      onDone();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to submit employer registration right now. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';
  const iCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeft className="size-4 text-gray-600" />
        </button>
        <div>
          <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Request Employer Access</h2>
          <p className="text-gray-500 text-xs">Reviewed by the BSIS Program Chair</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg p-3.5">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Company Info */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Building2 className="size-4 text-[#166534]" /> Company
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Company Name <span className="text-red-500">*</span></label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input name="companyName" value={form.companyName} onChange={handleChange} placeholder="e.g. Accenture Philippines" className={iCls} />
              </div>
            </div>
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Industry <span className="text-red-500">*</span></label>
              <select name="industry" value={form.industry} onChange={handleChange} className={inputCls}>
                <option value="">Select industry…</option>
                {(['IT & BPO', 'Banking & Finance', 'Healthcare', 'Telecommunications', 'Government', 'Manufacturing', 'Retail & E-commerce', 'Education', 'Media & Entertainment', 'Others']).map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Website</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input name="website" value={form.website} onChange={handleChange} placeholder="https://company.com" className={iCls} />
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <User className="size-4 text-[#166534]" /> Contact Representative
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Contact Name <span className="text-red-500">*</span></label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input name="contactName" value={form.contactName} onChange={handleChange} placeholder="Full name" className={iCls} />
              </div>
            </div>
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Position</label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input name="position" value={form.position} onChange={handleChange} placeholder="e.g. HR Manager" className={iCls} />
              </div>
            </div>
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="09XXXXXXXXX" className={iCls} />
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Account Credential Email <span className="text-red-500">*</span></label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@company.com" className={iCls} />
              </div>
            </div>
          </div>
        </div>

        {/* Account Credentials */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Lock className="size-4 text-[#166534]" /> Account Credentials
          </h3>
          <p className="text-gray-500 text-xs mb-4">Set a password to log in once your account is approved.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Password</label>
              <input name="password" type="password" value={form.password} onChange={handleChange}
                placeholder="Min. 8 characters" className={inputCls} />
            </div>
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Confirm Password</label>
              <input name="confirmPassword" type="password" value={form.confirmPassword} onChange={handleChange}
                placeholder="Repeat" className={inputCls} />
            </div>
          </div>
        </div>

        <button type="submit" disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-70"
          style={{ fontWeight: 600 }}>
          {isLoading
            ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting…</>
            : 'Submit Registration Request →'
          }
        </button>
      </form>
    </div>
  );
}

// ── Pending ──
function PendingView({ navigate }: { navigate: (path: string) => void }) {
  const rawUser = sessionStorage.getItem('employer_user');
  const employer = rawUser ? JSON.parse(rawUser) : { company: 'Your Company', email: '' };

  return (
    <div className="text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-green-100 mx-auto mb-6">
        <Clock className="size-10 text-[#166534]" />
      </div>
      <h2 className="text-gray-900 mb-2" style={{ fontWeight: 700, fontSize: '1.3rem' }}>Pending Admin Approval</h2>
      <p className="text-gray-500 text-sm mb-2 max-w-sm mx-auto">
        Your request for <span className="text-gray-700" style={{ fontWeight: 600 }}>{employer.company}</span> has been submitted and is under review.
      </p>
      <p className="text-gray-400 text-xs mb-8 max-w-xs mx-auto">
        The CHMSU BSIS Program Chair will review your request and notify you at your credential email <span className="text-gray-600">{employer.email}</span>.
      </p>

      {/* Status steps */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6 text-left shadow-sm">
        <p className="text-gray-700 text-xs mb-3" style={{ fontWeight: 600 }}>Approval Process</p>
        {[
          { label: 'Request submitted', done: true },
          { label: 'Program Chair review', done: false, active: true },
          { label: 'Credentials issued', done: false },
          { label: 'Portal access granted', done: false },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className={`flex size-6 items-center justify-center rounded-full shrink-0 text-xs ${step.done ? 'bg-emerald-500 text-white' :
              step.active ? 'bg-[#166534] text-white' : 'bg-gray-100 text-gray-400'
              }`} style={{ fontWeight: 700 }}>
              {step.done ? '✓' : i + 1}
            </div>
            <span className={`text-sm ${step.done ? 'text-emerald-700' : step.active ? 'text-[#166534]' : 'text-gray-400'}`}
              style={{ fontWeight: step.active ? 600 : step.done ? 500 : 400 }}>
              {step.label}
            </span>
            {step.active && <span className="ml-auto size-2 rounded-full bg-[#15803d] animate-pulse" />}
          </div>
        ))}
      </div>

      <button onClick={() => navigate('/')}
        className="w-full border border-gray-200 hover:bg-gray-50 text-gray-700 py-2.5 rounded-xl text-sm transition"
        style={{ fontWeight: 500 }}>
        Return to Main Login
      </button>
    </div>
  );
}