/**
 * Employer verification, as the admin runs it.
 *
 * The graduate supplies the company / HR / supervisor address with their
 * current job; the admin is the one who sends the one-time verification link
 * to it. The same panel sits on the pending-verification card and on the
 * verified graduate card, so the address and the Send button are in the same
 * place wherever an admin is looking at a graduate.
 */

import { useState } from 'react';
import { Mail, Send, CheckCircle2, XCircle, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { sendEmployerVerification } from '../../app/api-client';
import type { AlumniRecord } from '../../data/app-data';

export type EmployerVerificationState = 'none' | 'sent' | 'verified' | 'denied';

/** The employer-check state of a graduate's current job. */
export function employerVerificationState(a: AlumniRecord): EmployerVerificationState {
  const raw = String(a.employerVerificationStatus ?? 'none');
  return raw === 'sent' || raw === 'verified' || raw === 'denied' ? raw : 'none';
}

/** Graduates the panel's "not verified by an employer yet" filter keeps. */
export function awaitsEmployerVerification(a: AlumniRecord): boolean {
  const state = employerVerificationState(a);
  return state === 'none' || state === 'sent';
}

export function employerEmailOf(a: AlumniRecord): string {
  const sd = (a.surveyData ?? {}) as Record<string, unknown>;
  return String(a.employerEmail ?? sd.currentJobEmployerEmail ?? sd.current_job_employer_email ?? '');
}

const BADGE: Record<EmployerVerificationState, { label: string; cls: string; Icon: typeof Mail }> = {
  none: { label: 'Not yet requested', cls: 'bg-gray-100 text-gray-600', Icon: Mail },
  sent: { label: 'Request sent · awaiting reply', cls: 'bg-amber-50 text-amber-700', Icon: Clock },
  verified: { label: 'Confirmed by employer', cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  denied: { label: 'Employer could not confirm', cls: 'bg-red-50 text-red-700', Icon: XCircle },
};

export function EmployerVerificationPanel({ alumni, onSent }: {
  alumni: AlumniRecord;
  /** Called after a successful send so the list can refresh its badges. */
  onSent?: () => void;
}) {
  const storedEmail = employerEmailOf(alumni);
  const state = employerVerificationState(alumni);
  const [email, setEmail] = useState(storedEmail);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const badge = BADGE[state];
  const answered = state === 'verified' || state === 'denied';
  const sentAt = alumni.employerVerificationSentAt
    ? new Date(String(alumni.employerVerificationSentAt)).toLocaleDateString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : '';

  const send = async () => {
    const id = String(alumni.id ?? '');
    if (!id) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await sendEmployerVerification(
        [id],
        // Only pass an override when the admin actually changed it, so the
        // stored address stays the default and a blank box cannot blank it.
        email.trim() && email.trim().toLowerCase() !== storedEmail.toLowerCase() ? email.trim() : undefined,
      );
      const row = res.results[0];
      setResult(row?.sent
        ? { ok: true, text: `Verification request sent to ${row.email}.` }
        : { ok: false, text: row?.detail ?? 'The request could not be sent.' });
      if (row?.sent) onSent?.();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'The request could not be sent.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-[#166534] text-xs" style={{ fontWeight: 700 }}>EMPLOYER VERIFICATION</p>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${badge.cls}`}
          style={{ fontWeight: 600 }}>
          <badge.Icon className="size-3" /> {badge.label}
        </span>
        {state === 'sent' && sentAt && <span className="text-gray-400 text-[11px]">sent {sentAt}</span>}
      </div>

      <label className="block text-gray-500 text-xs mb-1.5" htmlFor={`emp-email-${alumni.id}`}>
        Company / HR / supervisor email
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id={`emp-email-${alumni.id}`}
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setResult(null); }}
          placeholder="No employer email on file"
          className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none transition focus:border-[#166534] focus:bg-white focus:ring-2 focus:ring-[#166534]/15"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !email.trim() || answered}
          title={answered ? 'The employer has already answered for this job.' : undefined}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#166534] px-3 py-2 text-xs text-white transition hover:bg-[#14532d] disabled:opacity-50"
          style={{ fontWeight: 600 }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {state === 'sent' ? 'Resend' : 'Send request'}
        </button>
      </div>

      {!storedEmail && !answered && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle className="size-3.5 shrink-0 mt-px" />
          This graduate registered before the employer email was required. Type one to send the request.
        </p>
      )}
      {result && (
        <p className={`mt-2 text-[11px] ${result.ok ? 'text-emerald-700' : 'text-red-700'}`}>{result.text}</p>
      )}
    </div>
  );
}
