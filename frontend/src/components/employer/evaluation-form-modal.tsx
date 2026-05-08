import { useState } from 'react';
import { X, Star } from 'lucide-react';
import type { EmployerEvaluationPayload, EmployerEvaluationRating } from '../../app/api-client';

const RATING_OPTIONS: { value: EmployerEvaluationRating; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'very_good', label: 'Very Good' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'unsatisfactory', label: 'Unsatisfactory' },
];

const RATING_QUESTIONS: { key: keyof EmployerEvaluationPayload; label: string; description: string }[] = [
  { key: 'rating_quality_of_work', label: 'Quality of Work', description: "Completion; accuracy; professional or technical proficiency." },
  { key: 'rating_work_habits', label: 'Work Habits', description: 'Planning and organization of work; care of equipment and supplies.' },
  { key: 'rating_relationship_with_people', label: 'Relationship with People', description: 'Ability to get along with others. Effectiveness in dealing with the public.' },
  { key: 'rating_dependability', label: 'Dependability', description: 'Reliable; punctual; regular attendance; works steadily and effectively.' },
  { key: 'rating_quantity_of_work', label: 'Quantity of Work', description: 'Amount of work performed.' },
  { key: 'rating_initiative', label: 'Initiative', description: 'Resourcefulness; versatility; originality; ability to conceive and carry out program improvements.' },
  { key: 'rating_analytical_ability', label: 'Analytical Ability', description: 'Thoroughness and accuracy of analysis of data, facts, laws, rules, and procedures.' },
  { key: 'rating_ability_as_supervisor', label: 'Ability as Supervisor', description: 'Proficiency in training employees, planning and organizing work, promoting cost reduction.' },
  { key: 'rating_administrative_ability', label: 'Administrative Ability', description: 'Promptness of action; soundness of decision; application of good management principles.' },
  { key: 'rating_safety', label: 'Safety', description: "Application of accident prevention techniques and unit's safety." },
  { key: 'rating_commitment_to_social_equity', label: 'Commitment to Social Equity', description: 'Promotes fairness, advocates for inclusivity, and addresses systemic inequalities.' },
];

const EMPTY_RATINGS: Record<string, EmployerEvaluationRating | ''> = Object.fromEntries(
  RATING_QUESTIONS.map((q) => [q.key, '' as const]),
);

type Props = {
  isOpen: boolean;
  graduateName: string;
  defaultEmployerName?: string;
  defaultBusinessType?: string;
  onClose: () => void;
  onSubmit: (payload: EmployerEvaluationPayload) => Promise<void> | void;
  isSubmitting?: boolean;
};

export function EvaluationFormModal({
  isOpen,
  graduateName,
  defaultEmployerName = '',
  defaultBusinessType = '',
  onClose,
  onSubmit,
  isSubmitting = false,
}: Props) {
  const [evaluatorName, setEvaluatorName] = useState(defaultEmployerName);
  const [employeeStatus, setEmployeeStatus] = useState<'regular' | 'probationary_casual_jo' | 'other' | ''>('');
  const [employeeStatusOther, setEmployeeStatusOther] = useState('');
  const [yearsInCompany, setYearsInCompany] = useState('');
  const [educationalAttainment, setEducationalAttainment] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [typeOfBusiness, setTypeOfBusiness] = useState(defaultBusinessType);
  const [dateOfEvaluation, setDateOfEvaluation] = useState(new Date().toISOString().slice(0, 10));
  const [ratings, setRatings] = useState<Record<string, EmployerEvaluationRating | ''>>({ ...EMPTY_RATINGS });
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const setRating = (key: string, value: EmployerEvaluationRating) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const missing = RATING_QUESTIONS.filter((q) => !ratings[q.key]);
    if (missing.length) {
      setError(`Please rate every dimension. Missing: ${missing.map((m) => m.label).join(', ')}`);
      return;
    }
    if (!evaluatorName.trim()) {
      setError("Employer's name is required.");
      return;
    }
    if (!employeeStatus) {
      setError("Employee's status is required.");
      return;
    }
    if (!strengths.trim() || !improvements.trim()) {
      setError('Please complete both assessment questions.');
      return;
    }

    const payload: EmployerEvaluationPayload = {
      evaluator_name: evaluatorName.trim(),
      employee_status: employeeStatus,
      employee_status_other: employeeStatus === 'other' ? employeeStatusOther.trim() : '',
      years_in_company: yearsInCompany.trim() ? Number(yearsInCompany) : null,
      educational_attainment: educationalAttainment.trim(),
      marital_status: maritalStatus.trim(),
      type_of_business: typeOfBusiness.trim(),
      date_of_evaluation: dateOfEvaluation,
      assessment_strengths: strengths.trim(),
      assessment_improvements: improvements.trim(),
      rating_quality_of_work: ratings.rating_quality_of_work as EmployerEvaluationRating,
      rating_work_habits: ratings.rating_work_habits as EmployerEvaluationRating,
      rating_relationship_with_people: ratings.rating_relationship_with_people as EmployerEvaluationRating,
      rating_dependability: ratings.rating_dependability as EmployerEvaluationRating,
      rating_quantity_of_work: ratings.rating_quantity_of_work as EmployerEvaluationRating,
      rating_initiative: ratings.rating_initiative as EmployerEvaluationRating,
      rating_analytical_ability: ratings.rating_analytical_ability as EmployerEvaluationRating,
      rating_ability_as_supervisor: ratings.rating_ability_as_supervisor as EmployerEvaluationRating,
      rating_administrative_ability: ratings.rating_administrative_ability as EmployerEvaluationRating,
      rating_safety: ratings.rating_safety as EmployerEvaluationRating,
      rating_commitment_to_social_equity: ratings.rating_commitment_to_social_equity as EmployerEvaluationRating,
    };

    await onSubmit(payload);
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-[#166534] to-[#15803d] text-white px-6 py-4 flex items-start justify-between rounded-t-2xl">
          <div>
            <h2 className="text-lg" style={{ fontWeight: 700 }}>Employer's Confidential Feedback Form</h2>
            <p className="text-green-100 text-xs mt-0.5">Evaluation for {graduateName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Identification */}
          <section className="space-y-3">
            <h3 className="text-sm" style={{ fontWeight: 700 }}>Evaluation Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-600">Employer's Name (Last, First, Middle) *</span>
                <input className={inputCls} value={evaluatorName} onChange={(e) => setEvaluatorName(e.target.value)} required />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Employee's Name</span>
                <input className={inputCls} value={graduateName} readOnly />
              </label>

              <div className="md:col-span-2">
                <span className="text-xs text-gray-600">Employee's Status *</span>
                <div className="flex flex-wrap gap-3 mt-1">
                  {(['regular', 'probationary_casual_jo', 'other'] as const).map((s) => (
                    <label key={s} className="inline-flex items-center gap-2 text-sm">
                      <input type="radio" name="emp-status" checked={employeeStatus === s} onChange={() => setEmployeeStatus(s)} />
                      {s === 'regular' ? 'Regular' : s === 'probationary_casual_jo' ? 'Probationary/Casual/Job Order' : 'Other'}
                    </label>
                  ))}
                </div>
                {employeeStatus === 'other' && (
                  <input
                    className={`${inputCls} mt-2`}
                    placeholder="Specify other status"
                    value={employeeStatusOther}
                    onChange={(e) => setEmployeeStatusOther(e.target.value)}
                  />
                )}
              </div>

              <label className="block">
                <span className="text-xs text-gray-600">Number of Years</span>
                <input type="number" min={0} className={inputCls} value={yearsInCompany} onChange={(e) => setYearsInCompany(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Educational Attainment</span>
                <input className={inputCls} value={educationalAttainment} onChange={(e) => setEducationalAttainment(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Marital Status</span>
                <input className={inputCls} value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Type of Business</span>
                <input className={inputCls} value={typeOfBusiness} onChange={(e) => setTypeOfBusiness(e.target.value)} />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs text-gray-600">Date of Evaluation</span>
                <input type="date" className={inputCls} value={dateOfEvaluation} onChange={(e) => setDateOfEvaluation(e.target.value)} />
              </label>
            </div>
          </section>

          {/* Section A: Characteristics */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm" style={{ fontWeight: 700 }}>(A) Employee's Characteristics</h3>
              <p className="text-xs text-gray-500 mt-1">
                Excellent: consistently exceeds expectations · Very Good: meets and occasionally exceeds · Good: meets · Fair: meets some, needs improvement · Unsatisfactory: consistently falls below.
              </p>
            </div>
            <div className="space-y-3">
              {RATING_QUESTIONS.map((q) => (
                <div key={q.key} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-start gap-2">
                    <Star className="size-4 text-[#166534] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm" style={{ fontWeight: 600 }}>{q.label}</p>
                      <p className="text-xs text-gray-500">{q.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {RATING_OPTIONS.map((opt) => (
                      <label key={opt.value} className="inline-flex items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          name={String(q.key)}
                          checked={ratings[q.key] === opt.value}
                          onChange={() => setRating(String(q.key), opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section B: Assessment */}
          <section className="space-y-3">
            <h3 className="text-sm" style={{ fontWeight: 700 }}>(B) Employee's Assessment</h3>
            <label className="block">
              <span className="text-xs text-gray-600">1. What do you perceive to be this employee's greatest strengths? *</span>
              <textarea className={`${inputCls} min-h-[88px]`} value={strengths} onChange={(e) => setStrengths(e.target.value)} required />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">2. In what area(s) does this employee need to improve? *</span>
              <textarea className={`${inputCls} min-h-[88px]`} value={improvements} onChange={(e) => setImprovements(e.target.value)} required />
            </label>
          </section>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50" disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg text-sm text-white bg-[#166534] hover:bg-[#15803d] disabled:opacity-60"
              style={{ fontWeight: 600 }}
            >
              {isSubmitting ? 'Submitting…' : 'Submit Evaluation & Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
