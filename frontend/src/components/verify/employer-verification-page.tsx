/**
 * Public employer verification page — /verify/:tokenId
 *
 * Employers have no accounts. A graduate sends their employer a one-time link;
 * holding that link IS the authorisation to answer. The token row carries an
 * `alumni` foreign key, so the system already knows whose employment is being
 * confirmed — the employer never has to identify the graduate, which removes
 * the name-matching ambiguity entirely.
 *
 * What the link cannot establish is WHO is answering, so the verifier
 * identifies themselves and that identity is recorded for the audit trail.
 *
 * Deliberately renders no PortalLayout and reads no session: this page must
 * work in a private window for someone who has never used the system.
 *
 * Most employers open the link on a phone, so the page is one short column of
 * numbered steps with a submit bar pinned to the bottom. The Confidential
 * Feedback Form is optional, but once started it must be complete: the backend
 * rejects a half-filled evaluation. Everything the employer types in steps 2
 * and 3 is carried into that form rather than asked a second time.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  ApiClientError,
  fetchVerificationToken,
  submitVerificationDecision,
  type EmployerEvaluationPayload,
  type VerificationTokenDetail,
} from '../../app/api-client';
import { useReferenceData } from '../../hooks/useReferenceData';
import { EvaluationFormModal, type EvaluationContext } from './evaluation-form-modal';
import {
  GraduationCap, CheckCircle2, XCircle, AlertTriangle, Building2,
  Briefcase, ShieldCheck, Loader2, ClipboardList, Pencil,
} from 'lucide-react';

type Stage = 'loading' | 'invalid' | 'form' | 'done';

// 16px text on phones: iOS zooms the page into any smaller input.
const inputCls =
  'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-base sm:text-sm text-gray-900 placeholder:text-gray-500 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/20';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors _is_same_person in backend/tracer/api.py: the comparable words of a
// name, without punctuation, order or single-letter initials. The verifier may
// not answer under the graduate's own name.
const nameKey = (value: string) =>
  [...new Set(value.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter((w) => w.length > 1))];

function isSamePerson(one: string, other: string): boolean {
  const a = nameKey(one), b = nameKey(other);
  if (a.length < 2 || b.length < 2) return false;
  // Subset either way: the stored name carries the full middle name, and
  // almost nobody types theirs.
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  return small.every((word) => big.includes(word));
}

function Field({ label, required, children, hint, hintTone, htmlFor }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string;
  hintTone?: 'error'; htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-gray-800 text-sm mb-1.5" style={{ fontWeight: 600 }}>
        {label}
        {required
          ? <span className="text-red-600"> *</span>
          : <span className="text-gray-500" style={{ fontWeight: 400 }}> (optional)</span>}
      </label>
      {children}
      {hint && <p className={`text-xs mt-1.5 ${hintTone === 'error' ? 'text-red-700' : 'text-gray-600'}`}>{hint}</p>}
    </div>
  );
}

function Section({ id, step, title, subtitle, children }: {
  id: string; step: number; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#166534] text-white text-xs"
          style={{ fontWeight: 700 }}
          aria-hidden
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-gray-900 text-base" style={{ fontWeight: 700 }}>{title}</h2>
          {subtitle && <p className="text-gray-600 text-sm mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Why a verifier said no. Mandatory on the deny path and a closed list,
 * because "no" on its own cannot tell a graduate who left or was let go apart
 * from one who never worked there — and only the first two leave an
 * employment history worth keeping.
 */
const DENY_REASONS = [
  { value: 'resigned', label: 'No longer employed here — resigned' },
  { value: 'terminated', label: 'No longer employed here — terminated or contract ended' },
  { value: 'never_employed', label: 'Never worked at this organisation' },
  { value: 'different_role', label: 'Works here, but not in the role stated' },
  { value: 'cannot_confirm', label: 'Cannot confirm — no record, or not my department' },
  { value: 'other', label: 'Other (please explain below)' },
] as const;

/**
 * Employment status, with the Confidential Feedback Form's own three-way
 * answer beside it. The employer is asked once, here, and the form reuses it;
 * keeping both columns in one table is what stops the two drifting apart.
 */
const STATUS_OPTIONS = [
  { value: 'regular', label: 'Regular / Permanent', employeeStatus: 'regular', other: '' },
  { value: 'probationary', label: 'Probationary', employeeStatus: 'probationary_casual_jo', other: '' },
  { value: 'contractual', label: 'Contractual / Casual', employeeStatus: 'probationary_casual_jo', other: '' },
  { value: 'self_employed', label: 'Self-Employed / Freelance', employeeStatus: 'other', other: 'Self-Employed / Freelance' },
] as const;

export function EmployerVerificationPage() {
  const { tokenId = '' } = useParams();
  const { data: referenceData } = useReferenceData();

  const [stage, setStage] = useState<Stage>('loading');
  const [detail, setDetail] = useState<VerificationTokenDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  const [worksHere, setWorksHere] = useState<boolean | null>(null);
  const [jobTitleId, setJobTitleId] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [comment, setComment] = useState('');
  const [denyReason, setDenyReason] = useState('');

  const [verifierName, setVerifierName] = useState('');
  const [verifierEmail, setVerifierEmail] = useState('');
  const [verifierPosition, setVerifierPosition] = useState('');

  const [evaluation, setEvaluation] = useState<EmployerEvaluationPayload | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [formError, setFormError] = useState('');
  const [resultMessage, setResultMessage] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      if (!tokenId) { setStage('invalid'); setLoadError('This verification link is missing its identifier.'); return; }
      try {
        const data = await fetchVerificationToken(tokenId);
        if (!active) return;
        const status = String(data?.token?.status ?? '').toLowerCase();
        if (status && status !== 'pending') {
          setStage('invalid');
          setLoadError(
            status === 'used'
              ? 'This verification link has already been used. Each link can only be submitted once.'
              : `This verification link is no longer valid (${status}). Ask the graduate to send a new one.`,
          );
          return;
        }
        setDetail(data);
        const rec = (data?.employmentRecord ?? {}) as Record<string, unknown>;
        setEmployerName(String(rec.employerName ?? rec.employer_name_input ?? ''));
        setStage('form');
      } catch (err) {
        if (!active) return;
        setStage('invalid');
        setLoadError(
          err instanceof ApiClientError && err.status === 404
            ? 'This verification link was not found. It may have been mistyped or withdrawn.'
            : 'Could not load this verification link. Please try again shortly.',
        );
      }
    })();
    return () => { active = false; };
  }, [tokenId]);

  // What still blocks submission, in page order, so the first one can be scrolled to.
  const missing = useMemo(() => {
    const items: { sectionId: string; text: string }[] = [];
    if (worksHere === null) return items;
    if (worksHere && !employerName.trim()) items.push({ sectionId: 'section-job', text: 'organisation name' });
    if (worksHere && !employmentStatus) items.push({ sectionId: 'section-job', text: 'employment status' });
    // Saying no asks for the reason and an address, nothing else: the name,
    // organisation and position are optional there, like the comment.
    if (!worksHere && !denyReason) items.push({ sectionId: 'section-no', text: 'a reason' });
    if (worksHere && !verifierName.trim()) items.push({ sectionId: 'section-you', text: 'your name' });
    if (!EMAIL_RE.test(verifierEmail.trim())) items.push({ sectionId: 'section-you', text: 'a valid work email' });
    if (worksHere && !verifierPosition.trim()) items.push({ sectionId: 'section-you', text: 'your position' });
    return items;
  }, [worksHere, employerName, employmentStatus, denyReason, verifierName, verifierEmail, verifierPosition]);

  const submit = useCallback(async () => {
    if (worksHere === null) return;
    setFormError('');
    setTriedSubmit(true);
    if (missing.length) {
      setFormError(`Still needed: ${missing.map((m) => m.text).join(', ')}.`);
      document.getElementById(missing[0].sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // The backend refuses this too; stopping here saves a round trip and keeps
    // the message beside the box that has to change.
    if (isSamePerson(verifierName, detail?.alumni?.name ?? '')) {
      setFormError('Step 3 must be the person confirming this employment, not the graduate.');
      document.getElementById('section-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const decision = worksHere ? 'confirm' : 'deny';
    setSubmitting(true);
    try {
      const res = await submitVerificationDecision(tokenId, {
        decision,
        comment: comment.trim(),
        ...(decision === 'deny' ? { deny_reason: denyReason } : {}),
        verified_employer_name: employerName.trim(),
        verified_job_title_id: jobTitleId || undefined,
        verifier_name: verifierName.trim(),
        verifier_email: verifierEmail.trim(),
        verifier_position: verifierPosition.trim(),
        // Step 2's status and start date reach the backend inside the
        // evaluation, as employee_status / years_in_company; the decision
        // endpoint has no column of its own for either.
        ...(decision === 'confirm' && evaluation ? evaluation : {}),
      });
      setResultMessage(res.message ?? 'Thank you — your response has been recorded.');
      setStage('done');
      window.scrollTo({ top: 0 });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not submit your response. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [tokenId, worksHere, missing, comment, denyReason, employerName, jobTitleId, detail,
      verifierName, verifierEmail, verifierPosition, evaluation]);

  const graduateName = detail?.alumni?.name ?? 'BSIS Graduate';
  const firstName = graduateName.split(' ')[0] || 'this graduate';
  const jobTitles = useMemo(
    () => (referenceData?.job_titles ?? []) as Array<{ id: string; name: string }>,
    [referenceData],
  );

  // Steps 2 and 3, shaped for the feedback form: it shows these read-only and
  // submits employeeStatus / employeeStatusOther as its own required answers.
  const evaluationContext = useMemo<EvaluationContext>(() => {
    const status = STATUS_OPTIONS.find((o) => o.value === employmentStatus);
    return {
      employerName: employerName.trim(),
      jobTitle: jobTitles.find((t) => t.id === jobTitleId)?.name ?? '',
      startDate,
      employmentStatusLabel: status?.label ?? '',
      employeeStatus: status?.employeeStatus ?? '',
      employeeStatusOther: status?.other ?? '',
      verifierName: verifierName.trim(),
      verifierPosition: verifierPosition.trim(),
      verifierEmail: verifierEmail.trim(),
    };
  }, [employerName, jobTitles, jobTitleId, startDate, employmentStatus,
      verifierName, verifierPosition, verifierEmail]);

  const selfName = isSamePerson(verifierName, graduateName);
  // Step 2 is "Job details" on yes and "Why not?" on no, so step 3 is "Your
  // details" either way.
  const stepYou = 3;
  const showBar = stage === 'form' && worksHere !== null;
  const needs = (text: string) => triedSubmit && missing.some((m) => m.text === text);

  return (
    <div className="min-h-[100dvh] bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-gray-900 text-sm truncate" style={{ fontWeight: 700 }}>Employment Verification</p>
            <p className="text-gray-600 text-xs truncate">
              <span className="sm:hidden">CHMSU · BSIS Graduate Tracer</span>
              <span className="hidden sm:inline">Carlos Hilado Memorial State University · BSIS Graduate Tracer</span>
            </p>
          </div>
        </div>
      </header>

      {/* Bottom padding has to be its own utility, not a `pb-40` after
          `sm:py-8`: the variant is emitted later in the sheet, so from 640px up
          it won the cascade and the fixed bar covered the end of step 4. */}
      <main className={`max-w-2xl mx-auto px-4 pt-5 sm:pt-8 space-y-4 ${showBar ? 'pb-40' : 'pb-5 sm:pb-8'}`}>
        {stage === 'loading' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
            <Loader2 className="size-6 text-[#166534] animate-spin mx-auto mb-3" />
            <p className="text-gray-700 text-sm">Loading verification request…</p>
          </div>
        )}

        {stage === 'invalid' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-amber-50 mx-auto mb-3">
              <AlertTriangle className="size-6 text-amber-600" />
            </div>
            <h1 className="text-gray-900 text-lg mb-1" style={{ fontWeight: 700 }}>Link unavailable</h1>
            <p className="text-gray-700 text-sm">{loadError}</p>
          </div>
        )}

        {stage === 'done' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50 mx-auto mb-3">
              <CheckCircle2 className="size-7 text-emerald-600" />
            </div>
            <h1 className="text-gray-900 text-lg mb-1" style={{ fontWeight: 700 }}>Response recorded</h1>
            <p className="text-gray-700 text-sm">{resultMessage}</p>
            <p className="text-gray-600 text-sm mt-4">You can close this page.</p>
          </div>
        )}

        {stage === 'form' && (
          <>
            {/* Read-only graduate card — deliberately no email address. */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-[#166534]/10 shrink-0">
                  <ShieldCheck className="size-5 text-[#166534]" />
                </div>
                <div className="min-w-0">
                  <p className="text-gray-600 text-sm">You are asked to confirm employment for</p>
                  <h1 className="text-gray-900 mt-0.5 break-words" style={{ fontWeight: 700, fontSize: '1.2rem' }}>
                    {graduateName}
                  </h1>
                  <p className="text-gray-600 text-sm mt-0.5">
                    {detail?.alumni?.program ?? 'BSIS'}
                    {detail?.alumni?.batchYear ? ` · Batch ${detail.alumni.batchYear}` : ''}
                  </p>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-3 pt-3 border-t border-gray-100">
                Takes about 5 minutes. Your answers are confidential — the graduate never sees them — and are
                handled under RA 10173, the Data Privacy Act of 2012.
              </p>
            </div>

            <Section
              id="section-works"
              step={1}
              title={`Does ${firstName} work at your organisation?`}
              subtitle="If you do not know this graduate, answer No."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={worksHere === true}
                  onClick={() => setWorksHere(true)}
                  className={`min-h-14 flex items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm transition ${
                    worksHere === true ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  <CheckCircle2 className="size-5" /> Yes
                </button>
                <button
                  type="button"
                  aria-pressed={worksHere === false}
                  onClick={() => setWorksHere(false)}
                  className={`min-h-14 flex items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm transition ${
                    worksHere === false ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  <XCircle className="size-5" /> No
                </button>
              </div>
            </Section>

            {worksHere === true && (
              <Section id="section-job" step={2} title="Job details" subtitle="As shown in your records.">
                <div className="space-y-4">
                  <Field label="Organisation name" required htmlFor="v-org">
                    <input id="v-org" value={employerName} onChange={(e) => setEmployerName(e.target.value)}
                      autoComplete="organization"
                      className={`${inputCls} ${needs('organisation name') ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                      placeholder="e.g. Accenture Philippines" />
                  </Field>
                  <Field label="Job title" htmlFor="v-title" hint="Pick the closest match, or leave blank if none fits.">
                    <select id="v-title" value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)} className={inputCls}>
                      <option value="">Select the closest match</option>
                      {jobTitles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Employment status" required htmlFor="v-status">
                      <select id="v-status" value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)}
                        className={`${inputCls} ${needs('employment status') ? 'border-red-400 ring-2 ring-red-100' : ''}`}>
                        <option value="">Select status</option>
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Start date" htmlFor="v-start" hint="Approximate is fine.">
                      <input id="v-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                </div>
              </Section>
            )}

            {worksHere === false && (
              <Section
                id="section-no"
                step={2}
                title="Why not?"
                subtitle="The University records this with the graduate's history. Only the reason is required."
              >
                <div className="space-y-4">
                  <Field label="Reason" required htmlFor="v-deny-reason"
                    hint="Someone who left and someone who never worked here mean different things for the record.">
                    <select id="v-deny-reason" value={denyReason}
                      onChange={(e) => setDenyReason(e.target.value)}
                      className={`${inputCls} ${needs('a reason') ? 'border-red-400 ring-2 ring-red-100' : ''}`}>
                      <option value="">Select a reason</option>
                      {DENY_REASONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Organisation name" htmlFor="v-no-org"
                    hint="Only if you want the record to name where you are answering from.">
                    <input id="v-no-org" value={employerName} onChange={(e) => setEmployerName(e.target.value)}
                      autoComplete="organization" className={inputCls} placeholder="e.g. Accenture Philippines" />
                  </Field>
                </div>
              </Section>
            )}

            {worksHere !== null && (
              <Section id="section-you" step={stepYou} title="Your details"
                subtitle={worksHere
                  ? 'So the University knows who confirmed this record.'
                  : 'Only your email is needed. The rest is optional.'}>
                <div className="space-y-4">
                  <Field label="Your name" required={worksHere === true} htmlFor="v-name"
                    hint={selfName ? `That is the graduate's own name — ${firstName} cannot confirm this. Enter your own.` : undefined}
                    hintTone={selfName ? 'error' : undefined}>
                    <input id="v-name" value={verifierName} onChange={(e) => setVerifierName(e.target.value)}
                      autoComplete="name"
                      className={`${inputCls} ${needs('your name') || selfName ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                      placeholder="e.g. Maria Reyes" />
                  </Field>
                  <Field label="Your work email" required htmlFor="v-email" hint="Please use your company email if you have one.">
                    <input id="v-email" type="email" inputMode="email" autoComplete="email" value={verifierEmail}
                      onChange={(e) => setVerifierEmail(e.target.value)}
                      className={`${inputCls} ${needs('a valid work email') ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                      placeholder="you@company.com" />
                  </Field>
                  <Field label="Your position" required={worksHere === true} htmlFor="v-position">
                    <input id="v-position" value={verifierPosition} onChange={(e) => setVerifierPosition(e.target.value)}
                      autoComplete="organization-title"
                      className={`${inputCls} ${needs('your position') ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                      placeholder="e.g. HR Manager" />
                  </Field>
                  <Field label="Comment" htmlFor="v-comment">
                    <textarea id="v-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
                      className={inputCls} placeholder="Anything the University should know" />
                  </Field>
                </div>
              </Section>
            )}

            {worksHere === true && (
              <Section
                id="section-feedback"
                step={4}
                title="Confidential feedback form"
                subtitle="Optional. 11 quick ratings and two short answers."
              >
                {evaluation ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center">
                    <div className="flex flex-1 items-center gap-2 text-emerald-900">
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                      <span className="text-sm" style={{ fontWeight: 600 }}>Feedback complete</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEvaluation(true)}
                      className="min-h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 text-sm text-emerald-900 hover:bg-emerald-100"
                      style={{ fontWeight: 600 }}
                    >
                      <Pencil className="size-4" /> Review or edit
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowEvaluation(true)}
                      className="min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-[#166534] bg-white px-4 text-sm text-[#166534] transition hover:bg-[#166534]/5"
                      style={{ fontWeight: 700 }}
                    >
                      <ClipboardList className="size-5" /> Start feedback form (optional)
                    </button>
                  </>
                )}
              </Section>
            )}
          </>
        )}
      </main>

      {showBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto">
            {formError && (
              <p role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-red-700">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> {formError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="min-h-12 w-full bg-[#166534] hover:bg-[#14532d] disabled:opacity-60 text-white rounded-xl text-sm transition flex items-center justify-center gap-2"
              style={{ fontWeight: 600 }}
            >
              {submitting
                ? <><Loader2 className="size-4 animate-spin" /> Submitting…</>
                : worksHere
                  ? <><Building2 className="size-4" /> Confirm employment</>
                  : <><Briefcase className="size-4" /> Submit response</>}
            </button>
          </div>
        </div>
      )}

      <EvaluationFormModal
        isOpen={showEvaluation}
        graduateName={graduateName}
        context={evaluationContext}
        initialPayload={evaluation}
        onClose={() => setShowEvaluation(false)}
        onSubmit={(payload) => {
          setEvaluation(payload);
          setShowEvaluation(false);
          setFormError('');
        }}
      />
    </div>
  );
}
