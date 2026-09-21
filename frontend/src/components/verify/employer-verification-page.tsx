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
 * numbered steps with a submit bar pinned to the bottom. Confirming requires
 * the Confidential Feedback Form: the backend rejects a confirmation without
 * it, so the page must never present it as optional.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  ApiClientError,
  fetchVerificationToken,
  submitVerificationDecision,
  type EmployerEvaluationPayload,
  type VerificationTokenDetail,
} from '../../app/api-client';
import { useReferenceData } from '../../hooks/useReferenceData';
import { EvaluationFormModal } from './evaluation-form-modal';
import {
  GraduationCap, CheckCircle2, XCircle, AlertTriangle, Building2,
  Briefcase, ShieldCheck, Loader2, ClipboardList, Pencil,
} from 'lucide-react';

type Stage = 'loading' | 'invalid' | 'form' | 'done';

// 16px text on phones: iOS zooms the page into any smaller input.
const inputCls =
  'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-base sm:text-sm text-gray-900 placeholder:text-gray-500 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/20';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Field({ label, required, children, hint, htmlFor }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string; htmlFor?: string;
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
      {hint && <p className="text-gray-600 text-xs mt-1.5">{hint}</p>}
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
 * Shown before the form: whose record this is and what the answers are used
 * for. The employer may not know the University, so this is said up front
 * rather than only in the fine print of the feedback form.
 */
function PurposeNotice({ graduateName, onAccept }: { graduateName: string; onAccept: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purpose-title"
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white text-gray-900 shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-3 sm:px-6 sm:pt-6">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[#166534]/10 mb-3">
            <ShieldCheck className="size-5 text-[#166534]" />
          </div>
          <h2 id="purpose-title" className="text-gray-900 text-lg" style={{ fontWeight: 700 }}>Before you begin</h2>
          <p className="text-gray-700 text-sm mt-2 leading-relaxed">
            This form is about your employee <span style={{ fontWeight: 700 }}>{graduateName}</span>, a BSIS graduate
            of Carlos Hilado Memorial State University. The graduate sent you this link.
          </p>
          <p className="text-gray-900 text-sm mt-4" style={{ fontWeight: 700 }}>Your answers are used only to:</p>
          <ul className="mt-1.5 space-y-1.5 text-sm text-gray-700 list-disc pl-5">
            <li>confirm this graduate&apos;s employment record in the BSIS Graduate Tracer, and</li>
            <li>produce anonymous, batch-level reports that help the BSIS program improve its curriculum.</li>
          </ul>
          <p className="text-gray-900 text-sm mt-4" style={{ fontWeight: 700 }}>Your answers are never:</p>
          <ul className="mt-1.5 space-y-1.5 text-sm text-gray-700 list-disc pl-5">
            <li>shown to the graduate,</li>
            <li>shared with other employers or the public, or</li>
            <li>used for any decision about the graduate&apos;s job.</li>
          </ul>
          <p className="text-gray-600 text-xs mt-4 leading-relaxed">
            Handled under RA 10173, the Data Privacy Act of 2012. If you do not know this graduate, answer
            &quot;No&quot; to the first question.
          </p>
        </div>
        <div className="shrink-0 border-t border-gray-200 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
          <button
            ref={buttonRef}
            type="button"
            onClick={onAccept}
            className="min-h-12 w-full rounded-xl bg-[#166534] hover:bg-[#14532d] text-white text-sm transition"
            style={{ fontWeight: 600 }}
          >
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}

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

  const [verifierName, setVerifierName] = useState('');
  const [verifierEmail, setVerifierEmail] = useState('');
  const [verifierPosition, setVerifierPosition] = useState('');

  const [noticeAccepted, setNoticeAccepted] = useState(false);
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
    if (!verifierName.trim()) items.push({ sectionId: 'section-you', text: 'your name' });
    if (!EMAIL_RE.test(verifierEmail.trim())) items.push({ sectionId: 'section-you', text: 'a valid work email' });
    if (worksHere && !evaluation) items.push({ sectionId: 'section-feedback', text: 'the feedback form' });
    return items;
  }, [worksHere, employerName, verifierName, verifierEmail, evaluation]);

  const submit = useCallback(async () => {
    if (worksHere === null) return;
    setFormError('');
    setTriedSubmit(true);
    if (missing.length) {
      setFormError(`Still needed: ${missing.map((m) => m.text).join(', ')}.`);
      document.getElementById(missing[0].sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const decision = worksHere ? 'confirm' : 'deny';
    setSubmitting(true);
    try {
      const res = await submitVerificationDecision(tokenId, {
        decision,
        comment: comment.trim(),
        verified_employer_name: employerName.trim(),
        verified_job_title_id: jobTitleId || undefined,
        employment_status: employmentStatus || undefined,
        start_date: startDate || undefined,
        verifier_name: verifierName.trim(),
        verifier_email: verifierEmail.trim(),
        verifier_position: verifierPosition.trim(),
        ...(decision === 'confirm' && evaluation ? evaluation : {}),
      } as Parameters<typeof submitVerificationDecision>[1]);
      setResultMessage(res.message ?? 'Thank you — your response has been recorded.');
      setStage('done');
      window.scrollTo({ top: 0 });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not submit your response. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [tokenId, worksHere, missing, comment, employerName, jobTitleId, employmentStatus, startDate,
      verifierName, verifierEmail, verifierPosition, evaluation]);

  const graduateName = detail?.alumni?.name ?? 'BSIS Graduate';
  const firstName = graduateName.split(' ')[0] || 'this graduate';
  const jobTitles = (referenceData?.job_titles ?? []) as Array<{ id: string; name: string }>;

  const stepYou = worksHere ? 3 : 2;
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

      <main className={`max-w-2xl mx-auto px-4 py-5 sm:py-8 space-y-4 ${showBar ? 'pb-40' : ''}`}>
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
                Takes about 5 minutes. Your feedback is confidential — the graduate never sees it.
              </p>
            </div>

            <Section id="section-works" step={1} title={`Does ${firstName} work at your organisation?`}>
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
                    <Field label="Employment status" htmlFor="v-status">
                      <select id="v-status" value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)} className={inputCls}>
                        <option value="">Select status</option>
                        <option value="regular">Regular / Permanent</option>
                        <option value="probationary">Probationary</option>
                        <option value="contractual">Contractual / Casual</option>
                        <option value="self_employed">Self-Employed / Freelance</option>
                      </select>
                    </Field>
                    <Field label="Start date" htmlFor="v-start" hint="Approximate is fine.">
                      <input id="v-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                </div>
              </Section>
            )}

            {worksHere !== null && (
              <Section id="section-you" step={stepYou} title="Your details" subtitle="So the University knows who confirmed this record.">
                <div className="space-y-4">
                  <Field label="Your name" required htmlFor="v-name">
                    <input id="v-name" value={verifierName} onChange={(e) => setVerifierName(e.target.value)}
                      autoComplete="name"
                      className={`${inputCls} ${needs('your name') ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                      placeholder="e.g. Maria Reyes" />
                  </Field>
                  <Field label="Your work email" required htmlFor="v-email" hint="Please use your company email if you have one.">
                    <input id="v-email" type="email" inputMode="email" autoComplete="email" value={verifierEmail}
                      onChange={(e) => setVerifierEmail(e.target.value)}
                      className={`${inputCls} ${needs('a valid work email') ? 'border-red-400 ring-2 ring-red-100' : ''}`}
                      placeholder="you@company.com" />
                  </Field>
                  <Field label="Your position" htmlFor="v-position">
                    <input id="v-position" value={verifierPosition} onChange={(e) => setVerifierPosition(e.target.value)}
                      autoComplete="organization-title" className={inputCls} placeholder="e.g. HR Manager" />
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
                subtitle="Required to confirm. 11 quick ratings and two short answers."
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
                      className={`min-h-12 w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 px-4 text-sm transition ${
                        needs('the feedback form')
                          ? 'border-red-400 bg-red-50 text-red-800'
                          : 'border-[#166534] bg-white text-[#166534] hover:bg-[#166534]/5'
                      }`}
                      style={{ fontWeight: 700 }}
                    >
                      <ClipboardList className="size-5" /> Start feedback form
                    </button>
                    {needs('the feedback form') && (
                      <p className="text-red-700 text-xs mt-2">Please complete the feedback form before confirming.</p>
                    )}
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

      {stage === 'form' && !noticeAccepted && (
        <PurposeNotice graduateName={graduateName} onAccept={() => setNoticeAccepted(true)} />
      )}

      <EvaluationFormModal
        isOpen={showEvaluation}
        graduateName={graduateName}
        defaultEvaluatorName={verifierName}
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
