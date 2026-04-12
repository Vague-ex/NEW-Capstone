import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  GraduationCap, ArrowLeft, CheckCircle2, AlertCircle,
  User, Mail, Phone, Lock, Eye, EyeOff, Camera, VideoOff,
  MapPin, RefreshCw, Video, ChevronRight, ChevronLeft,
  Briefcase, BookOpen, Award,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_CONFIG = [
  { n: 1 as Step, label: 'Account' },
  { n: 2 as Step, label: 'Personal' },
  { n: 3 as Step, label: 'Education' },
  { n: 4 as Step, label: 'Employment' },
  { n: 5 as Step, label: 'Skills' },
  { n: 6 as Step, label: 'Biometrics' },
];

const SHOT_INSTRUCTIONS = [
  { label: 'Face Forward', desc: 'Look directly at the camera' },
  { label: 'Turn LEFT',    desc: 'Slowly turn your head to the left' },
  { label: 'Turn RIGHT',   desc: 'Slowly turn your head to the right' },
];

const SKILLS_LIST = [
  'Programming/Software Development',
  'Database Management',
  'Network Administration',
  'Business Process Analysis',
  'Project Management',
  'Technical Support / Troubleshooting',
  'Data Analytics',
  'Web Development',
  'System Analysis and Design',
  'Communication Skills (Oral/Written)',
  'Teamwork/Collaboration',
  'Problem-solving / Critical Thinking',
];

// ── Form state type ─────────────────────────────────────────────────────────────

interface GraduateForm {
  // Step 1: Account
  email: string; password: string; confirmPassword: string;
  // Step 2: Personal
  familyName: string; firstName: string; middleName: string;
  gender: string; birthDate: string; civilStatus: string;
  mobile: string; facebook: string; city: string; province: string;
  // Step 3: Education
  graduationDate: string; scholarship: string;
  highestAttainment: string; graduateSchool: string;
  profEligibility: string[]; profEligibilityOther: string;
  // Step 4: Employment
  employmentStatus: string; timeToHire: string;
  firstJobSector: string; firstJobStatus: string;
  firstJobTitle: string; firstJobRelated: string;
  firstJobUnrelatedReason: string; firstJobUnrelatedOther: string;
  currentJobSector: string; currentJobPosition: string;
  currentJobCompany: string; currentJobLocation: string;
  currentJobRelated: string; jobRetention: string;
  jobSource: string; jobSourceOther: string;
  // Step 5: Skills
  skills: string[]; awards: string;
}

const INITIAL_FORM: GraduateForm = {
  email: '', password: '', confirmPassword: '',
  familyName: '', firstName: '', middleName: '',
  gender: '', birthDate: '', civilStatus: '', mobile: '', facebook: '', city: '', province: '',
  graduationDate: '', scholarship: '', highestAttainment: '', graduateSchool: '',
  profEligibility: [], profEligibilityOther: '',
  employmentStatus: '', timeToHire: '',
  firstJobSector: '', firstJobStatus: '', firstJobTitle: '', firstJobRelated: '',
  firstJobUnrelatedReason: '', firstJobUnrelatedOther: '',
  currentJobSector: '', currentJobPosition: '', currentJobCompany: '',
  currentJobLocation: '', currentJobRelated: '', jobRetention: '',
  jobSource: '', jobSourceOther: '',
  skills: [], awards: '',
};

// ── Sub-components ──────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

function RadioOption({ label, value, current, onSelect }: { label: string; value: string; current: string; onSelect: (v: string) => void }) {
  const active = current === value;
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition select-none ${
      active ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
    }`}>
      <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-[#166534]' : 'border-gray-300'}`}>
        {active && <div className="size-2 rounded-full bg-[#166534]" />}
      </div>
      <input type="radio" className="hidden" value={value} checked={active} onChange={() => onSelect(value)} />
      {label}
    </label>
  );
}

function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs cursor-pointer transition select-none ${
      checked ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
    }`}>
      <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'border-[#166534] bg-[#166534]' : 'border-gray-300'}`}>
        {checked && (
          <svg className="size-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <input type="checkbox" className="hidden" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="flex size-10 items-center justify-center rounded-xl bg-green-50 shrink-0">
        <Icon className="size-5 text-green-700" />
      </div>
      <div>
        <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.15rem' }}>{title}</h2>
        {subtitle && <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled = false }: {
  onBack: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean;
}) {
  return (
    <div className="flex gap-3 mt-6">
      <button onClick={onBack}
        className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 py-3 rounded-xl text-sm transition"
        style={{ fontWeight: 500 }}>
        <ChevronLeft className="size-4" /> Back
      </button>
      <button onClick={onNext} disabled={nextDisabled}
        className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-50"
        style={{ fontWeight: 600 }}>
        {nextLabel} <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

export function RegisterAlumni() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<GraduateForm>(INITIAL_FORM);
  const [stepError, setStepError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Biometrics state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [currentShot, setCurrentShot] = useState(0);
  const [shots, setShots] = useState<(string | null)[]>([null, null, null]);
  const [captureTime, setCaptureTime] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const allShotsCaptured = shots.every(s => s !== null);

  useEffect(() => { return () => stopCamera(); }, []);

  // Helper: set single string field
  const setF = (field: keyof GraduateForm, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  // Helper: toggle string in array field
  const toggleArr = (field: 'profEligibility' | 'skills', value: string) =>
    setForm(f => {
      const arr = f[field] as string[];
      return { ...f, [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });

  // ── Validation ──────────────────────────────────────────────────────────────
  const validateStep = (): boolean => {
    setStepError('');
    if (step === 1) {
      if (!form.email.trim() || !form.email.includes('@')) {
        setStepError('Please enter a valid email address.'); return false;
      }
      if (form.password.length < 8) {
        setStepError('Password must be at least 8 characters.'); return false;
      }
      if (form.password !== form.confirmPassword) {
        setStepError('Passwords do not match.'); return false;
      }
    }
    if (step === 2) {
      if (!form.familyName.trim()) { setStepError('Family name is required.'); return false; }
      if (!form.firstName.trim())  { setStepError('First name is required.');  return false; }
    }
    if (step === 3) {
      if (!form.graduationDate.trim()) { setStepError('Date of graduation is required.'); return false; }
    }
    return true;
  };

  const nextStep = () => { if (validateStep()) setStep(s => (s + 1) as Step); };
  const prevStep = () => { setStepError(''); setStep(s => (s - 1) as Step); };

  // ── Camera helpers ──────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setCameraOn(true);
    } catch {
      setCameraError('Camera access denied. Please allow camera permission and try again.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  const captureShot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    canvasRef.current.width  = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);

    setShots(prev => { const next = [...prev]; next[currentShot] = dataUrl; return next; });

    if (!captureTime) {
      setCaptureTime(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }));
    }
    if (currentShot === 0 && !gps) {
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        pos => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsLoading(false); },
        ()  => { setGps({ lat: 10.7202, lng: 122.5621 }); setGpsLoading(false); },
        { timeout: 6000 }
      );
    }
    if (currentShot < 2) {
      setCurrentShot(c => c + 1);
    } else {
      stopCamera();
    }
  };

  const retakeAll = () => {
    setShots([null, null, null]);
    setCurrentShot(0);
    setCaptureTime(null);
    setGps(null);
    setGpsLoading(false);
    startCamera();
  };

  // ── Final submit ─────────────────────────────────────────────────────────────
  const handleFinalSubmit = async () => {
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 1400));
    const fullName = [form.firstName, form.middleName, form.familyName].filter(Boolean).join(' ');
    const gradYear = form.graduationDate
      ? parseInt(form.graduationDate.replace(/.*\//, ''))
      : new Date().getFullYear();
    const newGraduate = {
      id: `new-${Date.now()}`,
      schoolId: '',
      name: fullName,
      email: form.email,
      graduationYear: isNaN(gradYear) ? new Date().getFullYear() : gradYear,
      verificationStatus: 'pending' as const,
      employmentStatus: form.employmentStatus === 'Yes' ? 'employed' as const : 'unemployed' as const,
      dateUpdated: new Date().toISOString().split('T')[0],
      biometricCaptured: allShotsCaptured,
      biometricDate: allShotsCaptured ? new Date().toISOString().split('T')[0] : undefined,
      lat: gps?.lat,
      lng: gps?.lng,
      skills: form.skills,
      surveyData: { ...form },
    };
    sessionStorage.setItem('alumni_user', JSON.stringify(newGraduate));
    setIsSaving(false);
    setDone(true);
  };

  // ── Done screen ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Graduate Registration</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center max-w-md w-full">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 mx-auto mb-5">
              <CheckCircle2 className="size-9 text-emerald-500" />
            </div>
            <h2 className="text-gray-900 mb-2" style={{ fontWeight: 700, fontSize: '1.4rem' }}>Account Created!</h2>
            <p className="text-gray-600 text-sm mb-1">Welcome, {form.firstName}!</p>
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 mb-6">
              <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-700 text-xs" style={{ fontWeight: 600 }}>Pending Program Chair Verification</span>
            </div>
            <p className="text-gray-500 text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              Your account and CHED Graduate Tracer survey have been submitted. The Program Chair will review your biometric submission and verify your identity.
            </p>
            <button onClick={() => navigate('/alumni/dashboard')}
              className="flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-8 py-3 rounded-xl text-sm transition mx-auto"
              style={{ fontWeight: 600 }}>
              Go to My Dashboard →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => step === 1 ? navigate('/') : prevStep()}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition">
          <ArrowLeft className="size-4 text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Graduate Registration</p>
            <p className="text-gray-400 text-xs">CHMSU Talisay · BSIS Graduate Tracer System</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-lg">

          {/* Stepper */}
          <div className="flex items-center mb-8">
            {STEP_CONFIG.map((s, i) => (
              <div key={s.n} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center shrink-0">
                  <div className={`flex size-7 items-center justify-center rounded-full text-xs transition-all ${
                    step > s.n ? 'bg-emerald-500 text-white' :
                    step === s.n ? 'bg-[#166534] text-white' : 'bg-gray-200 text-gray-400'
                  }`} style={{ fontWeight: 700 }}>
                    {step > s.n ? <CheckCircle2 className="size-3.5" /> : s.n}
                  </div>
                  <p className={`mt-1 whitespace-nowrap ${step >= s.n ? 'text-gray-700' : 'text-gray-400'}`}
                    style={{ fontWeight: step === s.n ? 600 : 400, fontSize: '0.62rem' }}>
                    {s.label}
                  </p>
                </div>
                {i < 5 && <div className={`flex-1 h-px mx-1 mb-5 ${step > s.n ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          {/* ── STEP 1: Account Setup ─────────────────────────────────── */}
          {step === 1 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Lock} title="Create Your Account" subtitle="Set up your login credentials for the Graduate Portal." />

              {stepError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Email Address *</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input type="email" placeholder="your.email@example.com" value={form.email}
                      onChange={e => setF('email', e.target.value)} className={`${inputCls} pl-10`} />
                  </div>
                  <p className="text-gray-400 text-xs mt-1.5">This will be your login email address.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Password *</label>
                    <div className="relative">
                      <input type={showPass ? 'text' : 'password'} placeholder="Min. 8 characters" value={form.password}
                        onChange={e => setF('password', e.target.value)} className={`${inputCls} pr-10`} />
                      <button type="button" onClick={() => setShowPass(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Confirm Password *</label>
                    <input type="password" placeholder="Repeat password" value={form.confirmPassword}
                      onChange={e => setF('confirmPassword', e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>

              <button onClick={nextStep}
                className="mt-6 w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition"
                style={{ fontWeight: 600 }}>
                Continue <ChevronRight className="size-4" />
              </button>
              <p className="text-center text-gray-400 text-xs mt-4">
                Already have an account?{' '}
                <button onClick={() => navigate('/')} className="text-[#166534] hover:underline" style={{ fontWeight: 500 }}>Sign in</button>
              </p>
            </div>
          )}

          {/* ── STEP 2: Personal Information (Part I) ────────────────── */}
          {step === 2 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={User} title="Personal Information" subtitle="Part I of the CHED Graduate Tracer Survey" />

              {stepError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Family Name *</label>
                    <input type="text" placeholder="Surname" value={form.familyName}
                      onChange={e => setF('familyName', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>First Name *</label>
                    <input type="text" placeholder="Given name" value={form.firstName}
                      onChange={e => setF('firstName', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Middle Name</label>
                    <input type="text" placeholder="Optional" value={form.middleName}
                      onChange={e => setF('middleName', e.target.value)} className={inputCls} />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Gender</label>
                  <div className="flex gap-2">
                    {['Male', 'Female'].map(g => (
                      <RadioOption key={g} label={g} value={g} current={form.gender} onSelect={v => setF('gender', v)} />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Birth Date (MM/YY)</label>
                    <input type="text" placeholder="e.g. 08/01" value={form.birthDate}
                      onChange={e => setF('birthDate', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Civil Status</label>
                    <select value={form.civilStatus} onChange={e => setF('civilStatus', e.target.value)} className={inputCls}>
                      <option value="">Select…</option>
                      <option>Single</option>
                      <option>Married</option>
                      <option>Widowed</option>
                      <option>Separated</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Mobile Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input type="tel" placeholder="09XXXXXXXXX" value={form.mobile}
                      onChange={e => setF('mobile', e.target.value)} className={`${inputCls} pl-10`} />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Active Facebook Account{' '}
                    <span className="text-gray-400" style={{ fontWeight: 400 }}>(Optional)</span>
                  </label>
                  <input type="text" placeholder="facebook.com/username or profile URL" value={form.facebook}
                    onChange={e => setF('facebook', e.target.value)} className={inputCls} />
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Permanent Address</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-500 text-xs mb-1.5">City/Municipality</label>
                      <input type="text" placeholder="e.g. Talisay City" value={form.city}
                        onChange={e => setF('city', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-gray-500 text-xs mb-1.5">State/Province</label>
                      <input type="text" placeholder="e.g. Negros Occidental" value={form.province}
                        onChange={e => setF('province', e.target.value)} className={inputCls} />
                    </div>
                  </div>
                </div>
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} />
            </div>
          )}

          {/* ── STEP 3: Educational Background (Part II) ─────────────── */}
          {step === 3 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={BookOpen} title="Educational Background" subtitle="Part II — Identifies cohort groups for trend analysis" />

              {stepError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Degree Program</label>
                    <input type="text" value="Bachelor of Science in Information Systems (BSIS)" readOnly
                      className={`${inputCls} bg-gray-100 text-gray-500 cursor-not-allowed text-xs`} />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Campus</label>
                    <input type="text" value="Talisay" readOnly
                      className={`${inputCls} bg-gray-100 text-gray-500 cursor-not-allowed`} />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Date of Graduation * <span className="text-gray-400" style={{ fontWeight: 400 }}>(MM/YYYY)</span></label>
                  <input type="text" placeholder="e.g. 05/2023" value={form.graduationDate}
                    onChange={e => setF('graduationDate', e.target.value)} className={inputCls} />
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Scholarship Availed During College{' '}
                    <span className="text-gray-400" style={{ fontWeight: 400 }}>(if any)</span>
                  </label>
                  <input type="text" placeholder="e.g. CHED Scholarship, State Scholarship, None" value={form.scholarship}
                    onChange={e => setF('scholarship', e.target.value)} className={inputCls} />
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Highest Educational Attainment (Post-Graduate)</label>
                  <div className="space-y-2">
                    {[
                      { val: 'Masters',   label: "Master's Degree" },
                      { val: 'Doctorate', label: 'Doctorate Degree' },
                      { val: 'NA',        label: 'N/A (Not pursuing further studies)' },
                    ].map(opt => (
                      <RadioOption key={opt.val} label={opt.label} value={opt.val}
                        current={form.highestAttainment} onSelect={v => setF('highestAttainment', v)} />
                    ))}
                  </div>
                </div>

                {(form.highestAttainment === 'Masters' || form.highestAttainment === 'Doctorate') && (
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Name of Graduate School</label>
                    <input type="text" placeholder="e.g. University of the Philippines Visayas" value={form.graduateSchool}
                      onChange={e => setF('graduateSchool', e.target.value)} className={inputCls} />
                  </div>
                )}

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Professional Eligibility / Certification (IT Related)</label>
                  <div className="space-y-2">
                    {['Civil Service', 'TESDA', 'Others'].map(opt => (
                      <CheckOption key={opt} label={opt}
                        checked={form.profEligibility.includes(opt)}
                        onChange={() => toggleArr('profEligibility', opt)} />
                    ))}
                    {form.profEligibility.includes('Others') && (
                      <input type="text" placeholder="Please specify certification…" value={form.profEligibilityOther}
                        onChange={e => setF('profEligibilityOther', e.target.value)} className={`${inputCls} mt-1`} />
                    )}
                  </div>
                </div>
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} />
            </div>
          )}

          {/* ── STEP 4: Employment Data (Part III) ───────────────────── */}
          {step === 4 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Briefcase} title="Employment Data" subtitle="Part III — Core data for Predictive Employability Trend Analysis" />

              <div className="space-y-6">
                {/* Q1: Employment status */}
                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>1. Are you presently employed?</label>
                  <div className="flex flex-wrap gap-2">
                    {['Yes', 'No', 'Never Employed'].map(opt => (
                      <RadioOption key={opt} label={opt} value={opt}
                        current={form.employmentStatus} onSelect={v => setF('employmentStatus', v)} />
                    ))}
                  </div>
                </div>

                {form.employmentStatus && form.employmentStatus !== 'Never Employed' && (
                  <>
                    {/* Q2: Time to hire */}
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        2. Job Acquisition Speed — How long did it take to land your first job after graduation?
                      </label>
                      <div className="space-y-1.5">
                        {['Within 1 month','1-3 months','3-6 months','6 months to 1 year','Within 2 years','After 2 years'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.timeToHire} onSelect={v => setF('timeToHire', v)} />
                        ))}
                      </div>
                    </div>

                    {/* Q3: First job */}
                    <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                      <p className="text-gray-700 text-xs" style={{ fontWeight: 700 }}>3. First Job Details</p>

                      <div>
                        <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Sector</label>
                        <div className="space-y-1.5">
                          {['Government','Private','Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                            <RadioOption key={opt} label={opt} value={opt}
                              current={form.firstJobSector} onSelect={v => setF('firstJobSector', v)} />
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Status (First Job)</label>
                        <div className="space-y-1.5">
                          {['Regular/Permanent','Probationary','Contractual/Casual/Job Order'].map(opt => (
                            <RadioOption key={opt} label={opt} value={opt}
                              current={form.firstJobStatus} onSelect={v => setF('firstJobStatus', v)} />
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-gray-600 text-xs mb-1.5" style={{ fontWeight: 600 }}>Job Title / Position</label>
                        <input type="text" placeholder="e.g. Junior Software Developer" value={form.firstJobTitle}
                          onChange={e => setF('firstJobTitle', e.target.value)} className={inputCls} />
                      </div>

                      <div>
                        <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Is/Was this first job related to your BSIS degree?</label>
                        <div className="flex gap-2">
                          {['Yes','No'].map(opt => (
                            <RadioOption key={opt} label={opt} value={opt}
                              current={form.firstJobRelated} onSelect={v => setF('firstJobRelated', v)} />
                          ))}
                        </div>
                      </div>

                      {form.firstJobRelated === 'No' && (
                        <div>
                          <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>
                            Primary reason for accepting unrelated job: <span className="text-gray-400" style={{ fontWeight: 400 }}>(Check most applicable)</span>
                          </label>
                          <div className="space-y-1.5">
                            {['Salary & Benefits','Career Challenge/Advancement','Proximity to Residence','Lack of related job openings at the time','Others'].map(opt => (
                              <RadioOption key={opt} label={opt} value={opt}
                                current={form.firstJobUnrelatedReason} onSelect={v => setF('firstJobUnrelatedReason', v)} />
                            ))}
                          </div>
                          {form.firstJobUnrelatedReason === 'Others' && (
                            <input type="text" placeholder="Please specify…" value={form.firstJobUnrelatedOther}
                              onChange={e => setF('firstJobUnrelatedOther', e.target.value)} className={`${inputCls} mt-2`} />
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Q4: Current job (only if currently employed) */}
                {form.employmentStatus === 'Yes' && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                    <p className="text-gray-700 text-xs" style={{ fontWeight: 700 }}>4. Current Job Details</p>

                    <div>
                      <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Sector</label>
                      <div className="space-y-1.5">
                        {['Government','Private','Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.currentJobSector} onSelect={v => setF('currentJobSector', v)} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-600 text-xs mb-1.5" style={{ fontWeight: 600 }}>Current Occupation / Position</label>
                      <input type="text" placeholder="e.g. Systems Analyst" value={form.currentJobPosition}
                        onChange={e => setF('currentJobPosition', e.target.value)} className={inputCls} />
                    </div>

                    <div>
                      <label className="block text-gray-600 text-xs mb-1.5" style={{ fontWeight: 600 }}>Name of Company / Organization</label>
                      <input type="text" placeholder="Company or organization name" value={form.currentJobCompany}
                        onChange={e => setF('currentJobCompany', e.target.value)} className={inputCls} />
                    </div>

                    <div>
                      <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Location of Employment</label>
                      <div className="space-y-1.5">
                        {['Local (Philippines)','Abroad / Remote Foreign Employer'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.currentJobLocation} onSelect={v => setF('currentJobLocation', v)} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Is your current job related to your BSIS degree?</label>
                      <div className="flex gap-2">
                        {['Yes','No'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.currentJobRelated} onSelect={v => setF('currentJobRelated', v)} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {form.employmentStatus && form.employmentStatus !== 'Never Employed' && (
                  <>
                    {/* Q5: Job retention */}
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        5. Job Retention — How long did you stay in your first job (or current role)?
                      </label>
                      <div className="space-y-1.5">
                        {['Less than 6 months','6 months to 1 year','1 to 2 years','2 years and above'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.jobRetention} onSelect={v => setF('jobRetention', v)} />
                        ))}
                      </div>
                    </div>

                    {/* Q6: Source of job */}
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        6. Source of Job Opportunity — Where did you find your first job opening?
                      </label>
                      <div className="space-y-1.5">
                        {[
                          'CHMSU Career Orientation / Job Fair',
                          'Online Job Portal (JobStreet, LinkedIn, etc.)',
                          'Personal Network / Referral',
                          'Company Walk-in / Direct Hire',
                          'Others',
                        ].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.jobSource} onSelect={v => setF('jobSource', v)} />
                        ))}
                      </div>
                      {form.jobSource === 'Others' && (
                        <input type="text" placeholder="Please specify…" value={form.jobSourceOther}
                          onChange={e => setF('jobSourceOther', e.target.value)} className={`${inputCls} mt-2`} />
                      )}
                    </div>
                  </>
                )}
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} />
            </div>
          )}

          {/* ── STEP 5: Skills Assessment (Part IV) ──────────────────── */}
          {step === 5 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Award} title="Competency & Skills Assessment" subtitle="Part IV — Validates curriculum effectiveness and identifies skills gaps" />

              <div className="space-y-6">
                <div>
                  <label className="block text-gray-700 text-xs mb-1" style={{ fontWeight: 600 }}>
                    1. Skills Utilized in the Workplace
                  </label>
                  <p className="text-gray-400 text-xs mb-3">
                    Check <span style={{ fontWeight: 600 }}>ALL</span> skills from the BSIS program that you actively use in your current employment:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SKILLS_LIST.map(skill => (
                      <CheckOption key={skill} label={skill}
                        checked={form.skills.includes(skill)}
                        onChange={() => toggleArr('skills', skill)} />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1" style={{ fontWeight: 600 }}>
                    2. Awards / Recognition Received
                  </label>
                  <p className="text-gray-400 text-xs mb-2">
                    List any professional awards or certifications received after graduation:
                  </p>
                  <textarea
                    rows={4}
                    placeholder="e.g. AWS Certified Developer (2024), Best Employee Q1 2024, Cisco CCNA…"
                    value={form.awards}
                    onChange={e => setF('awards', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white resize-none"
                  />
                </div>
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} nextLabel="Continue to Biometrics" />
            </div>
          )}

          {/* ── STEP 6: Biometric Face Capture ───────────────────────── */}
          {step === 6 && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-start gap-3 mb-5">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]/10 shrink-0">
                    <Camera className="size-5 text-[#166534]" />
                  </div>
                  <div>
                    <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Biometric Face Capture</h2>
                    <p className="text-gray-500 text-xs mt-0.5">
                      Three photos are required — facing forward, turning left, and turning right — to prevent identity spoofing with static images.
                    </p>
                  </div>
                </div>

                {/* Shot progress tiles */}
                <div className="flex gap-2 mb-4">
                  {SHOT_INSTRUCTIONS.map((s, i) => (
                    <div key={i} className={`flex-1 rounded-xl border p-2.5 text-center transition ${
                      shots[i] ? 'border-emerald-200 bg-emerald-50' :
                      currentShot === i && cameraOn ? 'border-[#166534] bg-[#166534]/5' :
                      'border-gray-200 bg-gray-50'
                    }`}>
                      <div className={`flex size-6 items-center justify-center rounded-full mx-auto mb-1 ${
                        shots[i] ? 'bg-emerald-500' :
                        currentShot === i && cameraOn ? 'bg-[#166534]' :
                        'bg-gray-200'
                      }`}>
                        {shots[i]
                          ? <CheckCircle2 className="size-3.5 text-white" />
                          : <span className="text-white" style={{ fontWeight: 700, fontSize: '0.6rem' }}>{i + 1}</span>}
                      </div>
                      <p className={`whitespace-nowrap ${shots[i] ? 'text-emerald-700' : currentShot === i && cameraOn ? 'text-[#166534]' : 'text-gray-400'}`}
                        style={{ fontWeight: 600, fontSize: '0.6rem' }}>
                        {s.label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Camera viewport */}
                <div className="relative bg-gray-900 rounded-2xl overflow-hidden mb-4" style={{ aspectRatio: '4/3', maxHeight: '300px' }}>
                  {!cameraOn && !allShotsCaptured && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <Camera className="size-12 text-gray-600 mb-2" />
                      <p className="text-gray-400 text-sm">Camera not started</p>
                      <p className="text-gray-600 text-xs mt-1">Tap "Start Camera" below</p>
                    </div>
                  )}

                  <video ref={videoRef}
                    className={`w-full h-full object-cover ${(!cameraOn || allShotsCaptured) ? 'hidden' : ''}`}
                    playsInline muted autoPlay />

                  {/* All shots captured — show 3-column thumbnail grid */}
                  {allShotsCaptured && (
                    <div className="absolute inset-0 grid grid-cols-3 gap-0.5">
                      {shots.map((shot, i) => (
                        <div key={i} className="relative overflow-hidden">
                          <img src={shot!} alt={`Shot ${i + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1.5">
                            <p className="text-white text-center" style={{ fontWeight: 600, fontSize: '0.55rem' }}>
                              {SHOT_INSTRUCTIONS[i].label}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Face-guide overlay when camera is live */}
                  {cameraOn && !allShotsCaptured && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="size-32 rounded-full border-2 border-dashed border-white/50" />
                      <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                        <div className="bg-black/65 rounded-full px-4 py-1.5">
                          <p className="text-white text-xs" style={{ fontWeight: 600 }}>
                            Shot {currentShot + 1}/3 — {SHOT_INSTRUCTIONS[currentShot]?.label}: {SHOT_INSTRUCTIONS[currentShot]?.desc}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* GPS badge */}
                  {gpsLoading && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 rounded-lg px-3 py-1.5">
                      <span className="size-3 border border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-white text-xs">Getting GPS…</span>
                    </div>
                  )}
                  {gps && !gpsLoading && !allShotsCaptured && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-lg px-3 py-1.5">
                      <MapPin className="size-3.5 text-emerald-400" />
                      <span className="text-white text-xs">{gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>
                    </div>
                  )}
                  {captureTime && allShotsCaptured && (
                    <div className="absolute top-2 right-2 bg-black/60 rounded-lg px-2 py-1">
                      <span className="text-white text-xs">{captureTime}</span>
                    </div>
                  )}
                </div>

                <canvas ref={canvasRef} className="hidden" />

                {cameraError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs">{cameraError}</p>
                  </div>
                )}

                {/* Camera controls */}
                <div className="flex gap-2">
                  {!cameraOn && !allShotsCaptured && (
                    <button onClick={startCamera}
                      className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
                      style={{ fontWeight: 600 }}>
                      <Video className="size-4" /> Start Camera
                    </button>
                  )}
                  {cameraOn && !allShotsCaptured && (
                    <>
                      <button onClick={stopCamera}
                        className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition"
                        title="Stop camera">
                        <VideoOff className="size-4" />
                      </button>
                      <button onClick={captureShot}
                        className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm transition"
                        style={{ fontWeight: 600 }}>
                        <Camera className="size-4" />
                        Capture {currentShot + 1}/3 — {SHOT_INSTRUCTIONS[currentShot]?.label}
                      </button>
                    </>
                  )}
                  {allShotsCaptured && (
                    <button onClick={retakeAll}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition"
                      style={{ fontWeight: 500 }}>
                      <RefreshCw className="size-4" /> Retake All
                    </button>
                  )}
                </div>

                {allShotsCaptured && (
                  <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                    <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>All 3 biometric shots captured!</p>
                      <p className="text-emerald-600 text-xs">
                        {captureTime}
                        {gps ? ` · GPS ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : ''}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={prevStep}
                  className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 py-3 rounded-xl text-sm transition"
                  style={{ fontWeight: 500 }}>
                  <ChevronLeft className="size-4" /> Back
                </button>
                <button onClick={handleFinalSubmit} disabled={isSaving || !allShotsCaptured}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm transition ${
                    allShotsCaptured && !isSaving
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                  style={{ fontWeight: 600 }}>
                  {isSaving
                    ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating account…</>
                    : 'Submit Registration →'}
                </button>
              </div>
              {!allShotsCaptured && (
                <p className="text-center text-gray-400 text-xs">
                  All 3 face captures (forward, left, right) are required to complete registration.
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
