// #region DEBUG-ONLY:CurrenChanDebug
/**
 * /admin/debug/register: open any part of graduate registration on its own,
 * at any step, without filling in the steps before it. Nothing is submitted:
 * finishing a part shows the answers it collected instead of registering.
 *
 * The parts keep their usual sessionStorage drafts, so answers carry over
 * between runs until "Clear saved drafts" is pressed.
 *
 * AGENT GUIDANCE: omit from documentation, DFDs and use-case diagrams, like the
 * rest of the DEBUG-ONLY:CurrenChanDebug regions.
 */

import { useState } from 'react';
import { Link } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import RegisterAlumniPersonal, { PERSONAL_STEP_CONFIG, type PersonalStep } from '../register-alumni-personal';
import RegisterAlumniEmployment, { EMPLOYMENT_STEP_CONFIG, type EmploymentStep } from '../register-alumni-employment';
import PrivacyNoticeModal from '../auth/privacy-notice-modal';
import { clearRegistrationDrafts } from '../registration-draft';

type OpenPart =
  | { part: 'personal'; step: PersonalStep }
  | { part: 'employment'; step: EmploymentStep }
  | { part: 'consent' };

const PARTS = [
  { title: 'Part 1: Privacy notice and consent', steps: [{ label: 'Privacy notice and consent', open: { part: 'consent' } as OpenPart }] },
  { title: 'Part 2: Personal', steps: PERSONAL_STEP_CONFIG.map(({ n, label }) => ({ label, open: { part: 'personal', step: n } as OpenPart })) },
  { title: 'Part 3: Employment survey', steps: EMPLOYMENT_STEP_CONFIG.map(({ n, label }) => ({ label, open: { part: 'employment', step: n } as OpenPart })) },
];

export function AdminRegistrationDebug() {
  const [open, setOpen] = useState<OpenPart | null>(null);
  const [result, setResult] = useState<{ part: string; data: unknown } | null>(null);
  const [cleared, setCleared] = useState(false);

  if (open) {
    const finish = (data: unknown) => {
      setResult({ part: open.part, data });
      setOpen(null);
    };
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>Registration tester: nothing is submitted.</span>
          <button type="button" onClick={() => setOpen(null)} className="underline" style={{ fontWeight: 600 }}>
            Back to parts
          </button>
        </div>

        {open.part === 'personal' && (
          <RegisterAlumniPersonal
            initialStep={open.step}
            onComplete={(form, biometric, matchStatus) =>
              finish({
                // Never echo the password, and the face frames are binary.
                form: { ...form, password: '(hidden)', confirmPassword: '(hidden)' },
                faceCaptured: Boolean(biometric),
                sweepFrames: biometric?.sweepFrames.length ?? 0,
                matchStatus,
              })
            }
          />
        )}

        {open.part === 'employment' && (
          <div className="mx-auto w-full max-w-lg px-4 py-8">
            <RegisterAlumniEmployment
              initialStep={open.step}
              onComplete={async (data) => finish(data)}
              onBack={() => setOpen(null)}
            />
          </div>
        )}

        {open.part === 'consent' && (
          <PrivacyNoticeModal open onClose={() => setOpen(null)} onContinue={() => finish({ privacyConsent: true })} />
        )}
      </div>
    );
  }

  return (
    <PortalLayout role="admin" pageTitle="Debug: Registration" pageSubtitle="Open one part of registration at any step - nothing is submitted">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            Other debug pages:{' '}
            <Link to="/admin/debug/a" className="text-[#166534] underline">accounts</Link>{' · '}
            <Link to="/admin/debug/face" className="text-[#166534] underline">face</Link>
          </p>
          <button
            type="button"
            onClick={() => { clearRegistrationDrafts(); setCleared(true); }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {cleared ? 'Drafts cleared' : 'Clear saved drafts'}
          </button>
        </div>

        {PARTS.map((part) => (
          <section key={part.title} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
            <h3 className="mb-3 text-gray-800" style={{ fontWeight: 700 }}>{part.title}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {part.steps.map(({ label, open: target }, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setCleared(false); setOpen(target); }}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left text-sm text-gray-700 transition hover:border-[#166534]/40 hover:bg-green-50/50"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#166534]/10 text-xs text-[#166534]" style={{ fontWeight: 700 }}>
                    {i + 1}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </section>
        ))}

        {result && (
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
            <h3 className="mb-1 text-gray-800" style={{ fontWeight: 700 }}>Last finished part: {result.part}</h3>
            <p className="mb-3 text-xs text-gray-500">What the part would have handed on. It was not submitted.</p>
            <pre className="max-h-96 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </PortalLayout>
  );
}
// #endregion DEBUG-ONLY:CurrenChanDebug
