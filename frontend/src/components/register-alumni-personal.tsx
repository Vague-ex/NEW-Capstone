/**
 * Alumni Registration - Personal Information Component
 * Handles: Account Setup, Personal Info, Education Background, Biometric Verification
 * Steps: 1-3 + Biometrics
 *
 * This component collects personal information and captures biometric data for identity verification.
 * After completion, user is directed to employment survey (if graduated) or marked as complete.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  GraduationCap, ArrowLeft, CheckCircle2, AlertCircle,
  User, Mail, Phone, Lock, Eye, EyeOff, Camera, VideoOff,
  RefreshCw, Video, ChevronRight, ChevronLeft,
  BookOpen,
} from 'lucide-react';
import { registerAlumni } from '../app/api-client';
import isImageBlurry from 'is-image-blurry';
import {
  averageFaceDescriptors,
  extractFaceDescriptorFromDataUrl,
} from '../app/modern-face-descriptor';
import { useReferenceData } from '../hooks/useReferenceData';

//  Types

type PersonalStep = 1 | 2 | 3 | 4;

interface PersonalFormData {
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
  city: string;
  province: string;

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
  city: '',
  province: '',
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

function SectionHeader({ icon: Icon, title, subtitle }: any) {
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

function RadioOption({ label, value, current, onSelect }: any) {
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

function CheckOption({ label, checked, onChange }: any) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 rounded border-gray-300" />
      <span className="text-gray-700 text-sm">{label}</span>
    </label>
  );
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled = false }: any) {
  return (
    <div className="flex gap-3 mt-6">
      <button onClick={onBack}
        className="flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
        style={{ fontWeight: 600 }}>
        <ChevronLeft className="size-4" /> Back
      </button>
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

export default function RegisterAlumniPersonal({ onComplete }: { onComplete: (formData: PersonalFormData) => void }) {
  const navigate = useNavigate();
  const { referenceData } = useReferenceData();

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
  const [done, setDone] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const inputCls = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

  //  Input handlers
  const setF = (field: keyof PersonalFormData, value: any) => {
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
      if (!form.mobile.trim()) {
        setStepError('Mobile number is required.');
        return false;
      }
      if (!form.city.trim()) {
        setStepError('City is required.');
        return false;
      }
      if (!form.province.trim()) {
        setStepError('Province is required.');
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

    if (step === 3 && form.hasGraduated) {
      // If graduated, proceed to biometrics (step 4)
      setStep(4 as PersonalStep);
    } else if (step === 3 && !form.hasGraduated) {
      // If NOT graduated, complete personal registration
      handlePersonalComplete();
    } else {
      setStep((s) => (s + 1) as PersonalStep);
    }
  };

  const prevPersonalStep = () => {
    setStepError('');
    setStep((s) => (s - 1) as PersonalStep);
  };

  const handlePersonalComplete = async () => {
    // If user hasn't graduated, complete without biometrics
    onComplete(form);
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
      const isBlurry = await isImageBlurry(dataUrl, FACE_BLUR_THRESHOLD);

      if (isBlurry) {
        setStepError('Image too blurry. Please try again.');
        setCheckingBlur(false);
        return;
      }

      // Extract face descriptor
      const descriptor = await extractFaceDescriptorFromDataUrl(dataUrl);
      if (!descriptor) {
        setStepError('Could not detect face. Please try again.');
        setCheckingBlur(false);
        return;
      }

      // Convert dataUrl to blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      setPreviews((p) => [...p, dataUrl]);
      setCapturedShots((c) => [...c, blob]);
      setDescriptorSamples((d) => [...d, descriptor]);
      setShotIndex((i) => i + 1);

      if (shotIndex === 2) {
        // All 3 shots captured
        stopCamera();
      }

      setCheckingBlur(false);
    } catch (err) {
      console.error(err);
      setStepError('Error capturing image. Please try again.');
      setCheckingBlur(false);
    }
  };

  const handleBiometricSubmit = async () => {
    if (capturedShots.length < 3) {
      setStepError('Please capture all 3 face angles.');
      return;
    }

    setIsSaving(true);
    try {
      // Average the descriptors for final biometric template
      const averagedDescriptor = averageFaceDescriptors(descriptorSamples);

      // Prepare multipart form data
      const payload = new FormData();
      payload.append('email', form.email);
      payload.append('password', form.password);
      payload.append('confirm_password', form.confirmPassword);
      payload.append('family_name', form.familyName);
      payload.append('first_name', form.firstName);
      payload.append('middle_name', form.middleName);
      payload.append('gender', form.gender);
      payload.append('birth_date', form.birthDate);
      payload.append('civil_status', form.civilStatus);
      payload.append('mobile', form.mobileCountryCode + form.mobile);
      payload.append('mobile_country_code', form.mobileCountryCode);
      payload.append('facebook_url', form.facebook);
      payload.append('city', form.city);
      payload.append('province', form.province);
      payload.append('graduation_date', form.graduationDate);
      payload.append('graduation_year', form.graduationYear?.toString() || '');
      payload.append('scholarship', form.scholarship);
      payload.append('highest_attainment', form.highestAttainment);
      payload.append('graduate_school', form.graduateSchool);
      payload.append('prof_eligibility', form.profEligibility.join(','));
      payload.append('prof_eligibility_other', form.profEligibilityOther);
      payload.append('face_descriptor', JSON.stringify(averagedDescriptor));
      payload.append('face_descriptor_samples', JSON.stringify(descriptorSamples));
      payload.append('face_front', capturedShots[0], `face_front_${Date.now()}.jpg`);
      payload.append('face_left', capturedShots[1], `face_left_${Date.now()}.jpg`);
      payload.append('face_right', capturedShots[2], `face_right_${Date.now()}.jpg`);

      const response = await registerAlumni(payload);
      sessionStorage.setItem('alumni_user', JSON.stringify(response.alumni));

      // Mark personal registration as complete
      onComplete(form);
      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setStepError(message);
    } finally {
      setIsSaving(false);
    }
  };

  //  Done screen
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>
            Alumni Registration - Personal Information
          </p>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center max-w-md w-full">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 mx-auto mb-5">
              <CheckCircle2 className="size-9 text-emerald-500" />
            </div>
            <h2 className="text-gray-900 mb-2" style={{ fontWeight: 700, fontSize: '1.4rem' }}>
              Personal Information Verified!
            </h2>
            <p className="text-gray-600 text-sm mb-1">Welcome, {form.firstName}!</p>
            <p className="text-gray-500 text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              Your personal information and biometric verification have been submitted.
            </p>
            <button
              onClick={() => navigate('/alumni/dashboard')}
              className="flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-8 py-3 rounded-xl text-sm transition mx-auto"
              style={{ fontWeight: 600 }}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

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

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} />
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

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Gender *
                  </label>
                  <div className="flex gap-2">
                    {['Male', 'Female'].map((g) => (
                      <RadioOption key={g} label={g} value={g} current={form.gender} onSelect={(v: string) => setF('gender', v)} />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Birth Date
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
                        onChange={(e) => setF('mobile', e.target.value)}
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      City *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Talisay"
                      value={form.city}
                      onChange={(e) => setF('city', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Province *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Negros Occidental"
                      value={form.province}
                      onChange={(e) => setF('province', e.target.value)}
                      className={inputCls}
                    />
                  </div>
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
                      { label: 'Not yet, currently in school', value: false },
                    ].map((opt) => (
                      <RadioOption
                        key={opt.label}
                        label={opt.label}
                        value={opt.value}
                        current={form.hasGraduated}
                        onSelect={(v: boolean) => setF('hasGraduated', v)}
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
                        <option>Bachelor's Degree</option>
                        <option>Master's Degree</option>
                        <option>Doctorate</option>
                      </select>
                    </div>

                    {['Master's Degree', 'Doctorate'].includes(form.highestAttainment) && (
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
                      <span style={{ fontWeight: 600 }}>Note:</span> Since you haven't graduated yet, you can skip the employment survey. We'll collect your employment
                      information once you graduate!
                    </p>
                  </div>
                )}
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} nextLabel={form.hasGraduated ? 'Verify Identity' : 'Complete'} />
            </div>
          )}

          {/* STEP 4: Biometric Verification (only if graduated) */}
          {step === 4 && form.hasGraduated && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Camera} title="Identity Verification" subtitle="Capture your face from 3 angles for biometric verification." />

              {stepError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              {cameraError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{cameraError}</p>
                </div>
              )}

              {!cameraOn ? (
                <div className="space-y-4">
                  <p className="text-gray-600 text-sm">
                    We need to capture your face from 3 angles (front, left angle, right angle) to verify your identity. This ensures secure and accurate registration.
                  </p>

                  <button
                    onClick={startCamera}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-lg transition text-sm"
                    style={{ fontWeight: 600 }}
                  >
                    <Camera className="size-4" /> Start Camera
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gray-900 rounded-lg overflow-hidden aspect-video relative">
                    <video ref={videoRef} className="w-full h-full object-cover" />
                    <canvas ref={canvasRef} className="hidden" />

                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-32 h-40 border-2 border-emerald-400 rounded-lg relative">
                        <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-emerald-400" />
                        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-emerald-400" />
                        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-emerald-400" />
                        <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-emerald-400" />
                      </div>
                    </div>

                    {shotIndex < 3 && (
                      <div className="absolute bottom-4 left-4 right-4 bg-black/70 rounded-lg p-3">
                        <p className="text-white text-xs mb-2" style={{ fontWeight: 600 }}>
                          {SHOT_INSTRUCTIONS[shotIndex]?.label}
                        </p>
                        <p className="text-gray-300 text-xs">{SHOT_INSTRUCTIONS[shotIndex]?.desc}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={stopCamera}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
                      style={{ fontWeight: 600 }}
                    >
                      <VideoOff className="size-4" /> Cancel
                    </button>

                    {shotIndex < 3 ? (
                      <button
                        onClick={captureShot}
                        disabled={checkingBlur}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white transition text-sm ${
                          checkingBlur ? 'bg-gray-300 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600'
                        }`}
                        style={{ fontWeight: 600 }}
                      >
                        <Camera className="size-4" />
                        {checkingBlur ? 'Checking...' : 'Capture'}
                      </button>
                    ) : (
                      <button
                        onClick={handleBiometricSubmit}
                        disabled={isSaving}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white transition text-sm ${
                          isSaving ? 'bg-gray-300 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600'
                        }`}
                        style={{ fontWeight: 600 }}
                      >
                        <CheckCircle2 className="size-4" />
                        {isSaving ? 'Submitting...' : 'Complete'}
                      </button>
                    )}
                  </div>

                  {previews.length > 0 && (
                    <div>
                      <p className="text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        Captured {shotIndex} of 3
                      </p>
                      <div className="flex gap-2">
                        {previews.map((preview, i) => (
                          <div key={i} className="flex-1 aspect-square rounded-lg overflow-hidden border-2 border-emerald-500">
                            <img src={preview} alt={`Capture ${i + 1}`} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
