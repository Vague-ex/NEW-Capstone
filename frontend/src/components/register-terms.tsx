/**
 * Alumni Registration - Terms & Conditions / Data Privacy Consent
 *
 * Final gate before submission. Collects two SEPARATE consents:
 *
 *   1. Terms & Conditions (required) - participation in the tracer study.
 *   2. Geomap / location consent (optional) - plotting the graduate's workplace,
 *      or their pinned home location, on the admin-only geomap.
 *
 * These are deliberately not one checkbox. Under the Data Privacy Act consent
 * must be specific and freely given, and publishing a workplace location on a
 * map is a materially broader disclosure than answering a tracer survey. An
 * alumnus must be able to join the study without appearing on the map.
 *
 * The terms are one long list in the page itself rather than a small scroll
 * box, which was cramped on phones and left a short, empty-looking card on
 * desktop. The agreement unlocks once the end of the list has been reached.
 */

import { useState, useRef, useEffect } from 'react';
import { ShieldCheck, MapPin, AlertCircle, ArrowLeft } from 'lucide-react';

export interface ConsentData {
  termsAccepted: boolean;
  geomapConsent: boolean;
}

interface Props {
  onComplete: (consent: ConsentData) => void;
  onBack: () => void;
}

const TERMS: { title: string; body: string }[] = [
  {
    title: 'Purpose of Collection',
    body: 'Carlos Hilado Memorial State University - Talisay Campus collects this information through the BSIS Graduate Tracer System to trace the employment outcomes of its graduates and to evaluate and improve the BSIS curriculum.',
  },
  {
    title: 'Information We Collect',
    body: 'Personal and contact details, academic records, employment history and job details, the pinned location of your home and workplace if you choose to set them, and a facial photograph together with the face-recognition data derived from it.',
  },
  {
    title: 'Face Recognition Data',
    body: 'Your face data is used solely to verify your identity at registration and to sign you in afterwards. It is never shared with employers or published.',
  },
  {
    title: 'Employer Verification',
    body: 'To confirm the accuracy of your employment record, the System may send a secure, single-use verification link to an employer contact you nominate. That link discloses only your name, program, and batch year - never your email address, contact details, or survey answers.',
  },
  {
    title: 'How Your Data Is Used',
    body: 'Reports and analytics produced by the System are aggregated and anonymised. Individual records are accessible only to authorised University personnel administering the tracer study.',
  },
  {
    title: 'Retention and Security',
    body: 'Records are retained for as long as required for institutional research, accreditation, and reporting. Images and identity data are stored in secured cloud storage with restricted access.',
  },
  {
    title: 'Your Rights',
    body: 'Under Republic Act No. 10173 (Data Privacy Act of 2012) you have the right to be informed, to access and correct your data, to object to its processing, and to request its erasure. You may withdraw any consent given here at any time by contacting the BSIS Program Chair, without affecting the lawfulness of processing already carried out.',
  },
  {
    title: 'Accuracy',
    body: 'You confirm that the information you provide is true and correct to the best of your knowledge. Knowingly submitting false information may result in your record being invalidated.',
  },
];

export default function RegisterTerms({ onComplete, onBack }: Props) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [geomapConsent, setGeomapConsent] = useState(false);
  const [error, setError] = useState('');
  // The agree box unlocks only once the end of the list has been on screen,
  // so acceptance reflects having seen the terms.
  const [readToEnd, setReadToEnd] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A plain scroll check rather than IntersectionObserver, which some
    // embedded WebViews deliver late or not at all.
    const check = () => {
      const el = endRef.current;
      // A short list on a tall screen is visible at once, which counts as read.
      if (el && el.getBoundingClientRect().top <= window.innerHeight) {
        setReadToEnd(true);
        return true;
      }
      return false;
    };
    if (check()) return;
    const onScroll = () => {
      if (check()) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const handleSubmit = () => {
    if (!termsAccepted) {
      setError('You must accept the Terms & Conditions to complete your registration.');
      return;
    }
    setError('');
    onComplete({ termsAccepted, geomapConsent });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 p-4 sm:p-6 border-b border-gray-100">
        <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 shrink-0">
          <ShieldCheck className="size-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>
            Terms &amp; Data Privacy Consent
          </h2>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5">
            Please read the terms below. The agreement is at the bottom of the list.
          </p>
        </div>
      </div>

      <ol className="divide-y divide-gray-100">
        {TERMS.map((term, i) => (
          <li key={term.title} className="flex gap-3 sm:gap-4 px-4 py-4 sm:px-6 sm:py-5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 text-xs"
              style={{ fontWeight: 700 }}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>{term.title}</p>
              <p className="text-gray-600 text-sm leading-relaxed mt-1">{term.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} aria-hidden="true" />

      <div className="space-y-3 p-4 sm:p-6 border-t border-gray-100 bg-gray-50/60">
        {!readToEnd && (
          <p className="text-gray-400 text-xs text-center">Scroll to the end of the terms to continue</p>
        )}

        {/* Required: Terms & Conditions */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
            termsAccepted ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
          } ${readToEnd ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          <input
            type="checkbox"
            checked={termsAccepted}
            disabled={!readToEnd}
            onChange={(e) => { setTermsAccepted(e.target.checked); setError(''); }}
            className="mt-0.5 size-5 accent-emerald-600 shrink-0"
          />
          <span className="text-xs sm:text-sm text-gray-700 leading-relaxed">
            <span style={{ fontWeight: 700 }}>I have read and accept the Terms &amp; Conditions.</span>
            {' '}I consent to Carlos Hilado Memorial State University collecting and processing my personal
            data, including my facial image and face-recognition data, for the purposes described above.
            <span className="text-red-500"> *</span>
          </span>
        </label>

        {/* Separate, optional: Geomap consent */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition ${
            geomapConsent ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
          }`}
        >
          <input
            type="checkbox"
            checked={geomapConsent}
            onChange={(e) => setGeomapConsent(e.target.checked)}
            className="mt-0.5 size-5 accent-emerald-600 shrink-0"
          />
          <span className="text-xs sm:text-sm text-gray-700 leading-relaxed">
            <span className="inline-flex items-center gap-1.5" style={{ fontWeight: 700 }}>
              <MapPin className="size-3.5 text-emerald-600" />
              Geomap consent (optional)
            </span>
            <br />
            Show my workplace (or my home pin if I&apos;m not employed) on the admin-only graduate map. Optional:
            declining doesn&apos;t affect your registration.
          </span>
        </label>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
            <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-xs">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onBack}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-sm transition flex items-center gap-1.5"
            style={{ fontWeight: 600 }}
          >
            <ArrowLeft className="size-4" /> Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={!termsAccepted}
            className="min-h-11 flex-1 bg-[#166534] hover:bg-[#14532d] disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm transition"
            style={{ fontWeight: 600 }}
          >
            Agree &amp; Complete Registration
          </button>
        </div>
      </div>
    </div>
  );
}
