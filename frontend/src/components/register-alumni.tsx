/**
 * Alumni Registration Orchestrator
 * Coordinates the two-phase registration flow:
 *   Phase 1 (personal): RegisterAlumniPersonal — account, personal info, biometrics
 *   Phase 2 (employment): RegisterAlumniEmployment — employment survey (graduated users only)
 *
 * Single FormData submission happens here after all data is collected.
 */

import { useReducer } from 'react';
import { useNavigate } from 'react-router';
import { GraduationCap, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import RegisterAlumniPersonal, { type PersonalFormData, type BiometricData } from './register-alumni-personal';
import RegisterAlumniEmployment, { type EmploymentFormData } from './register-alumni-employment';
import { registerAlumni } from '../app/api-client';

// ── Types ──────────────────────────────────────────────────────────────────────

type RegistrationStage = 'personal' | 'employment' | 'complete' | 'error';

interface RegistrationState {
  stage: RegistrationStage;
  personalData: PersonalFormData | null;
  biometricData: BiometricData | null;
  employmentData: EmploymentFormData | null;
  isSubmitting: boolean;
  submitError: string | null;
  firstName: string;
}

type Action =
  | { type: 'SET_PERSONAL_DATA'; personalData: PersonalFormData }
  | { type: 'SET_BIOMETRIC_DATA'; biometricData: BiometricData | null }
  | { type: 'SET_EMPLOYMENT_DATA'; employmentData: EmploymentFormData }
  | { type: 'GO_TO_EMPLOYMENT' }
  | { type: 'GO_TO_COMPLETE'; firstName: string }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RETRY' };

const INITIAL_STATE: RegistrationState = {
  stage: 'personal',
  personalData: null,
  biometricData: null,
  employmentData: null,
  isSubmitting: false,
  submitError: null,
  firstName: '',
};

function reducer(state: RegistrationState, action: Action): RegistrationState {
  switch (action.type) {
    case 'SET_PERSONAL_DATA':
      return { ...state, personalData: action.personalData };
    case 'SET_BIOMETRIC_DATA':
      return { ...state, biometricData: action.biometricData };
    case 'SET_EMPLOYMENT_DATA':
      return { ...state, employmentData: action.employmentData };
    case 'GO_TO_EMPLOYMENT':
      return { ...state, stage: 'employment' };
    case 'GO_TO_COMPLETE':
      return { ...state, stage: 'complete', firstName: action.firstName };
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting, submitError: null };
    case 'SET_ERROR':
      return { ...state, stage: 'error', isSubmitting: false, submitError: action.error };
    case 'RETRY':
      return { ...state, stage: 'personal', submitError: null };
    default:
      return state;
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProgressIndicator({ stage }: { stage: RegistrationStage }) {
  const stages = [
    { key: 'personal', label: 'Personal Info' },
    { key: 'employment', label: 'Employment' },
    { key: 'complete', label: 'Complete' },
  ] as const;

  const activeIdx = stages.findIndex(s => s.key === stage);

  return (
    <div className="flex items-center gap-2 mb-6">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1 last:flex-none">
          <div className={`flex size-6 items-center justify-center rounded-full text-xs shrink-0 transition-all ${
            i < activeIdx ? 'bg-emerald-500 text-white' :
            i === activeIdx ? 'bg-[#166534] text-white' : 'bg-gray-200 text-gray-400'
          }`} style={{ fontWeight: 700 }}>
            {i < activeIdx ? <CheckCircle2 className="size-3.5" /> : i + 1}
          </div>
          <p className={`ml-1 text-xs ${i <= activeIdx ? 'text-gray-700' : 'text-gray-400'}`} style={{ fontWeight: i === activeIdx ? 600 : 400 }}>
            {s.label}
          </p>
          {i < stages.length - 1 && (
            <div className={`flex-1 h-px mx-2 ${i < activeIdx ? 'bg-emerald-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function RegistrationComplete({ firstName, navigate }: { firstName: string; navigate: (path: string) => void }) {
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
          <p className="text-gray-600 text-sm mb-1">Welcome, {firstName}!</p>
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 mb-6">
            <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-700 text-xs" style={{ fontWeight: 600 }}>Pending Program Chair Verification</span>
          </div>
          <p className="text-gray-500 text-sm mb-7 max-w-xs mx-auto leading-relaxed">
            Your account and CHED Graduate Tracer survey have been submitted. The Program Chair will review your biometric submission and verify your identity.
          </p>
          <button
            onClick={() => navigate('/alumni/dashboard')}
            className="flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-8 py-3 rounded-xl text-sm transition mx-auto"
            style={{ fontWeight: 600 }}
          >
            Go to My Dashboard <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SubmittingOverlay() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center max-w-sm w-full mx-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50 mx-auto mb-5">
          <span className="size-8 border-4 border-emerald-200 border-t-emerald-500 rounded-full animate-spin" />
        </div>
        <h2 className="text-gray-900 mb-2" style={{ fontWeight: 700 }}>Submitting Registration</h2>
        <p className="text-gray-500 text-sm">Please wait while we securely submit your information...</p>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center max-w-sm w-full mx-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-red-50 mx-auto mb-5">
          <AlertCircle className="size-9 text-red-500" />
        </div>
        <h2 className="text-gray-900 mb-2" style={{ fontWeight: 700 }}>Registration Failed</h2>
        <p className="text-gray-500 text-sm mb-6">{error}</p>
        <button
          onClick={onRetry}
          className="bg-[#166534] hover:bg-[#14532d] text-white px-8 py-3 rounded-xl text-sm transition"
          style={{ fontWeight: 600 }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

// ── Main Orchestrator ──────────────────────────────────────────────────────────

export function RegisterAlumni() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

<<<<<<< HEAD
  const submitRegistration = async (
    personalData: PersonalFormData,
    employmentData: EmploymentFormData | null,
    biometricData?: BiometricData | null,
  ) => {
    dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
=======
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<GraduateForm>(INITIAL_FORM);
  const [stepError, setStepError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [employerLinkStatus, setEmployerLinkStatus] = useState('');

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
  const [checkingBlur, setCheckingBlur] = useState(false);

  const allShotsCaptured = shots.every(s => s !== null);
  const availableSkills = referenceData.skills.length > 0
    ? referenceData.skills.map((skill) => skill.name)
    : SKILLS_LIST;
  const employerPortalLink = typeof window === 'undefined'
    ? '/employer'
    : `${window.location.origin}/employer`;

  useEffect(() => { return () => stopCamera(); }, []);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate('/alumni/dashboard'), 3000);
    return () => clearTimeout(t);
  }, [done, navigate]);

  // Helper: set single string field
  const setF = (field: keyof GraduateForm, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleShareEmployerPortalLink = async () => {
>>>>>>> claude/trusting-stonebraker-c03bcd
    try {
      const payload = new FormData();
      payload.append('email', personalData.email.trim().toLowerCase());
      payload.append('password', personalData.password);
      payload.append('confirm_password', personalData.confirmPassword);
      payload.append('first_name', personalData.firstName.trim());
      payload.append('family_name', personalData.familyName.trim());
      payload.append('middle_name', personalData.middleName.trim());
      payload.append('birth_date', personalData.birthDate);
      payload.append('gender', personalData.gender);
      payload.append('civil_status', personalData.civilStatus);
      payload.append('mobile', personalData.mobileCountryCode + personalData.mobile);
      payload.append('mobile_country_code', personalData.mobileCountryCode);
      payload.append('facebook_url', personalData.facebook);
      payload.append('city', personalData.city);
      payload.append('province', personalData.province);
      payload.append('graduation_date', personalData.graduationDate || '');
      payload.append('graduation_year', personalData.graduationYear?.toString() || '');
      payload.append('scholarship', personalData.scholarship || '');
      payload.append('highest_attainment', personalData.highestAttainment || '');
      payload.append('graduate_school', personalData.graduateSchool || '');
      payload.append('prof_eligibility', personalData.profEligibility.join(','));
      payload.append('prof_eligibility_other', personalData.profEligibilityOther || '');
      payload.append('employment_status', employmentData?.employment_status || 'unemployed');
      payload.append('capture_time', new Date().toISOString());

      if (employmentData) {
        payload.append('survey_data', JSON.stringify(employmentData));
      }
      if (biometricData) {
        payload.append('face_descriptor', JSON.stringify(biometricData.descriptor));
        payload.append('face_descriptor_samples', JSON.stringify(biometricData.descriptorSamples));
        payload.append('face_front', biometricData.front, `face_front_${Date.now()}.jpg`);
        payload.append('face_left', biometricData.left, `face_left_${Date.now()}.jpg`);
        payload.append('face_right', biometricData.right, `face_right_${Date.now()}.jpg`);
      }

      const response = await registerAlumni(payload);
      sessionStorage.setItem('alumni_user', JSON.stringify(response.alumni));
      dispatch({ type: 'GO_TO_COMPLETE', firstName: personalData.firstName });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Registration failed. Please try again.';
      dispatch({ type: 'SET_ERROR', error: message });
    }
  };

  const handlePersonalComplete = (personalData: PersonalFormData, biometricData?: BiometricData) => {
    dispatch({ type: 'SET_PERSONAL_DATA', personalData });
    dispatch({ type: 'SET_BIOMETRIC_DATA', biometricData: biometricData ?? null });

    if (!personalData.hasGraduated) {
      // submitRegistration shows SubmittingOverlay → then GO_TO_COMPLETE or SET_ERROR
      void submitRegistration(personalData, null, biometricData);
    } else {
      dispatch({ type: 'GO_TO_EMPLOYMENT' });
    }
  };

  const handleEmploymentComplete = async (employmentData: EmploymentFormData) => {
    dispatch({ type: 'SET_EMPLOYMENT_DATA', employmentData });
    if (state.personalData) {
      await submitRegistration(state.personalData, employmentData, state.biometricData);
    }
  };

  const handleEmploymentBack = () => {
    dispatch({ type: 'SET_PERSONAL_DATA', personalData: state.personalData! });
    // Go back to personal — restart from step 3 would be ideal but full restart is safe
    dispatch({ type: 'RETRY' });
  };

  // Render based on stage
  if (state.isSubmitting) {
    return <SubmittingOverlay />;
  }

  if (state.stage === 'complete') {
    return <RegistrationComplete firstName={state.firstName} navigate={navigate} />;
  }

  if (state.stage === 'error') {
    return <ErrorState error={state.submitError!} onRetry={() => dispatch({ type: 'RETRY' })} />;
  }

  if (state.stage === 'employment') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Graduate Registration</p>
            <p className="text-gray-400 text-xs">CHMSU Talisay · BSIS Graduate Tracer System</p>
          </div>
        </div>
<<<<<<< HEAD
        <div className="flex-1 flex flex-col items-center px-4 py-8">
          <div className="w-full max-w-lg">
            <ProgressIndicator stage="employment" />
            <RegisterAlumniEmployment
              onComplete={handleEmploymentComplete}
              onBack={handleEmploymentBack}
            />
=======
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
              Go to My Dashboard <ChevronRight className="size-4" />
            </button>
            <p className="text-gray-400 text-xs mt-3">Redirecting automatically in a few seconds…</p>
>>>>>>> claude/trusting-stonebraker-c03bcd
          </div>
        </div>
      </div>
    );
  }

  // Default: personal stage
  return <RegisterAlumniPersonal onComplete={handlePersonalComplete} />;
}
