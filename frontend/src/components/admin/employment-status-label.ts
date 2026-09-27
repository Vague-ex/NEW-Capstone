// The admin list API flattens Q1 to three buckets (employed / self-employed /
// unemployed), so "Seeking", "Not seeking" and "Never employed" all arrive as
// "unemployed" and the reviewer cannot tell them apart. The fine-grained answer
// survives untouched in surveyData.employment_status, so read it from there and
// fall back to the flattened value only when the survey blob is missing.
//
// Labels mirror EmploymentProfile.EmploymentStatusChoices in
// backend/tracer/models.py, phrased for the CHED Q1 row.
const SURVEY_LABELS: Record<string, string> = {
  employed_full_time: 'Presently Employed (Full-Time)',
  employed_part_time: 'Presently Employed (Part-Time)',
  self_employed: 'Self-Employed / Freelancer',
  seeking: 'Seeking Employment',
  not_seeking: 'Not Seeking Employment (further studies / personal reasons)',
  never_employed: 'Never Been Employed',
};

const COARSE_LABELS: Record<string, string> = {
  employed: 'Presently Employed',
  'self-employed': 'Self-Employed / Freelancer',
  unemployed: 'Not Currently Employed',
};

/**
 * @param surveyStatus surveyData.employment_status (raw survey value)
 * @param coarseStatus AlumniRecord.employmentStatus (flattened API value)
 */
export function employmentStatusLabel(surveyStatus: unknown, coarseStatus: unknown): string {
  const raw = String(surveyStatus ?? '').trim().toLowerCase();
  return SURVEY_LABELS[raw]
    ?? COARSE_LABELS[String(coarseStatus ?? '').trim().toLowerCase()]
    ?? 'Not Currently Employed';
}
