/**
 * Alumni Registration Orchestrator
 * Coordinates the two-phase registration flow:
 *   Phase 1 (personal): RegisterAlumniPersonal - account, personal info, biometrics
 *   Phase 2 (employment): RegisterAlumniEmployment - employment survey (graduated users only)
 *
 * Single FormData submission happens here after all data is collected.
 */

import { useReducer, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { GraduationCap, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { clearRegistrationDrafts } from './registration-draft';
import RegisterAlumniPersonal, { type PersonalFormData, type BiometricData, type MasterlistMatchStatus } from './register-alumni-personal';
import RegisterAlumniEmployment, { type EmploymentFormData } from './register-alumni-employment';
import RegisterTerms, { type ConsentData } from './register-terms';
import { registerAlumni, ApiClientError } from '../app/api-client';

// ── Types ──────────────────────────────────────────────────────────────────────

type RegistrationStage = 'personal' | 'employment' | 'terms' | 'complete' | 'error';

interface RegistrationState {
  stage: RegistrationStage;
  personalData: PersonalFormData | null;
  biometricData: BiometricData | null;
  employmentData: EmploymentFormData | null;
  isSubmitting: boolean;
  submitError: string | null;
  firstName: string;
  matchStatus: MasterlistMatchStatus;
  /** Per-field problems the server rejected, shown on the owning form. */
  fieldErrors: Record<string, string> | null;
}

type Action =
  | { type: 'SET_PERSONAL_DATA'; personalData: PersonalFormData }
  | { type: 'SET_BIOMETRIC_DATA'; biometricData: BiometricData | null }
  | { type: 'SET_EMPLOYMENT_DATA'; employmentData: EmploymentFormData }
  | { type: 'GO_TO_EMPLOYMENT' }
  | { type: 'GO_TO_TERMS' }
  | { type: 'GO_TO_COMPLETE'; firstName: string }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'NEEDS_CORRECTION'; step: RegistrationStage; fieldErrors: Record<string, string> }
  | { type: 'SET_MATCH_STATUS'; matchStatus: MasterlistMatchStatus }
  | { type: 'RETRY' };

const INITIAL_STATE: RegistrationState = {
  stage: 'personal',
  personalData: null,
  biometricData: null,
  employmentData: null,
  isSubmitting: false,
  submitError: null,
  firstName: '',
  matchStatus: 'idle',
  fieldErrors: null,
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
    case 'GO_TO_TERMS':
      return { ...state, stage: 'terms' };
    case 'GO_TO_COMPLETE':
      return { ...state, stage: 'complete', firstName: action.firstName, isSubmitting: false };
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting, submitError: null };
    case 'SET_ERROR':
      return { ...state, stage: 'error', isSubmitting: false, submitError: action.error };
    case 'NEEDS_CORRECTION':
      // Deliberately NOT the 'error' stage: personalData, employmentData and
      // biometricData all stay in state, so the graduate returns to the form
      // that owns the bad answer with everything else intact — no retyping and
      // no second face scan.
      return {
        ...state,
        stage: action.step,
        isSubmitting: false,
        submitError: null,
        fieldErrors: action.fieldErrors,
      };
    case 'SET_MATCH_STATUS':
      return { ...state, matchStatus: action.matchStatus };
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

function RegistrationComplete({ firstName, matchStatus, navigate }: { firstName: string; matchStatus: MasterlistMatchStatus; navigate: (path: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      // Newly registered graduates are PENDING until the BSIS admin approves —
      // route them to the pending page, not the dashboard.
      navigate('/alumni/pending');
    }, 4000); // 4 second delay before auto-redirect

    return () => clearTimeout(timer);
  }, [navigate]);

  const isMatched = matchStatus === 'matched';

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

          {isMatched ? (
            <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 mb-6">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-700 text-xs" style={{ fontWeight: 600 }}>Matched in BSIS Graduate List - Auto-Verified</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 mb-6">
              <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-700 text-xs" style={{ fontWeight: 600 }}>Pending BSIS Admin Verification</span>
            </div>
          )}

          <p className="text-gray-500 text-sm mb-7 max-w-xs mx-auto leading-relaxed">
            {isMatched
              ? 'Your name was found in the BSIS graduate list. Your account has been automatically verified and is ready to use.'
              : 'Your account and CHED Graduate Tracer survey have been submitted. The BSIS Admin will review your face recognition scan and verify your identity.'}
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

  const submitRegistration = async (
    personalData: PersonalFormData,
    employmentData: EmploymentFormData | null,
    biometricData: BiometricData | null | undefined,
    consent: ConsentData,
  ) => {
    dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
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
      payload.append('region', personalData.region || '');
      payload.append('province', personalData.province);
      payload.append('city', personalData.city);
      payload.append('barangay', personalData.barangay || '');
      payload.append('home_is_abroad', personalData.homeIsAbroad ? 'true' : 'false');
      payload.append('home_country', personalData.homeCountry || (personalData.homeIsAbroad ? '' : 'Philippines'));
      payload.append('graduation_date', personalData.graduationDate || '');
      payload.append('graduation_year', personalData.graduationYear?.toString() || '');
      payload.append('scholarship', personalData.scholarship || '');
      // Further-studies replaces the old highest_attainment / graduate_school question.
      payload.append('further_studies_status', personalData.furtherStudies);
      payload.append('postgrad_program', personalData.postgradProgram || '');
      payload.append('postgrad_field', personalData.postgradField || '');
      payload.append('postgrad_school', personalData.postgradSchool || '');
      payload.append('postgrad_year_started', personalData.postgradYearStarted || '');
      payload.append('postgrad_year_completed', personalData.postgradYearCompleted || '');
      payload.append('prof_eligibility', personalData.profEligibility.join(','));
      payload.append('prof_eligibility_other', personalData.profEligibilityOther || '');
      payload.append('employment_status', employmentData?.employment_status || 'unemployed');
      payload.append('capture_time', new Date().toISOString());
      // Consent is recorded, not just enforced client-side. Geomap consent is
      // separate from the terms: an alumnus can join the study yet decline to
      // be plotted on the public map.
      payload.append('terms_accepted', consent.termsAccepted ? 'true' : 'false');
      payload.append('geomap_consent', consent.geomapConsent ? 'true' : 'false');

      if (employmentData) {
        payload.append('survey_data', JSON.stringify(employmentData));
      }
      if (biometricData) {
        payload.append('face_descriptor', JSON.stringify(biometricData.descriptor));
        payload.append('face_descriptor_samples', JSON.stringify(biometricData.descriptorSamples));
        // One frontal photo only. The blink and head-turn stages prove liveness
        // but intentionally save no image, so there is nothing else to upload.
        payload.append('face_front', biometricData.image, `face_front_${Date.now()}.jpg`);
        // GPS stamp for the identity audit trail (PRD Module A). The backend has
        // always read these keys; the registration form simply never sent them,
        // so every graduate on record has a null capture location.
        if (biometricData.gps) {
          payload.append('gps_lat', String(biometricData.gps.lat));
          payload.append('gps_lng', String(biometricData.gps.lng));
          payload.append('gps_accuracy_m', String(biometricData.gps.acc));
        }
        // Per-stage liveness measurements, stored on the backend under
        // biometric_template.liveness_signals. slot_kinds must mirror the
        // stages actually performed — it previously claimed a mouth_open
        // challenge that the flow had already stopped asking for.
        payload.append(
          'liveness_signals',
          JSON.stringify({
            head_turn_direction: biometricData.headTurnDirection,
            samples: biometricData.livenessSignals,
            slot_kinds: [
              'neutral',
              'blink',
              `head_turn_${biometricData.headTurnDirection}`,
            ],
            captured_at: new Date().toISOString(),
          }),
        );
      }

      const response = await registerAlumni(payload);
      sessionStorage.setItem('alumni_user', JSON.stringify(response.alumni));
      // Registration succeeded, so the drafts have served their purpose. Left
      // behind, the next graduate to register in this tab would inherit these
      // answers as their own starting point.
      clearRegistrationDrafts();
      dispatch({ type: 'GO_TO_COMPLETE', firstName: personalData.firstName });
    } catch (error: unknown) {
      // The clean-data gate rejects impossible answers with the field(s) at
      // fault and the form that owns them. Route there rather than dropping the
      // graduate into a dead-end error screen that discards their work.
      const payload = error instanceof ApiClientError
        ? (error.payload as { field_errors?: Record<string, string>; step?: string } | undefined)
        : undefined;
      if (payload?.field_errors && Object.keys(payload.field_errors).length > 0) {
        dispatch({
          type: 'NEEDS_CORRECTION',
          step: payload.step === 'personal' ? 'personal' : 'employment',
          fieldErrors: payload.field_errors,
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Registration failed. Please try again.';
      dispatch({ type: 'SET_ERROR', error: message });
    }
  };

  const handlePersonalComplete = (personalData: PersonalFormData, biometricData?: BiometricData, matchStatus?: MasterlistMatchStatus) => {
    dispatch({ type: 'SET_PERSONAL_DATA', personalData });
    dispatch({ type: 'SET_BIOMETRIC_DATA', biometricData: biometricData ?? null });
    if (matchStatus) dispatch({ type: 'SET_MATCH_STATUS', matchStatus });

    // All registrants are alumni (BSIS bachelor's holders) → always go to employment survey.
    dispatch({ type: 'GO_TO_EMPLOYMENT' });
  };

  // Employment no longer submits directly — consent is the final gate.
  const handleEmploymentComplete = async (employmentData: EmploymentFormData) => {
    dispatch({ type: 'SET_EMPLOYMENT_DATA', employmentData });
    dispatch({ type: 'GO_TO_TERMS' });
  };

  const handleConsentComplete = async (consent: ConsentData) => {
    if (state.personalData) {
      await submitRegistration(
        state.personalData,
        state.employmentData,
        state.biometricData,
        consent,
      );
    }
  };

  const handleEmploymentBack = () => {
    dispatch({ type: 'SET_PERSONAL_DATA', personalData: state.personalData! });
    // Go back to personal - restart from step 3 would be ideal but full restart is safe
    dispatch({ type: 'RETRY' });
  };

  // Render based on stage
  if (state.isSubmitting) {
    return <SubmittingOverlay />;
  }

  if (state.stage === 'complete') {
    return <RegistrationComplete firstName={state.firstName} matchStatus={state.matchStatus} navigate={navigate} />;
  }

  if (state.stage === 'error') {
    return <ErrorState error={state.submitError!} onRetry={() => dispatch({ type: 'RETRY' })} />;
  }

  if (state.stage === 'terms') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Graduate Registration</p>
            <p className="text-gray-400 text-xs">Carlos Hilado Memorial State University · BSIS Graduate Tracer System</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center px-4 py-8">
          <div className="w-full max-w-lg">
            <ProgressIndicator stage="employment" />
            <RegisterTerms
              onComplete={handleConsentComplete}
              onBack={() => dispatch({ type: 'GO_TO_EMPLOYMENT' })}
            />
          </div>
        </div>
      </div>
    );
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
            <p className="text-gray-400 text-xs">Carlos Hilado Memorial State University · BSIS Graduate Tracer System</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center px-4 py-8">
          <div className="w-full max-w-lg">
            <ProgressIndicator stage="employment" />
            <RegisterAlumniEmployment
              onComplete={handleEmploymentComplete}
              onBack={handleEmploymentBack}
              initialForm={state.employmentData}
              fieldErrors={state.fieldErrors}
            />
          </div>
        </div>
      </div>
    );
  }

  // Default: personal stage
  return (
    <RegisterAlumniPersonal
      onComplete={handlePersonalComplete}
      initialForm={state.personalData}
      initialBiometric={state.biometricData}
      fieldErrors={state.fieldErrors}
    />
  );
}
