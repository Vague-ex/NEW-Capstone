/**
 * Alumni Registration - Personal Information Component
 * Handles: Account Setup, Personal Info, Education Background, Biometric Verification
 * Steps: 1-4 + Biometrics
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  GraduationCap, ArrowLeft, CheckCircle2, AlertCircle,
  User, Mail, Phone, Lock, Eye, EyeOff, Camera, VideoOff, Video, RefreshCw,
  ChevronRight, ChevronLeft,
  BookOpen,
} from 'lucide-react';
import isImageBlurry from 'is-image-blurry';
import {
  averageFaceDescriptors,
  extractFaceDescriptorFromDataUrl,
} from '../app/modern-face-descriptor';
import { API_BASE_URL } from '../app/api-client';

//  Types

type PersonalStep = 1 | 2 | 3 | 4;

export interface PersonalFormData {
  // Step 1: Account
  email: string;
  password: string;
  confirmPassword: string;

  // Step 2: Personal Information
  familyName: string;
  firstName: string;
  middleName: string;
  gender: string;
  birthDate: string;
  civilStatus: string;
  mobile: string;
  mobileCountryCode: string;
  facebook: string;
  region: string;
  province: string;
  city: string;
  barangay: string;

  // Step 3: Education Information
  graduationDate: string;
  graduationYear: number | null;
  hasGraduated: boolean;
  scholarship: string;
  highestAttainment: string;
  graduateSchool: string;
  profEligibility: string[];
  profEligibilityOther: string;
}

export interface BiometricData {
  front: Blob;
  left: Blob;
  right: Blob;
  descriptor: number[] | null;
  descriptorSamples: number[][];
}

//  Constants

const PERSONAL_STEP_CONFIG = [
  { n: 1 as PersonalStep, label: 'Account' },
  { n: 2 as PersonalStep, label: 'Personal' },
  { n: 3 as PersonalStep, label: 'Education' },
  { n: 4 as PersonalStep, label: 'Verify Identity' },
];

const SHOT_INSTRUCTIONS = [
  { label: 'Face Forward', desc: 'Look directly at the camera' },
  { label: 'Turn LEFT', desc: 'Slowly turn your head to the left' },
  { label: 'Turn RIGHT', desc: 'Slowly turn your head to the right' },
];

const FACE_BLUR_THRESHOLD = 360;

type PhCity = { name: string; zip: string; barangays: string[] };
type PhProvince = { name: string; cities: PhCity[] };
type PhRegion = { name: string; provinces: PhProvince[] };
type PhLocations = { regions: PhRegion[] };

const INITIAL_PERSONAL_FORM: PersonalFormData = {
  email: '',
  password: '',
  confirmPassword: '',
  familyName: '',
  firstName: '',
  middleName: '',
  gender: '',
  birthDate: '',
  civilStatus: '',
  mobile: '',
  mobileCountryCode: '+63',
  facebook: '',
  region: '',
  province: '',
  city: '',
  barangay: '',
  graduationDate: '',
  graduationYear: null,
  hasGraduated: true,
  scholarship: '',
  highestAttainment: '',
  graduateSchool: '',
  profEligibility: [],
  profEligibilityOther: '',
};

//  Reusable Components

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100">
          <Icon className="size-4 text-emerald-600" />
        </div>
        <h2 className="text-gray-900 text-lg" style={{ fontWeight: 700 }}>{title}</h2>
      </div>
      {subtitle && <p className="text-gray-500 text-sm">{subtitle}</p>}
    </div>
  );
}

function RadioOption({ label, value, current, onSelect }: { label: string; value: string | boolean; current: string | boolean; onSelect: (v: string | boolean) => void }) {
  const isSelected = current === value;
  return (
    <button type="button" onClick={() => onSelect(value)}
      className={`px-4 py-2.5 rounded-lg border-2 transition text-sm ${
        isSelected ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
      }`} style={{ fontWeight: isSelected ? 600 : 500 }}>
      {label}
    </button>
  );
}

function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 rounded border-gray-300" />
      <span className="text-gray-700 text-sm">{label}</span>
    </label>
  );
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled = false, navigationUrl }: { onBack: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean; navigationUrl?: string }) {
  return (
    <div className="flex gap-3 mt-6">
      {navigationUrl ? (
        <Link to={navigationUrl}
          className="flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
          style={{ fontWeight: 600 }}>
          <ChevronLeft className="size-4" /> Back
        </Link>
      ) : (
        <button onClick={onBack}
          className="flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
          style={{ fontWeight: 600 }}>
          <ChevronLeft className="size-4" /> Back
        </button>
      )}
      <button onClick={onNext} disabled={nextDisabled}
        className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-white transition text-sm ${
          nextDisabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#166534] hover:bg-[#14532d]'
        }`}
        style={{ fontWeight: 600 }}>
        {nextLabel} <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

//  Main Component

export type MasterlistMatchStatus = 'idle' | 'checking' | 'matched' | 'unmatched';

export default function RegisterAlumniPersonal({
  onComplete,
}: {
  onComplete: (formData: PersonalFormData, biometricData?: BiometricData, matchStatus?: MasterlistMatchStatus) => void | Promise<void>;
}) {
  const navigate = useNavigate();

  // Form state
  const [form, setForm] = useState<PersonalFormData>(INITIAL_PERSONAL_FORM);
  const [step, setStep] = useState<PersonalStep>(1);
  const [stepError, setStepError] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Biometric capture state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [shotIndex, setShotIndex] = useState(0);
  const [previews, setPreviews] = useState<string[]>([]);
  const [capturedShots, setCapturedShots] = useState<Blob[]>([]);
  const [descriptorSamples, setDescriptorSamples] = useState<number[][]>([]);
  const [checkingBlur, setCheckingBlur] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [captureTime, setCaptureTime] = useState<string | null>(null);

  useEffect(() => { return () => stopCamera(); }, []);

  const [phLocations, setPhLocations] = useState<PhLocations | null>(null);
  useEffect(() => {
    fetch('/ph-locations.json').then(r => r.json()).then(setPhLocations).catch(() => {});
  }, []);

  // Real-time masterlist check (fires in Step 2 when name fields have values)
  const [matchStatus, setMatchStatus] = useState<'idle' | 'checking' | 'matched' | 'unmatched'>('idle');
  useEffect(() => {
    if (!form.firstName.trim() || !form.familyName.trim()) {
      setMatchStatus('idle');
      return;
    }
    setMatchStatus('checking');
    const params = new URLSearchParams({
      first_name: form.firstName.trim(),
      last_name: form.familyName.trim(),
    });
    if (form.graduationYear) {
      params.set('graduation_year', String(form.graduationYear));
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/alumni/masterlist-check/?${params}`);
        const data = await res.json();
        setMatchStatus(data.matched ? 'matched' : 'unmatched');
      } catch {
        setMatchStatus('idle');
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.firstName, form.familyName, form.graduationYear]);

  // Derived cascading location data
  const phRegions = phLocations?.regions ?? [];
  const phProvinces = phRegions.find(r => r.name === form.region)?.provinces ?? [];
  const phCities = phProvinces.find(p => p.name === form.province)?.cities ?? [];
  const phBarangays = phCities.find(c => c.name === form.city)?.barangays ?? [];

  const inputCls = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

  //  Input handlers
  const setF = (field: keyof PersonalFormData, value: PersonalFormData[keyof PersonalFormData]) => {
    setForm(f => ({ ...f, [field]: value }));
  };

  const toggleArr = (field: keyof PersonalFormData, value: string) => {
    setForm(f => {
      const arr = f[field] as string[];
      return { ...f, [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };

  //  Validation
  const validatePersonalStep = (): boolean => {
    setStepError('');
    if (step === 1) {
      if (!form.email.trim() || !form.email.includes('@')) {
        setStepError('Please enter a valid email address.');
        return false;
      }
      if (form.password.length < 8) {
        setStepError('Password must be at least 8 characters.');
        return false;
      }
      if (form.password !== form.confirmPassword) {
        setStepError('Passwords do not match.');
        return false;
      }
    }
    if (step === 2) {
      if (!form.familyName.trim()) {
        setStepError('Family name is required.');
        return false;
      }
      if (!form.firstName.trim()) {
        setStepError('First name is required.');
        return false;
      }
      if (!form.gender) {
        setStepError('Gender is required.');
        return false;
      }
      if (!form.birthDate) {
        setStepError('Date of birth is required.');
        return false;
      }
      if (!form.mobile.trim()) {
        setStepError('Mobile number is required.');
        return false;
      }
      if (!form.region) {
        setStepError('Region is required.');
        return false;
      }
      if (!form.province) {
        setStepError('Province is required.');
        return false;
      }
      if (!form.city) {
        setStepError('City / Municipality is required.');
        return false;
      }
    }
    if (step === 3) {
      if (form.hasGraduated && !form.graduationDate.trim()) {
        setStepError('Graduation date is required.');
        return false;
      }
    }
    return true;
  };

  const nextPersonalStep = () => {
    if (!validatePersonalStep()) return;

    if (step === 3) {
      // Always collect biometrics — backend requires face images for all alumni
      setStep(4 as PersonalStep);
    } else {
      setStep((s) => (s + 1) as PersonalStep);
    }
  };

  const prevPersonalStep = () => {
    setStepError('');
    setStep((s) => (s - 1) as PersonalStep);
  };

  //  Camera handlers
  const startCamera = async () => {
    setCameraError('');
    setStepError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError('Camera access denied. Please allow camera permission and try again.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  const captureShot = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setStepError('');
    setCheckingBlur(true);

    try {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) {
        setStepError('Unable to capture image. Please try again.');
        setCheckingBlur(false);
        return;
      }

      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);

      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.9);
      const isBlurry = await isImageBlurry({ dataUrl, threshold: FACE_BLUR_THRESHOLD });

      if (isBlurry) {
        setStepError('Image too blurry. Please try again.');
        setCheckingBlur(false);
        return;
      }

      const descriptor = await extractFaceDescriptorFromDataUrl(dataUrl);
      if (!descriptor) {
        setStepError('Could not detect face. Please try again.');
        setCheckingBlur(false);
        return;
      }

      const response = await fetch(dataUrl);
      const blob = await response.blob();

      if (shotIndex === 0) {
        setCaptureTime(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }));
      }
      setPreviews((p) => [...p, dataUrl]);
      setCapturedShots((c) => [...c, blob]);
      setDescriptorSamples((d) => [...d, descriptor]);
      setShotIndex((i) => i + 1);

      if (shotIndex === 2) {
        stopCamera();
      }

      setCheckingBlur(false);
    } catch (err) {
      console.error(err);
      setStepError('Error capturing image. Please try again.');
      setCheckingBlur(false);
    }
  };

  const retakeAll = () => {
    setPreviews([]);
    setCapturedShots([]);
    setDescriptorSamples([]);
    setShotIndex(0);
    setCaptureTime(null);
    setStepError('');
    setCheckingBlur(false);
    void startCamera();
  };

  const handleBiometricSubmit = async () => {
    if (capturedShots.length < 3) {
      setStepError('Please capture all 3 face angles.');
      return;
    }

    setIsSaving(true);
    try {
      const averagedDescriptor = averageFaceDescriptors(descriptorSamples);
      const biometricData: BiometricData = {
        front: capturedShots[0],
        left: capturedShots[1],
        right: capturedShots[2],
        descriptor: averagedDescriptor,
        descriptorSamples,
      };
      await onComplete(form, biometricData, matchStatus);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSaving(false);
    }
  };

  //  Main render
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => (step === 1 ? navigate('/') : prevPersonalStep())}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition"
        >
          <ArrowLeft className="size-4 text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>
              Alumni Registration
            </p>
            <p className="text-gray-400 text-xs">Personal Information & Verification</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-lg">
          {/* Stepper */}
          <div className="flex items-center mb-8">
            {PERSONAL_STEP_CONFIG.map((s, i) => (
              <div key={s.n} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={`flex size-7 items-center justify-center rounded-full text-xs transition-all ${
                      step > s.n
                        ? 'bg-emerald-500 text-white'
                        : step === s.n
                          ? 'bg-[#166534] text-white'
                          : 'bg-gray-200 text-gray-400'
                    }`}
                    style={{ fontWeight: 700 }}
                  >
                    {step > s.n ? <CheckCircle2 className="size-3.5" /> : s.n}
                  </div>
                  <p
                    className={`mt-1 whitespace-nowrap text-center ${step >= s.n ? 'text-gray-700' : 'text-gray-400'}`}
                    style={{ fontWeight: step === s.n ? 600 : 400, fontSize: '0.62rem' }}
                  >
                    {s.label}
                  </p>
                </div>
                {i < 3 && <div className={`flex-1 h-px mx-1 mb-5 ${step > s.n ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          {/* STEP 1: Account Setup */}
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
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input
                      type="email"
                      placeholder="your.email@example.com"
                      value={form.email}
                      onChange={(e) => setF('email', e.target.value)}
                      className={`${inputCls} pl-10`}
                    />
                  </div>
                  <p className="text-gray-400 text-xs mt-1.5">This will be your login email address.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showPass ? 'text' : 'password'}
                        placeholder="Min. 8 characters"
                        value={form.password}
                        onChange={(e) => setF('password', e.target.value)}
                        className={`${inputCls} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      placeholder="Repeat password"
                      value={form.confirmPassword}
                      onChange={(e) => setF('confirmPassword', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} navigationUrl="/" />
              <p className="text-center text-gray-400 text-xs mt-4">
                Already have an account?{' '}
                <button onClick={() => navigate('/')} className="text-[#166534] hover:underline" style={{ fontWeight: 500 }}>
                  Sign in
                </button>
              </p>
            </div>
          )}

          {/* STEP 2: Personal Information */}
          {step === 2 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={User} title="Personal Information" subtitle="Your basic details and contact information." />

              {stepError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Family Name *
                    </label>
                    <input
                      type="text"
                      placeholder="Surname"
                      value={form.familyName}
                      onChange={(e) => setF('familyName', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      First Name *
                    </label>
                    <input
                      type="text"
                      placeholder="Given name"
                      value={form.firstName}
                      onChange={(e) => setF('firstName', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Middle Name
                    </label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={form.middleName}
                      onChange={(e) => setF('middleName', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Masterlist match indicator */}
                {matchStatus === 'checking' && (
                  <div className="flex items-center gap-2 text-gray-400 text-xs">
                    <span className="size-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    Checking graduate list…
                  </div>
                )}
                {matchStatus === 'matched' && (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-700 text-xs">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span><strong>Found in BSIS graduate list.</strong> Your account will be automatically verified once submitted.</span>
                  </div>
                )}
                {matchStatus === 'unmatched' && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700 text-xs">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>Not found in the masterlist. Your account will go through manual admin verification.</span>
                  </div>
                )}

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Gender *
                  </label>
                  <div className="flex gap-2">
                    {['Male', 'Female'].map((g) => (
                      <RadioOption key={g} label={g} value={g} current={form.gender} onSelect={(v) => setF('gender', v as string)} />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Birth Date *
                    </label>
                    <input
                      type="date"
                      value={form.birthDate}
                      onChange={(e) => setF('birthDate', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Civil Status
                    </label>
                    <select value={form.civilStatus} onChange={(e) => setF('civilStatus', e.target.value)} className={inputCls}>
                      <option value="">Select</option>
                      <option>Single</option>
                      <option>Married</option>
                      <option>Widowed</option>
                      <option>Separated</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Mobile Number *
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={form.mobileCountryCode}
                      onChange={(e) => setF('mobileCountryCode', e.target.value)}
                      className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                    >
                      <option value="+63">+63 Philippines</option>
                      <option value="+1">+1 United States</option>
                      <option value="+44">+44 United Kingdom</option>
                      <option value="+61">+61 Australia</option>
                      <option value="+65">+65 Singapore</option>
                      <option value="+60">+60 Malaysia</option>
                      <option value="+81">+81 Japan</option>
                      <option value="+82">+82 Korea</option>
                      <option value="+86">+86 China</option>
                      <option value="+971">+971 UAE</option>
                    </select>
                    <div className="relative flex-1">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                      <input
                        type="tel"
                        placeholder="9XXXXXXXXX"
                        value={form.mobile}
                        maxLength={10}
                        minLength={10}
                        onChange={(e) => setF('mobile', e.target.value.replace(/\D/g, ''))}
                        className={`${inputCls} pl-10`}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Facebook URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://facebook.com/yourprofile"
                    value={form.facebook}
                    onChange={(e) => setF('facebook', e.target.value)}
                    className={inputCls}
                  />
                </div>

                {/* Cascading location: Region → Province → City → Barangay */}
                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Region *
                  </label>
                  <select
                    value={form.region}
                    onChange={(e) => { setF('region', e.target.value); setF('province', ''); setF('city', ''); setF('barangay', ''); }}
                    className={inputCls}
                  >
                    <option value="">Select Region</option>
                    {phRegions.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Province *
                    </label>
                    <select
                      value={form.province}
                      onChange={(e) => { setF('province', e.target.value); setF('city', ''); setF('barangay', ''); }}
                      disabled={!form.region}
                      className={inputCls}
                    >
                      <option value="">Select Province</option>
                      {phProvinces.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      City / Municipality *
                    </label>
                    <select
                      value={form.city}
                      onChange={(e) => {
                        const city = phCities.find(c => c.name === e.target.value);
                        setF('city', e.target.value);
                        setF('barangay', '');
                      }}
                      disabled={!form.province}
                      className={inputCls}
                    >
                      <option value="">Select City</option>
                      {phCities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Barangay <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  {phBarangays.length > 0 ? (
                    <select
                      value={form.barangay}
                      onChange={(e) => setF('barangay', e.target.value)}
                      disabled={!form.city}
                      className={inputCls}
                    >
                      <option value="">Select Barangay</option>
                      {phBarangays.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder={form.city ? 'Enter barangay' : 'Select a city first'}
                      value={form.barangay}
                      onChange={(e) => setF('barangay', e.target.value)}
                      disabled={!form.city}
                      className={inputCls}
                    />
                  )}
                </div>
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} />
            </div>
          )}

          {/* STEP 3: Education Background */}
          {step === 3 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={BookOpen} title="Educational Background" subtitle="Your graduation and academic details." />

              {stepError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Have you graduated? *
                  </label>
                  <div className="flex gap-2">
                    {[
                      { label: 'Yes, I have graduated', value: true },
                      // { label: 'Not yet, currently in school', value: false },
                    ].map((opt) => (
                      <RadioOption
                        key={opt.label}
                        label={opt.label}
                        value={opt.value}
                        current={form.hasGraduated}
                        onSelect={(v) => setF('hasGraduated', v as boolean)}
                      />
                    ))}
                  </div>
                </div>

                {form.hasGraduated && (
                  <>
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Date of Graduation *
                      </label>
                      <input
                        type="date"
                        value={form.graduationDate}
                        onChange={(e) => {
                          setF('graduationDate', e.target.value);
                          const year = new Date(e.target.value).getFullYear();
                          setF('graduationYear', year);
                        }}
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Scholarship Availed
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. CHED, SUC Scholar, None"
                        value={form.scholarship}
                        onChange={(e) => setF('scholarship', e.target.value)}
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Highest Attainment
                      </label>
                      <select value={form.highestAttainment} onChange={(e) => setF('highestAttainment', e.target.value)} className={inputCls}>
                        <option value="">Select</option>
                        <option>Bachelor&apos;s Degree</option>
                        <option>Master&apos;s Degree</option>
                        <option>Doctorate</option>
                      </select>
                    </div>

                    {["Master's Degree", "Doctorate"].includes(form.highestAttainment) && (
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          Graduate School / University
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. University of the Philippines"
                          value={form.graduateSchool}
                          onChange={(e) => setF('graduateSchool', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        Professional Eligibility / Certifications
                      </label>
                      <div className="space-y-1.5">
                        {['Civil Service Exam', 'TESDA', 'Board Exam', 'Others'].map((opt) => (
                          <CheckOption
                            key={opt}
                            label={opt}
                            checked={form.profEligibility.includes(opt)}
                            onChange={() => toggleArr('profEligibility', opt)}
                          />
                        ))}
                      </div>
                      {form.profEligibility.includes('Others') && (
                        <input
                          type="text"
                          placeholder="Please specify certification"
                          value={form.profEligibilityOther}
                          onChange={(e) => setF('profEligibilityOther', e.target.value)}
                          className={`${inputCls} mt-2`}
                        />
                      )}
                    </div>
                  </>
                )}

                {!form.hasGraduated && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 text-sm">
                      <span style={{ fontWeight: 600 }}>Note:</span> Since you haven&apos;t graduated yet, the employment survey will be skipped. Biometric verification is still required for all alumni registrations.
                    </p>
                  </div>
                )}
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} nextLabel="Verify Identity" />
            </div>
          )}

          {/* STEP 4: Biometric Verification (all alumni) */}
          {step === 4 && (() => {
            const allCaptured = shotIndex >= 3;
            return (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 shrink-0">
                      <Camera className="size-5 text-emerald-600" />
                    </div>
                    <div>
                      <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Biometric Face Capture</h2>
                      <p className="text-gray-500 text-xs mt-0.5">
                        Three photos required — facing forward, turning left, and turning right — to prevent identity spoofing.
                      </p>
                    </div>
                  </div>

                  {stepError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                      <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-700 text-xs">{stepError}</p>
                    </div>
                  )}
                  {cameraError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                      <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-700 text-xs">{cameraError}</p>
                    </div>
                  )}

                  {/* Shot progress tiles */}
                  <div className="flex gap-2 mb-4">
                    {SHOT_INSTRUCTIONS.map((s, i) => (
                      <div key={i} className={`flex-1 rounded-xl border p-2.5 text-center transition ${
                        previews[i] ? 'border-emerald-200 bg-emerald-50' :
                        shotIndex === i && cameraOn ? 'border-[#166534] bg-[#166534]/5' :
                        'border-gray-200 bg-gray-50'
                      }`}>
                        <div className={`flex size-6 items-center justify-center rounded-full mx-auto mb-1 ${
                          previews[i] ? 'bg-emerald-500' :
                          shotIndex === i && cameraOn ? 'bg-[#166534]' : 'bg-gray-200'
                        }`}>
                          {previews[i]
                            ? <CheckCircle2 className="size-3.5 text-white" />
                            : <span className="text-white" style={{ fontWeight: 700, fontSize: '0.6rem' }}>{i + 1}</span>}
                        </div>
                        <p className={`whitespace-nowrap text-center ${
                          previews[i] ? 'text-emerald-700' :
                          shotIndex === i && cameraOn ? 'text-[#166534]' : 'text-gray-400'
                        }`} style={{ fontWeight: 600, fontSize: '0.6rem' }}>
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Camera viewport */}
                  <div className="relative bg-gray-900 rounded-2xl overflow-hidden mb-4 flex items-center justify-center w-full max-w-[400px] mx-auto" style={{ aspectRatio: '4/3', maxHeight: '300px' }}>
                    {!cameraOn && !allCaptured && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <Camera className="size-12 text-gray-600 mb-2" />
                        <p className="text-gray-400 text-sm">Camera not started</p>
                        <p className="text-gray-600 text-xs mt-1">Tap "Start Camera" below</p>
                      </div>
                    )}

                    <video
                      ref={videoRef}
                      className={`absolute inset-0 w-full h-full object-cover object-center ${(!cameraOn || allCaptured) ? 'hidden' : ''}`}
                      playsInline muted autoPlay
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* All shots captured — 3-column thumbnail grid */}
                    {allCaptured && (
                      <div className="absolute inset-0 grid grid-cols-3 gap-0.5">
                        {previews.map((preview, i) => (
                          <div key={i} className="relative overflow-hidden">
                            <img src={preview} alt={`Shot ${i + 1}`} className="w-full h-full object-cover object-center" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1.5">
                              <p className="text-white text-center" style={{ fontWeight: 600, fontSize: '0.55rem' }}>
                                {SHOT_INSTRUCTIONS[i].label}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Face guide overlay when camera is live */}
                    {cameraOn && !allCaptured && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="size-32 rounded-full border-2 border-dashed border-white/50" />
                        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                          <div className="bg-black/65 rounded-full px-4 py-1.5">
                            <p className="text-white text-xs" style={{ fontWeight: 600 }}>
                              Shot {shotIndex + 1}/3 — {SHOT_INSTRUCTIONS[shotIndex]?.label}: {SHOT_INSTRUCTIONS[shotIndex]?.desc}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Timestamp badge when all captured */}
                    {captureTime && allCaptured && (
                      <div className="absolute top-2 right-2 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-white text-xs">{captureTime}</span>
                      </div>
                    )}
                  </div>

                  {/* Camera controls */}
                  <div className="flex gap-2">
                    {!cameraOn && !allCaptured && (
                      <button onClick={startCamera}
                        className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
                        style={{ fontWeight: 600 }}>
                        <Video className="size-4" /> Start Camera
                      </button>
                    )}
                    {cameraOn && !allCaptured && (
                      <>
                        <button onClick={stopCamera}
                          className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition"
                          title="Stop camera">
                          <VideoOff className="size-4" />
                        </button>
                        <button onClick={() => { void captureShot(); }}
                          disabled={checkingBlur}
                          className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm transition"
                          style={{ fontWeight: 600 }}>
                          {checkingBlur
                            ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking clarity</>
                            : <><Camera className="size-4" /> Capture {shotIndex + 1}/3 — {SHOT_INSTRUCTIONS[shotIndex]?.label}</>
                          }
                        </button>
                      </>
                    )}
                    {allCaptured && (
                      <button onClick={retakeAll}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition"
                        style={{ fontWeight: 500 }}>
                        <RefreshCw className="size-4" /> Retake All
                      </button>
                    )}
                  </div>

                  {/* Success banner */}
                  {allCaptured && (
                    <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                      <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                      <div>
                        <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>All 3 biometric shots captured!</p>
                        {captureTime && <p className="text-emerald-600 text-xs">{captureTime}</p>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Submit / back row */}
                <div className="flex gap-3">
                  <button onClick={prevPersonalStep}
                    className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 py-3 rounded-xl text-sm transition"
                    style={{ fontWeight: 500 }}>
                    <ChevronLeft className="size-4" /> Back
                  </button>
                  <button onClick={handleBiometricSubmit} disabled={isSaving || !allCaptured}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm transition ${
                      allCaptured && !isSaving ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                    style={{ fontWeight: 600 }}>
                    {isSaving
                      ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting...</>
                      : 'Continue to Employment Survey →'
                    }
                  </button>
                </div>
                {!allCaptured && (
                  <p className="text-center text-gray-400 text-xs">
                    All 3 face captures (forward, left, right) are required to continue.
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
