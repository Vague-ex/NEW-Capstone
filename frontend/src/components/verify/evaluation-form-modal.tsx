import { useEffect, useState } from 'react';
import { X, ShieldCheck, AlertTriangle } from 'lucide-react';
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

const EMPLOYEE_STATUSES = [
  { value: 'regular', label: 'Regular' },
  { value: 'probationary_casual_jo', label: 'Probationary / Casual / Job Order' },
  { value: 'other', label: 'Other' },
] as const;

const EMPTY_RATINGS: Record<string, EmployerEvaluationRating | ''> = Object.fromEntries(
  RATING_QUESTIONS.map((q) => [q.key, '' as const]),
);

type Props = {
  isOpen: boolean;
  graduateName: string;
  defaultBusinessType?: string;
  /** Pre-fills "Employer's name" from the page's "Your name" field. */
  defaultEvaluatorName?: string;
  initialPayload?: EmployerEvaluationPayload | null;
  onClose: () => void;
  onSubmit: (payload: EmployerEvaluationPayload) => Promise<void> | void;
  isSubmitting?: boolean;
};

/**
 * Employer's Confidential Feedback Form.
 *
 * Phones get a full-screen sheet with a fixed header (progress) and footer
 * (save), so the 11 ratings scroll between them. Every text colour is set
 * explicitly: the sheet used to inherit the page colour, which a phone in dark
 * mode turns near-white, leaving headings invisible on the white sheet.
 */
export function EvaluationFormModal({
  isOpen,
  graduateName,
  defaultBusinessType = '',
  defaultEvaluatorName = '',
  initialPayload = null,
  onClose,
  onSubmit,
  isSubmitting = false,
}: Props) {
  const seedRatings = (): Record<string, EmployerEvaluationRating | ''> => {
    if (!initialPayload) return { ...EMPTY_RATINGS };
    const seeded: Record<string, EmployerEvaluationRating | ''> = { ...EMPTY_RATINGS };
    for (const q of RATING_QUESTIONS) {
      const v = initialPayload[q.key];
      if (typeof v === 'string' && (RATING_OPTIONS as { value: string }[]).some((o) => o.value === v)) {
        seeded[q.key] = v as EmployerEvaluationRating;
      }
    }
    return seeded;
  };

  const [evaluatorName, setEvaluatorName] = useState(initialPayload?.evaluator_name ?? '');
  const [employeeStatus, setEmployeeStatus] = useState<'regular' | 'probationary_casual_jo' | 'other' | ''>(
    initialPayload?.employee_status ?? '',
  );
  const [employeeStatusOther, setEmployeeStatusOther] = useState(initialPayload?.employee_status_other ?? '');
  const [yearsInCompany, setYearsInCompany] = useState(
    initialPayload?.years_in_company != null ? String(initialPayload.years_in_company) : '',
  );
  const [educationalAttainment, setEducationalAttainment] = useState(initialPayload?.educational_attainment ?? '');
  const [maritalStatus, setMaritalStatus] = useState(initialPayload?.marital_status ?? '');
  const [typeOfBusiness, setTypeOfBusiness] = useState(initialPayload?.type_of_business ?? defaultBusinessType);
  const [dateOfEvaluation, setDateOfEvaluation] = useState(
    initialPayload?.date_of_evaluation || new Date().toISOString().slice(0, 10),
  );
  const [ratings, setRatings] = useState<Record<string, EmployerEvaluationRating | ''>>(seedRatings());
  const [strengths, setStrengths] = useState(initialPayload?.assessment_strengths ?? '');
  const [improvements, setImprovements] = useState(initialPayload?.assessment_improvements ?? '');
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Pre-fill the evaluator from "Your name" when the sheet opens empty.
  useEffect(() => {
    if (isOpen && !evaluatorName.trim() && defaultEvaluatorName.trim()) {
      setEvaluatorName(defaultEvaluatorName.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Stop the page behind the sheet from scrolling along with it.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  if (!isOpen) return null;

  const ratedCount = RATING_QUESTIONS.filter((q) => ratings[q.key]).length;

  const setRating = (key: string, value: EmployerEvaluationRating) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const fail = (message: string, targetId: string) => {
    setError(message);
    setShowErrors(true);
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!evaluatorName.trim()) return fail("Employer's name is required.", 'eval-evaluator');
    if (!employeeStatus) return fail("Employee's status is required.", 'eval-status');
    const missing = RATING_QUESTIONS.filter((q) => !ratings[q.key]);
    if (missing.length) {
      return fail(
        `Please rate every item (${missing.length} left: ${missing.map((m) => m.label).join(', ')}).`,
        `eval-q-${String(missing[0].key)}`,
      );
    }
    if (!strengths.trim()) return fail('Please describe the employee’s greatest strengths.', 'eval-strengths');
    if (!improvements.trim()) return fail('Please describe where the employee can improve.', 'eval-improvements');

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

  // 16px text on phones: iOS zooms the page into any smaller input.
  const inputCls =
    'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-base sm:text-sm text-gray-900 placeholder:text-gray-500 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/20';
  const labelCls = 'block text-sm text-gray-800 mb-1.5';
  const invalid = (bad: boolean) => (showErrors && bad ? 'border-red-400 ring-2 ring-red-100' : '');

  const requestClose = () => {
    const dirty =
      evaluatorName.trim() !== defaultEvaluatorName.trim() ||
      employeeStatus ||
      employeeStatusOther.trim() ||
      yearsInCompany.trim() ||
      educationalAttainment.trim() ||
      maritalStatus.trim() ||
      strengths.trim() ||
      improvements.trim() ||
      Object.values(ratings).some((r) => r);
    if (!dirty || initialPayload || window.confirm('Discard your feedback? Your answers will be lost.')) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eval-title"
    >
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white text-gray-900 shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl">
        {/* Header: title + rating progress, always visible */}
        <div className="shrink-0 bg-gradient-to-r from-[#166534] to-[#15803d] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white sm:px-6 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="eval-title" className="text-base text-white sm:text-lg" style={{ fontWeight: 700 }}>
                Employer&apos;s Confidential Feedback Form
              </h2>
              <p className="mt-0.5 truncate text-sm text-white/90">Evaluation for {graduateName}</p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="mt-3" aria-live="polite">
            <div className="flex justify-between text-xs text-white/90">
              <span>{ratedCount} of {RATING_QUESTIONS.length} rated</span>
              <span>All items required</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: `${(ratedCount / RATING_QUESTIONS.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            {/* Confidential notice - RA 10173 (Data Privacy Act) */}
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#166534]" />
              <div>
                <p className="text-sm text-emerald-900" style={{ fontWeight: 600 }}>
                  Confidential · RA 10173 (Data Privacy Act of 2012)
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-emerald-900/90">
                  Only the CHMSU BSIS Program sees this, for batch reporting. The graduate will not see your name, ratings, or answers.
                </p>
              </div>
            </div>

            {/* Identification */}
            <section className="space-y-4">
              <h3 className="text-base text-gray-900" style={{ fontWeight: 700 }}>Evaluation details</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block" id="eval-evaluator">
                  <span className={labelCls} style={{ fontWeight: 600 }}>
                    Employer&apos;s name (Last, First, Middle) <span className="text-red-600">*</span>
                  </span>
                  <input
                    className={`${inputCls} ${invalid(!evaluatorName.trim())}`}
                    value={evaluatorName}
                    onChange={(e) => setEvaluatorName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label className="block">
                  <span className={labelCls} style={{ fontWeight: 600 }}>Employee&apos;s name</span>
                  <input className={`${inputCls} bg-gray-100 text-gray-700`} value={graduateName} readOnly />
                </label>

                <div className="md:col-span-2" id="eval-status">
                  <span className={labelCls} style={{ fontWeight: 600 }}>
                    Employee&apos;s status <span className="text-red-600">*</span>
                  </span>
                  <div role="radiogroup" aria-label="Employee's status" className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
                    {EMPLOYEE_STATUSES.map((s) => {
                      const active = employeeStatus === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setEmployeeStatus(s.value)}
                          className={`min-h-11 rounded-xl border px-3 py-2 text-sm transition ${
                            active
                              ? 'border-[#166534] bg-[#166534] text-white'
                              : `border-gray-300 bg-white text-gray-800 hover:bg-gray-50 ${showErrors && !employeeStatus ? 'border-red-400' : ''}`
                          }`}
                          style={{ fontWeight: active ? 600 : 500 }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
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
                  <span className={labelCls} style={{ fontWeight: 600 }}>Number of years <span className="text-gray-500 font-normal">(optional)</span></span>
                  <input type="number" inputMode="numeric" min={0} className={inputCls} value={yearsInCompany} onChange={(e) => setYearsInCompany(e.target.value)} />
                </label>
                <label className="block">
                  <span className={labelCls} style={{ fontWeight: 600 }}>Educational attainment <span className="text-gray-500 font-normal">(optional)</span></span>
                  <input className={inputCls} value={educationalAttainment} onChange={(e) => setEducationalAttainment(e.target.value)} />
                </label>
                <label className="block">
                  <span className={labelCls} style={{ fontWeight: 600 }}>Marital status <span className="text-gray-500 font-normal">(optional)</span></span>
                  <input className={inputCls} value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)} />
                </label>
                <label className="block">
                  <span className={labelCls} style={{ fontWeight: 600 }}>Type of business <span className="text-gray-500 font-normal">(optional)</span></span>
                  <input className={inputCls} value={typeOfBusiness} onChange={(e) => setTypeOfBusiness(e.target.value)} />
                </label>
                <label className="block md:col-span-2">
                  <span className={labelCls} style={{ fontWeight: 600 }}>Date of evaluation</span>
                  <input type="date" className={inputCls} value={dateOfEvaluation} onChange={(e) => setDateOfEvaluation(e.target.value)} />
                </label>
              </div>
            </section>

            {/* Section A: Characteristics */}
            <section className="space-y-3">
              <div>
                <h3 className="text-base text-gray-900" style={{ fontWeight: 700 }}>(A) Employee&apos;s characteristics</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-700">
                  <strong>Excellent</strong> consistently exceeds expectations · <strong>Very Good</strong> meets and occasionally exceeds · <strong>Good</strong> meets · <strong>Fair</strong> meets some, needs improvement · <strong>Unsatisfactory</strong> consistently falls below.
                </p>
              </div>
              <div className="space-y-3">
                {RATING_QUESTIONS.map((q, i) => {
                  const selected = ratings[q.key];
                  return (
                    <div
                      key={q.key}
                      id={`eval-q-${String(q.key)}`}
                      className={`scroll-mt-4 rounded-xl border p-3 sm:p-4 ${
                        showErrors && !selected ? 'border-red-300 bg-red-50/60' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <p className="text-sm text-gray-900" style={{ fontWeight: 600 }}>
                        <span className="text-gray-500">{i + 1}.</span> {q.label}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-700">{q.description}</p>
                      <div role="radiogroup" aria-label={q.label} className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                        {RATING_OPTIONS.map((opt) => {
                          const active = selected === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setRating(String(q.key), opt.value)}
                              className={`min-h-11 rounded-lg border px-1.5 py-2 text-xs leading-tight transition ${
                                active
                                  ? 'border-[#166534] bg-[#166534] text-white'
                                  : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                              }`}
                              style={{ fontWeight: active ? 700 : 500 }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Section B: Assessment */}
            <section className="space-y-4">
              <h3 className="text-base text-gray-900" style={{ fontWeight: 700 }}>(B) Employee&apos;s assessment</h3>
              <label className="block scroll-mt-4" id="eval-strengths">
                <span className={labelCls} style={{ fontWeight: 600 }}>
                  1. What do you perceive to be this employee&apos;s greatest strengths? <span className="text-red-600">*</span>
                </span>
                <textarea
                  className={`${inputCls} min-h-[96px] ${invalid(!strengths.trim())}`}
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                />
              </label>
              <label className="block scroll-mt-4" id="eval-improvements">
                <span className={labelCls} style={{ fontWeight: 600 }}>
                  2. In what area(s) does this employee need to improve? <span className="text-red-600">*</span>
                </span>
                <textarea
                  className={`${inputCls} min-h-[96px] ${invalid(!improvements.trim())}`}
                  value={improvements}
                  onChange={(e) => setImprovements(e.target.value)}
                />
              </label>
            </section>
          </div>

          {/* Footer: always reachable with a thumb */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
            {error && (
              <p role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
            <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:justify-end">
              <button
                type="button"
                onClick={requestClose}
                disabled={isSubmitting}
                className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm text-gray-800 hover:bg-gray-50"
                style={{ fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-11 rounded-xl bg-[#166534] px-5 text-sm text-white hover:bg-[#14532d] disabled:opacity-60"
                style={{ fontWeight: 600 }}
              >
                {isSubmitting ? 'Saving…' : 'Save feedback'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
