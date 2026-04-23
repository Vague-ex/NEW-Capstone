/**
 * Alumni Registration Orchestrator
 * Routes between personal information and employment survey components
 * Manages shared form state and handles final submission
 */

import { useState, useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircle, CheckCircle2, Loader } from 'lucide-react';
import RegisterAlumniPersonal, { type PersonalFormData } from './register-alumni-personal';
import RegisterAlumniEmployment, { type EmploymentFormData } from './register-alumni-employment';
import { registerAlumni } from '../app/api-client';

// Types
type RegistrationStage = 'personal' | 'employment' | 'complete' | 'error';

interface CompleteFormData extends PersonalFormData, EmploymentFormData {
  hasGraduated: boolean;
}

<<<<<<< HEAD
interface RegistrationState {
  stage: RegistrationStage;
  personalData: PersonalFormData | null;
  employmentData: EmploymentFormData | null;
  isSubmitting: boolean;
  submitError: string | null;
}

type RegistrationAction =
  | { type: 'SET_PERSONAL_DATA'; personalData: PersonalFormData }
  | { type: 'SET_EMPLOYMENT_DATA'; employmentData: EmploymentFormData }
  | { type: 'GO_TO_EMPLOYMENT' }
  | { type: 'GO_TO_COMPLETE' }
  | { type: 'GO_TO_PERSONAL' }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET_ERROR' };
=======
//  Field Encoding Mappers (for backend compatibility)

const timeToHireMapper = (selection: string | null): number | null => {
  if (!selection) return null;
  const mapping: { [key: string]: number } = {
    'Within 1 month': 1,
    '1-3 months': 3,
    '3-6 months': 4.5,
    '6 months to 1 year': 9,
    '1-2 years': 18,
    'More than 2 years': 30,
  };
  return mapping[selection] || null;
};

const jobApplicationsMapper = (selection: string | null): number | null => {
  if (!selection) return null;
  const mapping: { [key: string]: number } = {
    '1-5 applications': 1,
    '6-15 applications': 2,
    '16-30 applications': 3,
    '31+ applications': 4,
  };
  return mapping[selection] || null;
};

const jobSourceMapper = (selection: string | null): string => {
  if (!selection) return 'other';
  const mapping: { [key: string]: string } = {
    'Personal Network/Referral': 'personal_network',
    'Online Job Portal': 'online_portal',
    'CHMSU Career Fair': 'career_fair',
    'Company Walk-in/Direct Hire': 'walk_in',
    'Social Media': 'social_media',
    'Started own business/Freelance': 'entrepreneurship',
    'Other': 'other',
  };
  return mapping[selection] || 'other';
};

const sectorMapper = (selection: string | null): string | null => {
  if (!selection) return null;
  const mapping: { [key: string]: string } = {
    'Government': 'government',
    'Private': 'private',
    'Entrepreneurial/Freelance/Self-Employed': 'entrepreneurial',
  };
  return mapping[selection] || null;
};

const jobStatusMapper = (selection: string | null): string | null => {
  if (!selection) return null;
  const mapping: { [key: string]: string } = {
    'Regular/Permanent': 'regular',
    'Probationary': 'probationary',
    'Contractual/Casual/Job Order': 'contractual',
    'Self-Employed/Freelance': 'self_employed',
  };
  return mapping[selection] || null;
};

//  Form state type

interface GraduateForm {
  // Step 1: Account
  email: string; password: string; confirmPassword: string;
  // Step 2: Personal
  familyName: string; firstName: string; middleName: string;
  gender: string; birthDate: string; civilStatus: string;
  mobile: string; mobileCountryCode: string; facebook: string; city: string; province: string;
  // Step 3: Education
  graduationDate: string; scholarship: string;
  highestAttainment: string; graduateSchool: string;
  profEligibility: string[]; profEligibilityOther: string;

  // Step 4: Academic & Pre-Employment (NEW)
  general_average_range: number | null;         // 0-5 or null
  academic_honors: number | null;               // 1-4 or null
  prior_work_experience: boolean;               // true/false
  ojt_relevance: number | null;                 // 0-3 or null
  has_portfolio: boolean;                       // true/false
  english_proficiency: number | null;           // 1-3 or null

  // Step 5: Employment Status (NEW)
  employment_status: string;                    // employed_full_time|employed_part_time|self_employed|seeking|not_seeking|never_employed

  // Step 6: First Job Details (EXPANDED)
  timeToHire: string;                           // UI display string
  time_to_hire_months: number | null;           // 1, 3, 4.5, 9, 18, 30
  firstJobSector: string;                       // UI display
  first_job_sector: string | null;              // government|private|entrepreneurial
  firstJobStatus: string;                       // UI display
  first_job_status: string | null;              // regular|probationary|contractual|self_employed
  firstJobTitle: string;
  first_job_title: string;
  firstJobRelated: string;                      // UI: Yes/Somewhat/Not
  first_job_related_to_bsis: boolean | null;
  firstJobUnrelatedReason: string;
  first_job_unrelated_reason: string;
  firstJobUnrelatedOther: string;
  first_job_duration_months: number | null;
  jobRetention: string;
  first_job_applications_count: number | null;  // 1-4 ordinal
  jobSource: string;                            // UI display
  first_job_source: string;                     // personal_network|online_portal|career_fair|walk_in|social_media|entrepreneurship|other
  jobSourceOther: string;

  // Step 7: Current Job (NEW)
  currentJobSector: string;
  current_job_sector: string | null;
  currentJobPosition: string;
  current_job_title: string;
  currentJobCompany: string;
  current_job_company: string;
  currentJobRelated: string;
  current_job_related_to_bsis: boolean | null;
  currentJobLocation: string;                   // UI display
  location_type: boolean | null;                // true=Local, false=Abroad

  // Step 8: Work Address (EXPANDED)
  street_address: string;
  barangay: string;
  city_municipality: string;
  region_address: string;                       // Separate from province (personal)
  zip_code: string;
  country_address: string;                      // Separate from country default
  latitude: number | null;
  longitude: number | null;

  // Step 9: Competency Assessment (EXPANDED)
  technical_skills: string[];                   // Array of selected skill names
  technical_skill_count: number;                // 0-12
  soft_skills: string[];                        // Array of selected skill names
  soft_skill_count: number;                     // 0-10
  professional_certifications: string;
  awards: string;
}

const INITIAL_FORM: GraduateForm = {
  email: '', password: '', confirmPassword: '',
  familyName: '', firstName: '', middleName: '',
  gender: '', birthDate: '', civilStatus: '', mobile: '', mobileCountryCode: '+63', facebook: '', city: '', province: '',
  graduationDate: '', scholarship: '', highestAttainment: '', graduateSchool: '',
  profEligibility: [], profEligibilityOther: '',
  // Step 4: Academic & Pre-Employment
  general_average_range: null,
  academic_honors: null,
  prior_work_experience: false,
  ojt_relevance: null,
  has_portfolio: false,
  english_proficiency: null,
  // Step 5: Employment Status
  employment_status: '',
  // Step 6: First Job Details
  timeToHire: '', time_to_hire_months: null,
  firstJobSector: '', first_job_sector: null,
  firstJobStatus: '', first_job_status: null,
  firstJobTitle: '', first_job_title: '',
  firstJobRelated: '', first_job_related_to_bsis: null,
  firstJobUnrelatedReason: '', first_job_unrelated_reason: '',
  firstJobUnrelatedOther: '', first_job_duration_months: null,
  first_job_applications_count: null,
  jobSource: '', first_job_source: '',
  jobSourceOther: '',
  // Step 7: Current Job
  currentJobSector: '', current_job_sector: null,
  currentJobPosition: '', current_job_title: '',
  currentJobCompany: '', current_job_company: '',
  currentJobRelated: '', current_job_related_to_bsis: null,
  currentJobLocation: '', location_type: null,
  jobRetention: '',
  // Step 8: Work Address
  street_address: '',
  barangay: '',
  city_municipality: '',
  region_address: '',
  zip_code: '',
  country_address: 'Philippines',
  latitude: null,
  longitude: null,
  // Step 9: Competency Assessment
  technical_skills: [],
  technical_skill_count: 0,
  soft_skills: [],
  soft_skill_count: 0,
  professional_certifications: '',
  awards: '',
  // Legacy: old skills field (backward compatibility)
  skills: [],
};
>>>>>>> 6771caf016f20b32594230d79b0717e38758bb25

// Reducer
function registrationReducer(state: RegistrationState, action: RegistrationAction): RegistrationState {
  switch (action.type) {
    case 'SET_PERSONAL_DATA':
      return { ...state, personalData: action.personalData };
    case 'SET_EMPLOYMENT_DATA':
      return { ...state, employmentData: action.employmentData };
    case 'GO_TO_EMPLOYMENT':
      return { ...state, stage: 'employment' };
    case 'GO_TO_COMPLETE':
      return { ...state, stage: 'complete' };
    case 'GO_TO_PERSONAL':
      return { ...state, stage: 'personal' };
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'SET_ERROR':
      return { ...state, submitError: action.error, stage: 'error' };
    case 'RESET_ERROR':
      return { ...state, submitError: null };
    default:
      return state;
  }
}

// Progress Indicator Component
function ProgressIndicator({ stage, hasGraduated }: { stage: RegistrationStage; hasGraduated: boolean }) {
  const steps = hasGraduated
    ? ['Personal', 'Employment', 'Complete']
    : ['Personal', 'Complete'];

  const stageIndex = stage === 'personal' ? 0 : stage === 'employment' ? 1 : 2;

  return (
    <div className="mb-8">
      <div className="flex justify-between text-sm text-gray-600 mb-2">
        <span>
          Step {stageIndex + 1} of {steps.length}
        </span>
        <span>{((stageIndex / (steps.length - 1)) * 100).toFixed(0)}%</span>
      </div>
      <div className="flex gap-2">
        {steps.map((label, index) => (
          <div key={index} className="flex-1">
            <div
              className={`h-2 rounded-full transition-all ${
                index <= stageIndex ? 'bg-emerald-500' : 'bg-gray-200'
              }`}
            />
            <p className="text-xs text-gray-600 mt-1 text-center">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Registration Complete Component
function RegistrationComplete({ data }: { data: CompleteFormData | null }) {
  return (
    <div className="w-full max-w-2xl mx-auto p-6 text-center">
      <div className="flex justify-center mb-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="size-8 text-emerald-600" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Registration Complete!</h2>
      <p className="text-gray-600 mb-8">
        Thank you for registering with the Graduate Tracer System. Your information has been securely saved.
      </p>
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-left">
        <h3 className="font-semibold text-emerald-900 mb-3">What happens next?</h3>
        <ul className="space-y-2 text-sm text-emerald-800">
          <li className="flex items-start gap-2">
            <span className="font-bold">1.</span>
            <span>Your profile will be verified by our admin team</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-bold">2.</span>
            <span>You will receive a confirmation email once verified</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-bold">3.</span>
            <span>Your employment data will help us provide better insights to the program</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// Error State Component
function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div className="mb-6 p-6 border border-red-200 bg-red-50 rounded-lg flex gap-4">
        <AlertCircle className="text-red-600 flex-shrink-0" size={24} />
        <div>
          <h2 className="font-semibold text-red-900 mb-1">Submission Error</h2>
          <p className="text-red-700 text-sm mb-4">{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-semibold"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

// Main Orchestrator Component
export function RegisterAlumni() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(registrationReducer, {
    stage: 'personal',
    personalData: null,
    employmentData: null,
    isSubmitting: false,
    submitError: null,
  });

  // Handle personal component completion
  const handlePersonalComplete = async (personalData: PersonalFormData) => {
    dispatch({ type: 'SET_PERSONAL_DATA', personalData });

    // Check if graduated
    if (!personalData.hasGraduated) {
      // Skip employment survey, go directly to complete
      dispatch({ type: 'GO_TO_COMPLETE' });

      // Submit only personal data (non-graduated)
      await submitRegistration(personalData, null);
    } else {
      // Go to employment survey (graduated)
      dispatch({ type: 'GO_TO_EMPLOYMENT' });
    }
  };

  // Handle employment component completion
  const handleEmploymentComplete = async (employmentData: EmploymentFormData) => {
    dispatch({ type: 'SET_EMPLOYMENT_DATA', employmentData });
    dispatch({ type: 'GO_TO_COMPLETE' });

    // Merge personal and employment data for submission
    if (state.personalData) {
      await submitRegistration(state.personalData, employmentData);
    }
  };

  // Submit registration to backend
  const submitRegistration = async (
    personalData: PersonalFormData,
    employmentData: EmploymentFormData | null
  ) => {
    dispatch({ type: 'SET_SUBMITTING', isSubmitting: true });
    try {
      // Merge and prepare complete data
      const completeData = {
        ...personalData,
        ...(employmentData || {}),
      };

<<<<<<< HEAD
      // Call backend API
      const response = await registerAlumni(completeData);
=======
      const payload = new FormData();
      payload.append('email', form.email.trim().toLowerCase());
      payload.append('password', form.password);
      payload.append('confirm_password', form.confirmPassword);
      payload.append('first_name', form.firstName.trim());
      payload.append('middle_name', form.middleName.trim());
      payload.append('family_name', form.familyName.trim());
      payload.append('birth_date', form.birthDate);
      payload.append('mobile', form.mobileCountryCode + form.mobile);
      payload.append('mobile_country_code', form.mobileCountryCode);
      payload.append('graduation_date', form.graduationDate);
      payload.append('employment_status', employmentStatus);
      payload.append('capture_time', new Date().toISOString());
      payload.append('gps_lat', gps?.lat?.toString() || '');
      payload.append('gps_lng', gps?.lng?.toString() || '');
      payload.append('survey_data', JSON.stringify(surveyData));
      payload.append('face_descriptor', JSON.stringify(averagedDescriptor));
      payload.append('face_descriptor_samples', JSON.stringify(descriptorSamples));
      payload.append('face_front', frontBlob, `face_front_${Date.now()}.jpg`);
      payload.append('face_left', leftBlob, `face_left_${Date.now()}.jpg`);
      payload.append('face_right', rightBlob, `face_right_${Date.now()}.jpg`);
>>>>>>> 6771caf016f20b32594230d79b0717e38758bb25

      if (response.status !== 'success') {
        throw new Error(response.message || 'Registration failed');
      }

      // Success - data already on complete page
      dispatch({ type: 'SET_SUBMITTING', isSubmitting: false });
    } catch (error: any) {
      console.error('Registration submission error:', error);
      dispatch({
        type: 'SET_ERROR',
        error: error.message || 'Failed to submit registration. Please try again.',
      });
    }
  };

  // Handle back from employment to personal
  const handleEmploymentBack = () => {
    dispatch({ type: 'GO_TO_PERSONAL' });
  };

  // Render appropriate stage
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-12">
      <div className="w-full max-w-2xl mx-auto px-4">
        {/* Show progress only during active registration (not on complete or error) */}
        {state.stage !== 'complete' && state.stage !== 'error' && state.personalData && (
          <ProgressIndicator
            stage={state.stage}
            hasGraduated={state.personalData?.hasGraduated || false}
          />
        )}

        {/* Personal Information Stage */}
        {state.stage === 'personal' && (
          <RegisterAlumniPersonal onComplete={handlePersonalComplete} />
        )}

        {/* Employment Information Stage */}
        {state.stage === 'employment' && (
          <RegisterAlumniEmployment
            onComplete={handleEmploymentComplete}
            onBack={handleEmploymentBack}
          />
        )}

        {/* Registration Complete Stage */}
        {state.stage === 'complete' && (
          <>
            <ProgressIndicator
              stage={state.stage}
              hasGraduated={state.personalData?.hasGraduated || false}
            />
            <RegistrationComplete
              data={
                state.personalData
                  ? ({
                      ...state.personalData,
                      ...(state.employmentData || {}),
                    } as CompleteFormData)
                  : null
              }
            />
          </>
        )}

<<<<<<< HEAD
        {/* Error State */}
        {state.stage === 'error' && state.submitError && (
          <ErrorState
            error={state.submitError}
            onRetry={() => {
              dispatch({ type: 'RESET_ERROR' });
              // Go back to appropriate stage
              dispatch({
                type: state.employmentData ? 'GO_TO_EMPLOYMENT' : 'GO_TO_PERSONAL',
              });
            }}
          />
        )}
=======
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

          {/*  STEP 2: Personal Information (Part I)  */}
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
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Birth Date</label>
                    <input type="date" value={form.birthDate}
                      onChange={e => setF('birthDate', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Civil Status</label>
                    <select value={form.civilStatus} onChange={e => setF('civilStatus', e.target.value)} className={inputCls}>
                      <option value="">Select</option>
                      <option>Single</option>
                      <option>Married</option>
                      <option>Widowed</option>
                      <option>Separated</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Mobile Number</label>
                  <div className="flex gap-2">
                    <select
                      value={form.mobileCountryCode}
                      onChange={e => setF('mobileCountryCode', e.target.value)}
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
                      <input type="tel" placeholder="9XXXXXXXXX" value={form.mobile}
                        onChange={e => setF('mobile', e.target.value)} className={`${inputCls} pl-10`} />
                    </div>
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

          {/*  STEP 3: Educational Background (Part II)  */}
          {step === 3 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={BookOpen} title="Educational Background" subtitle="Part II  Identifies cohort groups for trend analysis" />

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
                      { val: 'Masters', label: "Master's Degree" },
                      { val: 'Doctorate', label: 'Doctorate Degree' },
                      { val: 'NA', label: 'N/A (Not pursuing further studies)' },
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
                      <input type="text" placeholder="Please specify certification" value={form.profEligibilityOther}
                        onChange={e => setF('profEligibilityOther', e.target.value)} className={`${inputCls} mt-1`} />
                    )}
                  </div>
                </div>
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} />
            </div>
          )}

          {/*  STEP 4: Employment Data (Part III)  */}
          {step === 4 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Briefcase} title="Employment Data" subtitle="Part III  Core data for Predictive Employability Trend Analysis" />

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
                        2. Job Acquisition Speed  How long did it take to land your first job after graduation?
                      </label>
                      <div className="space-y-1.5">
                        {['Within 1 month', '1-3 months', '3-6 months', '6 months to 1 year', 'Within 2 years', 'After 2 years'].map(opt => (
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
                          {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                            <RadioOption key={opt} label={opt} value={opt}
                              current={form.firstJobSector} onSelect={v => setF('firstJobSector', v)} />
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Status (First Job)</label>
                        <div className="space-y-1.5">
                          {['Regular/Permanent', 'Probationary', 'Contractual/Casual/Job Order'].map(opt => (
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
                          {['Yes', 'No'].map(opt => (
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
                            {['Salary & Benefits', 'Career Challenge/Advancement', 'Proximity to Residence', 'Lack of related job openings at the time', 'Others'].map(opt => (
                              <RadioOption key={opt} label={opt} value={opt}
                                current={form.firstJobUnrelatedReason} onSelect={v => setF('firstJobUnrelatedReason', v)} />
                            ))}
                          </div>
                          {form.firstJobUnrelatedReason === 'Others' && (
                            <input type="text" placeholder="Please specify" value={form.firstJobUnrelatedOther}
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
                        {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
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
                        {['Local (Philippines)', 'Abroad / Remote Foreign Employer'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.currentJobLocation} onSelect={v => setF('currentJobLocation', v)} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-600 text-xs mb-2" style={{ fontWeight: 600 }}>Is your current job related to your BSIS degree?</label>
                      <div className="flex gap-2">
                        {['Yes', 'No'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.currentJobRelated} onSelect={v => setF('currentJobRelated', v)} />
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-emerald-900 text-xs leading-relaxed" style={{ fontWeight: 600 }}>
                        To verify your workplace and employment details, please share this Employer Portal link with your supervisor or authorized HR representative.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={handleShareEmployerPortalLink}
                          className="inline-flex items-center justify-center rounded-lg bg-[#166534] px-3.5 py-2 text-xs text-white transition hover:bg-[#14532d]"
                          style={{ fontWeight: 600 }}
                        >
                          Give Employer Portal Link
                        </button>
                        {employerLinkStatus && (
                          <p className="text-[11px] text-emerald-700">{employerLinkStatus}</p>
                        )}
                      </div>
                      <p className="mt-2 break-all text-[11px] text-emerald-700">{employerPortalLink}</p>
                    </div>
                  </div>
                )}

                {form.employmentStatus && form.employmentStatus !== 'Never Employed' && (
                  <>
                    {/* Q5: Job retention */}
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        5. Job Retention  How long did you stay in your first job (or current role)?
                      </label>
                      <div className="space-y-1.5">
                        {['Less than 6 months', '6 months to 1 year', '1 to 2 years', '2 years and above'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={form.jobRetention} onSelect={v => setF('jobRetention', v)} />
                        ))}
                      </div>
                    </div>

                    {/* Q6: Source of job */}
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                        6. Source of Job Opportunity  Where did you find your first job opening?
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
                        <input type="text" placeholder="Please specify" value={form.jobSourceOther}
                          onChange={e => setF('jobSourceOther', e.target.value)} className={`${inputCls} mt-2`} />
                      )}
                    </div>
                  </>
                )}
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} />
            </div>
          )}

          {/*  STEP 5: Skills Assessment (Part IV)  */}
          {step === 5 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Award} title="Competency & Skills Assessment" subtitle="Part IV  Validates curriculum effectiveness and identifies skills gaps" />

              <div className="space-y-6">
                <div>
                  <label className="block text-gray-700 text-xs mb-1" style={{ fontWeight: 600 }}>
                    1. Skills Utilized in the Workplace
                  </label>
                  <p className="text-gray-400 text-xs mb-3">
                    Check <span style={{ fontWeight: 600 }}>ALL</span> skills from the BSIS program that you actively use in your current employment:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableSkills.map(skill => (
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
                    placeholder="e.g. AWS Certified Developer (2024), Best Employee Q1 2024, Cisco CCNA"
                    value={form.awards}
                    onChange={e => setF('awards', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white resize-none"
                  />
                </div>
              </div>

              <NavButtons onBack={prevStep} onNext={nextStep} nextLabel="Continue to Biometrics" />
            </div>
          )}

          {/*  STEP 6: Biometric Face Capture  */}
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
                      Three photos are required  facing forward, turning left, and turning right  to prevent identity spoofing with static images.
                    </p>
                  </div>
                </div>

                {stepError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs">{stepError}</p>
                  </div>
                )}

                {/* Shot progress tiles */}
                <div className="flex gap-2 mb-4">
                  {SHOT_INSTRUCTIONS.map((s, i) => (
                    <div key={i} className={`flex-1 rounded-xl border p-2.5 text-center transition ${shots[i] ? 'border-emerald-200 bg-emerald-50' :
                      currentShot === i && cameraOn ? 'border-[#166534] bg-[#166534]/5' :
                        'border-gray-200 bg-gray-50'
                      }`}>
                      <div className={`flex size-6 items-center justify-center rounded-full mx-auto mb-1 ${shots[i] ? 'bg-emerald-500' :
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
                <div className="relative bg-gray-900 rounded-2xl overflow-hidden mb-4 flex items-center justify-center w-full max-w-[400px] mx-auto" style={{ aspectRatio: '4/3', maxHeight: '300px' }}>
                  {!cameraOn && !allShotsCaptured && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <Camera className="size-12 text-gray-600 mb-2" />
                      <p className="text-gray-400 text-sm">Camera not started</p>
                      <p className="text-gray-600 text-xs mt-1">Tap "Start Camera" below</p>
                    </div>
                  )}

                  <video ref={videoRef}
                    className={`absolute inset-0 w-full h-full object-cover object-center ${(!cameraOn || allShotsCaptured) ? 'hidden' : ''}`}
                    playsInline muted autoPlay />

                  {/* All shots captured  show 3-column thumbnail grid */}
                  {allShotsCaptured && (
                    <div className="absolute inset-0 grid grid-cols-3 gap-0.5">
                      {shots.map((shot, i) => (
                        <div key={i} className="relative overflow-hidden">
                          <img src={shot!} alt={`Shot ${i + 1}`} className="w-full h-full object-cover object-center" />
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
                            Shot {currentShot + 1}/3  {SHOT_INSTRUCTIONS[currentShot]?.label}: {SHOT_INSTRUCTIONS[currentShot]?.desc}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* GPS badge */}
                  {gpsLoading && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 rounded-lg px-3 py-1.5">
                      <span className="size-3 border border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-white text-xs">Getting GPS</span>
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
                      <button onClick={() => { void captureShot(); }}
                        disabled={checkingBlur}
                        className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm transition"
                        style={{ fontWeight: 600 }}>
                        {checkingBlur
                          ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking clarity</>
                          : <><Camera className="size-4" /> Capture {currentShot + 1}/3  {SHOT_INSTRUCTIONS[currentShot]?.label}</>
                        }
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
                        {gps ? `  GPS ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : ''}
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
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm transition ${allShotsCaptured && !isSaving
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  style={{ fontWeight: 600 }}>
                  {isSaving
                    ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating account</>
                    : 'Submit Registration '}
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
>>>>>>> 6771caf016f20b32594230d79b0717e38758bb25
      </div>
    </div>
  );
}

// Encoding Mappers (for use in employment component)
export const timeToHireMapper = (selection: string | null): number | null => ({
  'Within 1 month': 1,
  '1-3 months': 3,
  '3-6 months': 4.5,
  '6 months to 1 year': 9,
  '1-2 years': 18,
  'More than 2 years': 30,
}[selection] || null);

export const jobApplicationsMapper = (selection: string | null): number | null => ({
  '1-5 applications': 1,
  '6-15 applications': 2,
  '16-30 applications': 3,
  '31+ applications': 4,
}[selection] || null);

export const jobSourceMapper = (selection: string | null): string => ({
  'Personal Network/Referral': 'personal_network',
  'Online Job Portal': 'online_portal',
  'CHMSU Career Fair': 'career_fair',
  'Company Walk-in/Direct Hire': 'walk_in',
  'Social Media': 'social_media',
  'Started own business': 'entrepreneurship',
  'Other': 'other',
}[selection] || 'other');

export const sectorMapper = (selection: string | null): string => ({
  'Government': 'government',
  'Private Sector': 'private',
  'Entrepreneurial/Freelance/Self-Employed': 'entrepreneurial',
}[selection] || 'private');

export const jobStatusMapper = (selection: string | null): string => ({
  'Regular / Permanent': 'regular',
  'Probationary': 'probationary',
  'Contractual / Casual': 'contractual',
  'Self-Employed / Freelance': 'self_employed',
}[selection] || 'regular');
