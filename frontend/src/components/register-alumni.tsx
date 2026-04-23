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

      // Call backend API
      const response = await registerAlumni(completeData);

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
