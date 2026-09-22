/**
 * Data Privacy Notice shown when a graduate taps "Create account".
 *
 * Informs before any data is collected (RA 10173, right to be informed) and
 * takes the one consent registration needs: "Continue" stays disabled until the
 * box is ticked. There is no later Terms step and no separate geomap consent;
 * this notice lists the geomap as one of the purposes consented to.
 *
 * Shown on the way into registration (and by the registration page itself when
 * it is opened directly), not on every visit to the login page, so returning
 * graduates signing in are never interrupted. Render it only while open, so the
 * box starts unticked every time.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck, X, Target, ClipboardList, MapPin, Lock, Scale, ArrowRight, BadgeCheck,
} from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
}

const COLLECTED = [
  { label: 'Personal and contact details', detail: 'name, birth month and year, gender, civil status, email, mobile number and home address' },
  { label: 'Academic information', detail: 'graduation batch, honors, eligibility and further studies' },
  { label: 'Employment information', detail: 'employment status, job title, company, work address and skills' },
  { label: 'Facial photographs and face-recognition data', detail: 'used only to verify your identity when you register and sign in' },
  { label: 'Location data', detail: 'your device’s GPS location when you register and sign in, for audit purposes, and your work or home location for geomapping' },
];

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#166534]">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm text-gray-900" style={{ fontWeight: 700 }}>{title}</h3>
        <div className="mt-1 space-y-2 text-[13px] leading-relaxed text-gray-600">{children}</div>
      </div>
    </section>
  );
}

export default function PrivacyNoticeModal({ open, onClose, onContinue }: Props) {
  const [agreed, setAgreed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Callers pass an inline onClose; reading it through a ref keeps the effect
  // below from re-running (and moving focus) on every parent re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Start at the top of the notice so it is read from the heading down. In
    // testing the text once opened scrolled to the end, so focus without letting
    // the browser scroll, and pin the text to its start.
    panelRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Keep keyboard focus inside the dialog.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:px-4 sm:py-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-notice-title"
        aria-describedby="privacy-notice-intro"
        tabIndex={-1}
        className="gt-scale flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none sm:max-w-xl sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#166534] text-white">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="privacy-notice-title" className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              Data Privacy Notice
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">Please read before creating your account.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <p id="privacy-notice-intro" className="text-[13px] leading-relaxed text-gray-700">
            The information you provide in this system is <span style={{ fontWeight: 600 }}>personal and protected data</span> under
            the Data Privacy Act of 2012 (Republic Act No. 10173). Before you register, we want you to know what we
            collect, why we need it, and how it is protected.
          </p>

          <Section icon={Target} title="Purpose">
            <p>
              The BSIS Graduate Tracer System is a capstone research project of the Bachelor of Science in Information
              Systems program, Carlos Hilado Memorial State University – Talisay Campus. Your information is used to
              trace the employment outcomes of BSIS graduates, analyse employability trends, and support curriculum
              improvement.
            </p>
          </Section>

          <Section icon={ClipboardList} title="Information we collect">
            <ul className="space-y-1.5">
              {COLLECTED.map((item) => (
                <li key={item.label} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[#166534]" />
                  <span>
                    <span className="text-gray-800" style={{ fontWeight: 600 }}>{item.label}</span>
                    {' '}({item.detail})
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={MapPin} title="Geomapping">
            <p>
              Your workplace location (or your pinned home location if you are not employed) is plotted on a graduate
              distribution map that only authorised BSIS administrators can see.
            </p>
          </Section>

          <Section icon={Lock} title="How your data is protected">
            <p>
              Your records are stored securely with restricted access. Individual records are seen only by
              authorised University personnel administering the tracer study, and published results are aggregated
              and anonymised. Your face data is never shared or published. When you ask an employer to confirm your
              job, they see only your name, program and batch. Records are kept for as long as institutional
              research, accreditation and reporting require.
            </p>
          </Section>

          <Section icon={BadgeCheck} title="Accuracy">
            <p>
              You confirm that the information you provide is true and correct to the best of your knowledge.
              Knowingly submitting false information may result in your record being invalidated.
            </p>
          </Section>

          <Section icon={Scale} title="Your rights">
            <p>
              You have the right to be informed, to access and correct your data, to object to its processing, and
              to request its erasure. You may withdraw your consent at any time by contacting the BSIS Program Chair.
            </p>
          </Section>

          <p className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3 text-xs leading-relaxed text-gray-500">
            Continuing does not submit anything yet. Your answers are sent only when you review and submit them at
            the end of registration.
          </p>
        </div>

        {/* Footer: the consent stays in view however far the notice is scrolled. */}
        <div className="space-y-3 border-t border-gray-100 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              agreed ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
            }`}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-emerald-600"
            />
            <span className="text-xs leading-relaxed text-gray-700 sm:text-[13px]">
              <span style={{ fontWeight: 700 }}>I have read and accept the Terms &amp; Conditions.</span>
              {' '}I consent to Carlos Hilado Memorial State University collecting and processing my personal data,
              including my facial image and face-recognition data, for the purposes described above.
              <span className="text-red-500"> *</span>
            </span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm text-gray-600 transition hover:bg-gray-50 sm:min-h-0 sm:py-2.5"
              style={{ fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onContinue}
              disabled={!agreed}
              className="gt-press flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#166534] px-5 text-sm text-white transition hover:bg-[#14532d] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-2.5"
              style={{ fontWeight: 600 }}
            >
              Agree &amp; continue <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
