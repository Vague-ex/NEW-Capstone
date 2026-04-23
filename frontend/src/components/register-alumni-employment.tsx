/**
 * Alumni Registration - Employment Information Component
 * Handles: Academic Profile, Employment Status, First Job, Current Job, Work Address, Competency
 * Steps: 1-6 (Employment Component)
 *
 * This component collects comprehensive employment history and skills assessment.
 * Conditional step skipping based on employment status (never employed, seeking, employed).
 * Final submission merges employment data with personal data for backend.
 */

import { useState, useRef, useEffect } from 'react';
import {
  Briefcase, MapPin, Award, BookOpen, ChevronRight, ChevronLeft,
  AlertCircle, CheckCircle2, Code, Users, Loader,
} from 'lucide-react';
import { useReferenceData } from '../hooks/useReferenceData';

// Types
type EmploymentStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface EmploymentFormData {
  // Step 1: Academic & Pre-Employment Profile
  general_average_range: number | null;
  academic_honors: number | null;
  prior_work_experience: boolean;
  ojt_relevance: number | null;
  has_portfolio: boolean;
  english_proficiency: number | null;

  // Step 2: Employment Status
  employment_status: string;

  // Step 3: First Job Details
  time_to_hire_months: number | null;
  time_to_hire_raw: string;
  first_job_sector: string;
  first_job_status: string;
  first_job_title: string;
  first_job_related_to_bsis: boolean | null;
  first_job_unrelated_reason: string;
  first_job_applications_count: number | null;
  first_job_applications_raw: string;
  first_job_source: string;
  first_job_source_display: string;

  // Step 4: Current Job
  current_job_sector: string;
  current_job_title: string;
  current_job_company: string;
  current_job_related_to_bsis: boolean | null;
  location_type: boolean | null;

  // Step 5: Work Address
  street_address: string;
  barangay: string;
  city_municipality: string;
  region: string;
  zip_code: string;
  country: string;
  latitude: number | null;
  longitude: number | null;

  // Step 6: Competency Assessment
  technical_skills: string[];
  soft_skills: string[];
  professional_certifications: string;
}

// Constants
const EMPLOYMENT_STEP_CONFIG = [
  { n: 1 as EmploymentStep, label: 'Academic Profile' },
  { n: 2 as EmploymentStep, label: 'Employment Status' },
  { n: 3 as EmploymentStep, label: 'First Job' },
  { n: 4 as EmploymentStep, label: 'Current Job' },
  { n: 5 as EmploymentStep, label: 'Work Address' },
  { n: 6 as EmploymentStep, label: 'Skills & Competency' },
];

const TECHNICAL_SKILLS = [
  'Programming/Software Development',
  'Web Development',
  'Mobile App Development',
  'Database Management',
  'Network Administration',
  'Cloud Computing',
  'Data Analytics/Business Intelligence',
  'System Analysis and Design',
  'Technical Support/Troubleshooting',
  'Project Management',
  'UI/UX Design',
  'Cybersecurity/Information Security',
];

const SOFT_SKILLS = [
  'Oral Communication',
  'Written Communication',
  'Teamwork/Collaboration',
  'Problem-solving/Critical Thinking',
  'Adaptability/Flexibility',
  'Leadership',
  'Customer Service Orientation',
  'Attention to Detail',
  'Ability to Work Under Pressure',
  'Time Management',
];

const PHILIPPINE_REGIONS = [
  'NCR', 'Region I', 'Region II', 'Region III', 'Region IV-A', 'Region IV-B',
  'Region V', 'Region VI', 'Region VII', 'Region VIII', 'Region IX', 'Region X',
  'Region XI', 'Region XII', 'Region XIII', 'CAR', 'BARMM', 'Abroad',
];

const INITIAL_EMPLOYMENT_FORM: EmploymentFormData = {
  general_average_range: null,
  academic_honors: null,
  prior_work_experience: false,
  ojt_relevance: null,
  has_portfolio: false,
  english_proficiency: null,
  employment_status: '',
  time_to_hire_months: null,
  time_to_hire_raw: '',
  first_job_sector: '',
  first_job_status: '',
  first_job_title: '',
  first_job_related_to_bsis: null,
  first_job_unrelated_reason: '',
  first_job_applications_count: null,
  first_job_applications_raw: '',
  first_job_source: '',
  first_job_source_display: '',
  current_job_sector: '',
  current_job_title: '',
  current_job_company: '',
  current_job_related_to_bsis: null,
  location_type: null,
  street_address: '',
  barangay: '',
  city_municipality: '',
  region: '',
  zip_code: '',
  country: 'Philippines',
  latitude: null,
  longitude: null,
  technical_skills: [],
  soft_skills: [],
  professional_certifications: '',
};

// Reusable Components (imported from context or duplicated here)
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

function RadioOption<T>({ label, value, current, onSelect }: {
  label: string;
  value: T;
  current: T | null | undefined;
  onSelect: (v: T) => void;
}) {
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

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled = false, isSubmit = false }: any) {
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
        {nextLabel} {!isSubmit && <ChevronRight className="size-4" />}
      </button>
    </div>
  );
}

// Encoding Mappers
const timeToHireMapper = (selection: string | null): number | null => ({
  'Within 1 month': 1,
  '1-3 months': 3,
  '3-6 months': 4.5,
  '6 months to 1 year': 9,
  '1-2 years': 18,
  'More than 2 years': 30,
}[selection ?? ''] ?? null);

const jobApplicationsMapper = (selection: string | null): number | null => ({
  '1-5 applications': 1,
  '6-15 applications': 2,
  '16-30 applications': 3,
  '31+ applications': 4,
}[selection ?? ''] ?? null);

const jobSourceMapper = (selection: string | null): string => ({
  'Personal Network/Referral': 'personal_network',
  'Online Job Portal': 'online_portal',
  'CHMSU Career Fair': 'career_fair',
  'Company Walk-in/Direct Hire': 'walk_in',
  'Social Media': 'social_media',
  'Started own business': 'entrepreneurship',
  'Other': 'other',
}[selection ?? ''] ?? 'other');

const sectorMapper = (selection: string | null): string => ({
  'Government': 'government',
  'Private Sector': 'private',
  'Entrepreneurial/Freelance/Self-Employed': 'entrepreneurial',
}[selection ?? ''] ?? 'private');

// Main Component
export interface RegisterAlumniEmploymentProps {
  onComplete: (employmentData: EmploymentFormData) => Promise<void>;
  onBack: () => void;
}

export default function RegisterAlumniEmployment({
  onComplete,
  onBack,
}: RegisterAlumniEmploymentProps) {
  const { data: referenceData } = useReferenceData();
  const [step, setStep] = useState<EmploymentStep>(1);
  const [form, setForm] = useState<EmploymentFormData>(INITIAL_EMPLOYMENT_FORM);
  const [stepError, setStepError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Restore form from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('employmentFormData');
    if (stored) {
      try {
        setForm(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to restore form data:', e);
      }
    }
  }, []);

  // Persist form to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('employmentFormData', JSON.stringify(form));
  }, [form]);

  // Get available regions (from Supabase or fallback)
  const regions = referenceData?.regions?.map((r: any) => r.name) || PHILIPPINE_REGIONS;

  // Validation logic
  const validateStep = (): boolean => {
    setStepError('');

    switch (step) {
      case 1: // Academic Profile
        break; // All optional
      case 2: // Employment Status
        if (!form.employment_status) {
          setStepError('Please select employment status');
          return false;
        }
        break;
      case 3: // First Job Details
        if (!form.time_to_hire_raw) {
          setStepError('Time to hire is required');
          return false;
        }
        if (!form.first_job_sector) {
          setStepError('First job sector is required');
          return false;
        }
        if (!form.first_job_status) {
          setStepError('First job status is required');
          return false;
        }
        if (!form.first_job_title) {
          setStepError('Job title is required');
          return false;
        }
        if (!form.first_job_applications_raw) {
          setStepError('Number of applications is required');
          return false;
        }
        if (!form.first_job_source_display) {
          setStepError('Where you found the job is required');
          return false;
        }
        break;
      case 4: // Current Job (all optional)
        break;
      case 5: // Work Address
        if (!form.city_municipality) {
          setStepError('City/Municipality is required');
          return false;
        }
        if (!form.region) {
          setStepError('Region is required');
          return false;
        }
        break;
      case 6: // Competency (all optional)
        break;
    }

    return true;
  };

  // Navigation logic with conditional skipping
  const nextStep = () => {
    if (!validateStep()) return;

    // Conditional skipping based on employment_status
    if (step === 2) {
      if (['never_employed', 'not_seeking'].includes(form.employment_status)) {
        setStep(5 as EmploymentStep); // Skip first job and current job
        return;
      }
    }

    if (step === 3 && form.employment_status === 'seeking') {
      setStep(5 as EmploymentStep); // Skip current job
      return;
    }

    if (step < 6) {
      setStep((s) => (s + 1) as EmploymentStep);
    }
  };

  const prevStep = () => {
    // Handle back navigation with skipped steps
    if (step === 5 && ['never_employed', 'not_seeking'].includes(form.employment_status)) {
      setStep(2 as EmploymentStep); // Jump back to employment status
    } else if (step === 5 && form.employment_status === 'seeking') {
      setStep(3 as EmploymentStep); // Jump back to first job
    } else if (step > 1) {
      setStep((s) => (s - 1) as EmploymentStep);
    } else {
      onBack();
    }
  };

  // Submit handler with encoding transformations
  const handleSubmit = async () => {
    if (!validateStep()) return;

    setIsSubmitting(true);
    try {
      // Apply encoding transformations
      const encoded: EmploymentFormData = {
        ...form,
        time_to_hire_months: timeToHireMapper(form.time_to_hire_raw),
        first_job_applications_count: jobApplicationsMapper(form.first_job_applications_raw),
        first_job_source: jobSourceMapper(form.first_job_source_display),
        first_job_sector: sectorMapper(form.first_job_sector),
        current_job_sector: form.current_job_sector ? sectorMapper(form.current_job_sector) : '',
      };

      await onComplete(encoded);
    } catch (error: any) {
      setStepError(error.message || 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Determine which step to render based on conditional skipping
  const isCurrentState = (stepNum: EmploymentStep): boolean => {
    return step === stepNum;
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Step {step} of 6</span>
          <span>{(step / 6 * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all"
            style={{ width: `${(step / 6) * 100}%` }}
          />
        </div>
      </div>

      {/* Error Display */}
      {stepError && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 rounded-lg flex gap-3">
          <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
          <p className="text-red-700 text-sm">{stepError}</p>
        </div>
      )}

      {/* Step 1: Academic & Pre-Employment Profile */}
      {isCurrentState(1) && (
        <div className="space-y-6">
          <SectionHeader icon={BookOpen} title="Academic & Pre-Employment Profile" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Cumulative GPA / General Average
            </label>
            <select
              value={form.general_average_range ?? ''}
              onChange={(e) => setForm({ ...form, general_average_range: e.target.value ? parseInt(e.target.value) : null })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select GPA Range</option>
              <option value="5">95-100</option>
              <option value="4">90-94</option>
              <option value="3">85-89</option>
              <option value="2">80-84</option>
              <option value="1">75-79</option>
              <option value="0">Below 75</option>
              <option value="">I don't remember</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Academic Honors
            </label>
            <select
              value={form.academic_honors ?? ''}
              onChange={(e) => setForm({ ...form, academic_honors: e.target.value ? parseInt(e.target.value) : null })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select Academic Honors</option>
              <option value="4">Summa Cum Laude</option>
              <option value="3">Magna Cum Laude</option>
              <option value="2">Cum Laude</option>
              <option value="1">None</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">
              Prior Work Experience Before Graduation
            </label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.prior_work_experience} onSelect={(v) => setForm({ ...form, prior_work_experience: v })} />
              <RadioOption label="No" value={false} current={form.prior_work_experience} onSelect={(v) => setForm({ ...form, prior_work_experience: v })} />
            </div>
          </div>

          {form.prior_work_experience && (
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                How Related was Your OJT/Internship to BSIS?
              </label>
              <select
                value={form.ojt_relevance ?? ''}
                onChange={(e) => setForm({ ...form, ojt_relevance: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="">Select Relevance</option>
                <option value="3">Directly Related</option>
                <option value="2">Somewhat Related</option>
                <option value="1">Not Related</option>
                <option value="0">Not Applicable</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">
              Portfolio / GitHub Profile
            </label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.has_portfolio} onSelect={(v) => setForm({ ...form, has_portfolio: v })} />
              <RadioOption label="No" value={false} current={form.has_portfolio} onSelect={(v) => setForm({ ...form, has_portfolio: v })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              English Proficiency
            </label>
            <select
              value={form.english_proficiency ?? ''}
              onChange={(e) => setForm({ ...form, english_proficiency: e.target.value ? parseInt(e.target.value) : null })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select Proficiency Level</option>
              <option value="3">Professional / Business</option>
              <option value="2">Conversational</option>
              <option value="1">Basic</option>
            </select>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 2: Employment Status */}
      {isCurrentState(2) && (
        <div className="space-y-6">
          <SectionHeader icon={Briefcase} title="Current Employment Status" subtitle="This determines which information we'll ask for next" />

          <div className="space-y-2">
            {[
              { label: 'Employed Full-Time', value: 'employed_full_time' },
              { label: 'Employed Part-Time', value: 'employed_part_time' },
              { label: 'Self-Employed / Freelance', value: 'self_employed' },
              { label: 'Seeking Employment', value: 'seeking' },
              { label: 'Not Seeking Employment', value: 'not_seeking' },
              { label: 'Never Been Employed', value: 'never_employed' },
            ].map(({ label, value }) => (
              <RadioOption
                key={value}
                label={label}
                value={value}
                current={form.employment_status}
                onSelect={(v) => setForm({ ...form, employment_status: v })}
              />
            ))}
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} nextDisabled={!form.employment_status} />
        </div>
      )}

      {/* Step 3: First Job Details */}
      {isCurrentState(3) && (
        <div className="space-y-6">
          <SectionHeader icon={Briefcase} title="Your First Job" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Time to Hire (from graduation to employment)
            </label>
            <select
              value={form.time_to_hire_raw}
              onChange={(e) => setForm({ ...form, time_to_hire_raw: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select Time Frame</option>
              <option value="Within 1 month">Within 1 month</option>
              <option value="1-3 months">1-3 months</option>
              <option value="3-6 months">3-6 months</option>
              <option value="6 months to 1 year">6 months to 1 year</option>
              <option value="1-2 years">1-2 years</option>
              <option value="More than 2 years">More than 2 years</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Employment Sector</label>
              <select
                value={form.first_job_sector}
                onChange={(e) => setForm({ ...form, first_job_sector: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="">Select Sector</option>
                <option value="Government">Government</option>
                <option value="Private Sector">Private Sector</option>
                <option value="Entrepreneurial/Freelance/Self-Employed">Entrepreneurial/Freelance</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Employment Status</label>
              <select
                value={form.first_job_status}
                onChange={(e) => setForm({ ...form, first_job_status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="">Select Status</option>
                <option value="regular">Regular / Permanent</option>
                <option value="probationary">Probationary</option>
                <option value="contractual">Contractual / Casual</option>
                <option value="self_employed">Self-Employed / Freelance</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Job Title</label>
            <input
              type="text"
              value={form.first_job_title}
              onChange={(e) => setForm({ ...form, first_job_title: e.target.value })}
              placeholder="e.g., Junior Software Developer"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Is this job related to your BSIS degree?</label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.first_job_related_to_bsis} onSelect={(v) => setForm({ ...form, first_job_related_to_bsis: v })} />
              <RadioOption label="No" value={false} current={form.first_job_related_to_bsis} onSelect={(v) => setForm({ ...form, first_job_related_to_bsis: v, first_job_unrelated_reason: '' })} />
            </div>
          </div>

          {form.first_job_related_to_bsis === false && (
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Why not?</label>
              <select
                value={form.first_job_unrelated_reason}
                onChange={(e) => setForm({ ...form, first_job_unrelated_reason: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="">Select reason</option>
                <option value="better_opportunity">Better opportunity</option>
                <option value="higher_pay">Higher pay</option>
                <option value="family_reasons">Family reasons</option>
                <option value="location">Location</option>
                <option value="career_change">Career change</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Number of applications before getting hired</label>
            <select
              value={form.first_job_applications_raw}
              onChange={(e) => setForm({ ...form, first_job_applications_raw: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select range</option>
              <option value="1-5 applications">1-5 applications</option>
              <option value="6-15 applications">6-15 applications</option>
              <option value="16-30 applications">16-30 applications</option>
              <option value="31+ applications">31+ applications</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Where did you find this job?</label>
            <select
              value={form.first_job_source_display}
              onChange={(e) => setForm({ ...form, first_job_source_display: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select source</option>
              <option value="Personal Network/Referral">Personal Network / Referral</option>
              <option value="Online Job Portal">Online Job Portal</option>
              <option value="CHMSU Career Fair">CHMSU Career Fair</option>
              <option value="Company Walk-in/Direct Hire">Company Walk-in / Direct Hire</option>
              <option value="Social Media">Social Media</option>
              <option value="Started own business">Started own business</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 4: Current Job (Only if employed full-time, part-time, or self-employed) */}
      {isCurrentState(4) && ['employed_full_time', 'employed_part_time', 'self_employed'].includes(form.employment_status) && (
        <div className="space-y-6">
          <SectionHeader icon={Briefcase} title="Your Current / Most Recent Job" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Employment Sector</label>
            <select
              value={form.current_job_sector}
              onChange={(e) => setForm({ ...form, current_job_sector: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select Sector (optional)</option>
              <option value="Government">Government</option>
              <option value="Private Sector">Private Sector</option>
              <option value="Entrepreneurial/Freelance/Self-Employed">Entrepreneurial/Freelance</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Current Job Title</label>
            <input
              type="text"
              value={form.current_job_title}
              onChange={(e) => setForm({ ...form, current_job_title: e.target.value })}
              placeholder="e.g., Senior Software Developer"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Company / Organization Name</label>
            <input
              type="text"
              value={form.current_job_company}
              onChange={(e) => setForm({ ...form, current_job_company: e.target.value })}
              placeholder="e.g., Tech Company Inc."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Is this job related to your BSIS degree?</label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.current_job_related_to_bsis} onSelect={(v) => setForm({ ...form, current_job_related_to_bsis: v })} />
              <RadioOption label="No" value={false} current={form.current_job_related_to_bsis} onSelect={(v) => setForm({ ...form, current_job_related_to_bsis: v })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Work Location</label>
            <div className="flex gap-3">
              <RadioOption label="Local (Philippines)" value={true} current={form.location_type} onSelect={(v) => setForm({ ...form, location_type: v })} />
              <RadioOption label="Abroad / Remote" value={false} current={form.location_type} onSelect={(v) => setForm({ ...form, location_type: v })} />
            </div>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 5: Work Address */}
      {isCurrentState(5) && (
        <div className="space-y-6">
          <SectionHeader icon={MapPin} title="Work Address" subtitle="Help us map employment locations" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Street Address (optional)</label>
            <input
              type="text"
              value={form.street_address}
              onChange={(e) => setForm({ ...form, street_address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Barangay (optional)</label>
            <input
              type="text"
              value={form.barangay}
              onChange={(e) => setForm({ ...form, barangay: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">City / Municipality *</label>
              <input
                type="text"
                value={form.city_municipality}
                onChange={(e) => setForm({ ...form, city_municipality: e.target.value })}
                placeholder="Required"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Region *</label>
              <select
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="">Select Region</option>
                {regions.map((region: string) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">ZIP Code (optional)</label>
              <input
                type="text"
                value={form.zip_code}
                onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Country</label>
              <select
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="Philippines">Philippines</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 6: Competency Assessment */}
      {isCurrentState(6) && (
        <div className="space-y-6">
          <SectionHeader icon={Award} title="Skills & Competencies" />

          {/* Technical Skills */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Technical Skills ({form.technical_skills.length} of 12 selected)
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TECHNICAL_SKILLS.map((skill) => (
                <CheckOption
                  key={skill}
                  label={skill}
                  checked={form.technical_skills.includes(skill)}
                  onChange={(e: any) => {
                    if (e.target.checked && form.technical_skills.length < 12) {
                      setForm({ ...form, technical_skills: [...form.technical_skills, skill] });
                    } else if (!e.target.checked) {
                      setForm({ ...form, technical_skills: form.technical_skills.filter(s => s !== skill) });
                    }
                  }}
                />
              ))}
            </div>
          </div>

          {/* Soft Skills */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Soft Skills ({form.soft_skills.length} of 10 selected)
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SOFT_SKILLS.map((skill) => (
                <CheckOption
                  key={skill}
                  label={skill}
                  checked={form.soft_skills.includes(skill)}
                  onChange={(e: any) => {
                    if (e.target.checked && form.soft_skills.length < 10) {
                      setForm({ ...form, soft_skills: [...form.soft_skills, skill] });
                    } else if (!e.target.checked) {
                      setForm({ ...form, soft_skills: form.soft_skills.filter(s => s !== skill) });
                    }
                  }}
                />
              ))}
            </div>
          </div>

          {/* Professional Certifications */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Professional Certifications (comma-separated, optional)
            </label>
            <input
              type="text"
              value={form.professional_certifications}
              onChange={(e) => setForm({ ...form, professional_certifications: e.target.value })}
              placeholder="e.g., AWS Solutions Architect, Google Cloud Professional"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <NavButtons
            onBack={prevStep}
            onNext={handleSubmit}
            nextLabel={isSubmitting ? 'Submitting...' : 'Complete'}
            nextDisabled={isSubmitting}
            isSubmit={true}
          />
        </div>
      )}
    </div>
  );
}
