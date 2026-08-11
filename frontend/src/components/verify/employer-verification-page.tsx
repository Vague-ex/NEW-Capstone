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
 */

import { useCallback, useEffect, useState } from 'react';
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
  Briefcase, ShieldCheck, Loader2, Star,
} from 'lucide-react';

type Stage = 'loading' | 'invalid' | 'form' | 'done';

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#166534]/30 focus:border-[#166534]';

function Field({ label, required, children, hint }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string;
}) {
  return (
    <div>
      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && <p className="text-gray-400 text-[11px] mt-1">{hint}</p>}
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

  const [evaluation, setEvaluation] = useState<EmployerEvaluationPayload | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const submit = useCallback(async (decision: 'confirm' | 'deny') => {
    setFormError('');
    if (!verifierName.trim() || !verifierEmail.trim()) {
      setFormError('Please give your name and work email so we can record who confirmed this.');
      return;
    }
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
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not submit your response. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [tokenId, comment, employerName, jobTitleId, employmentStatus, startDate,
      verifierName, verifierEmail, verifierPosition, evaluation]);

  const graduateName = detail?.alumni?.name ?? 'BSIS Graduate';
  const jobTitles = (referenceData?.job_titles ?? []) as Array<{ id: string; name: string }>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Employment Verification</p>
            <p className="text-gray-400 text-xs">Carlos Hilado Memorial State University · BSIS Graduate Tracer</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {stage === 'loading' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <Loader2 className="size-6 text-[#166534] animate-spin mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading verification request…</p>
          </div>
        )}

        {stage === 'invalid' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-amber-50 mx-auto mb-3">
              <AlertTriangle className="size-6 text-amber-600" />
            </div>
            <h1 className="text-gray-900 mb-1" style={{ fontWeight: 700 }}>Link unavailable</h1>
            <p className="text-gray-500 text-sm">{loadError}</p>
          </div>
        )}

        {stage === 'done' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50 mx-auto mb-3">
              <CheckCircle2 className="size-6 text-emerald-600" />
            </div>
            <h1 className="text-gray-900 mb-1" style={{ fontWeight: 700 }}>Response recorded</h1>
            <p className="text-gray-500 text-sm">{resultMessage}</p>
            <p className="text-gray-400 text-xs mt-3">You can close this page. No account is needed.</p>
          </div>
        )}

        {stage === 'form' && (
          <>
            {/* Read-only graduate card — deliberately no email address. */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]/10 shrink-0">
                  <ShieldCheck className="size-5 text-[#166534]" />
                </div>
                <div className="min-w-0">
                  <p className="text-gray-500 text-xs">You are being asked to confirm employment for</p>
                  <h1 className="text-gray-900 mt-0.5" style={{ fontWeight: 700, fontSize: '1.15rem' }}>
                    {graduateName}
                  </h1>
                  <p className="text-gray-500 text-xs mt-1">
                    {detail?.alumni?.program ?? 'BSIS'}
                    {detail?.alumni?.batchYear ? ` · Batch ${detail.alumni.batchYear}` : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <div>
                <p className="text-gray-800 text-sm mb-2" style={{ fontWeight: 700 }}>
                  Does this graduate work at your organisation?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setWorksHere(true)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm transition ${
                      worksHere === true ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`} style={{ fontWeight: 600 }}>
                    <CheckCircle2 className="size-4" /> Yes, they work here
                  </button>
                  <button onClick={() => setWorksHere(false)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm transition ${
                      worksHere === false ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`} style={{ fontWeight: 600 }}>
                    <XCircle className="size-4" /> No, they do not
                  </button>
                </div>
              </div>

              {worksHere === true && (
                <div className="space-y-4 pt-1">
                  <Field label="Organisation name" required>
                    <input value={employerName} onChange={(e) => setEmployerName(e.target.value)}
                      className={inputCls} placeholder="e.g. Accenture Philippines" />
                  </Field>
                  <Field label="Job title">
                    <select value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)} className={inputCls}>
                      <option value="">Select the closest match</option>
                      {jobTitles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Employment status">
                    <select value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)} className={inputCls}>
                      <option value="">Select status</option>
                      <option value="regular">Regular / Permanent</option>
                      <option value="probationary">Probationary</option>
                      <option value="contractual">Contractual / Casual</option>
                      <option value="self_employed">Self-Employed / Freelance</option>
                    </select>
                  </Field>
                  <Field label="Start date" hint="Approximate is fine.">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                  </Field>
                </div>
              )}

              {worksHere !== null && (
                <>
                  <div className="border-t border-gray-100 pt-4 space-y-4">
                    <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Your details</p>
                    <p className="text-gray-500 text-xs -mt-2">
                      Recorded so the University can confirm who verified this record.
                    </p>
                    <Field label="Your name" required>
                      <input value={verifierName} onChange={(e) => setVerifierName(e.target.value)}
                        className={inputCls} placeholder="e.g. Maria Reyes" />
                    </Field>
                    <Field label="Your work email" required hint="Please use your company email if you have one.">
                      <input type="email" value={verifierEmail} onChange={(e) => setVerifierEmail(e.target.value)}
                        className={inputCls} placeholder="you@company.com" />
                    </Field>
                    <Field label="Your position">
                      <input value={verifierPosition} onChange={(e) => setVerifierPosition(e.target.value)}
                        className={inputCls} placeholder="e.g. HR Manager" />
                    </Field>
                    <Field label="Comment">
                      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                        className={inputCls} placeholder="Anything the University should know (optional)" />
                    </Field>
                  </div>

                  {worksHere === true && (
                    <button onClick={() => setShowEvaluation(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm transition"
                      style={{ fontWeight: 600 }}>
                      <Star className="size-4" />
                      {evaluation ? 'Feedback added — edit' : 'Add optional performance feedback'}
                    </button>
                  )}

                  {formError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                      <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-700 text-xs">{formError}</p>
                    </div>
                  )}

                  <button
                    onClick={() => submit(worksHere ? 'confirm' : 'deny')}
                    disabled={submitting}
                    className="w-full bg-[#166534] hover:bg-[#14532d] disabled:opacity-60 text-white py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2"
                    style={{ fontWeight: 600 }}>
                    {submitting
                      ? <><Loader2 className="size-4 animate-spin" /> Submitting…</>
                      : worksHere
                        ? <><Building2 className="size-4" /> Confirm employment</>
                        : <><Briefcase className="size-4" /> Submit response</>}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <EvaluationFormModal
        isOpen={showEvaluation}
        graduateName={graduateName}
        initialPayload={evaluation}
        onClose={() => setShowEvaluation(false)}
        onSubmit={(payload) => { setEvaluation(payload); setShowEvaluation(false); }}
      />
    </div>
  );
}
