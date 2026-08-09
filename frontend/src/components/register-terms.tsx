/**
 * Alumni Registration - Terms & Conditions / Data Privacy Consent
 *
 * Final gate before submission. Collects two SEPARATE consents:
 *
 *   1. Terms & Conditions (required) - participation in the tracer study.
 *   2. Geomap / location consent (optional) - plotting the graduate's workplace
 *      on the publicly visible map.
 *
 * These are deliberately not one checkbox. Under the Data Privacy Act consent
 * must be specific and freely given, and publishing a workplace location on a
 * map is a materially broader disclosure than answering a tracer survey. An
 * alumnus must be able to join the study without appearing on the map.
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

export default function RegisterTerms({ onComplete, onBack }: Props) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [geomapConsent, setGeomapConsent] = useState(false);
  const [error, setError] = useState('');
  // The agree box unlocks only once the terms have actually been scrolled
  // through, so acceptance reflects having seen them.
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Short documents may not overflow at all; treat those as already read rather
  // than leaving the checkbox permanently disabled.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 4) setScrolledToEnd(true);
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolledToEnd(true);
  };

  const handleSubmit = () => {
    if (!termsAccepted) {
      setError('You must accept the Terms & Conditions to complete your registration.');
      return;
    }
    setError('');
    onComplete({ termsAccepted, geomapConsent });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 shrink-0">
          <ShieldCheck className="size-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>
            Terms &amp; Data Privacy Consent
          </h2>
          <p className="text-gray-500 text-xs mt-0.5">
            Please read and accept before we create your account.
          </p>
        </div>
      </div>

      {/* Scrollable terms */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-56 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 space-y-3"
      >
        <p style={{ fontWeight: 700 }}>1. Purpose of Collection</p>
        <p>
          Carlos Hilado Memorial State University - Talisay Campus collects this information through the
          BSIS Graduate Tracer System to trace the employment outcomes of its graduates, to evaluate and
          improve the BSIS curriculum, and to satisfy accreditation and government reporting requirements.
        </p>

        <p style={{ fontWeight: 700 }}>2. Information We Collect</p>
        <p>
          Personal and contact details, academic records, employment history and job details, and a
          facial photograph together with the face-recognition data derived from it. Your face data is
          used solely to verify your identity at registration and to sign you in afterwards. It is never
          shared with employers or published.
        </p>

        <p style={{ fontWeight: 700 }}>3. Employer Verification</p>
        <p>
          To confirm the accuracy of your employment record, the System may send a secure, single-use
          verification link to an employer contact you nominate. That link discloses only your name,
          program, and batch year - never your email address, contact details, or survey answers.
        </p>

        <p style={{ fontWeight: 700 }}>4. How Your Data Is Used</p>
        <p>
          Reports and analytics produced by the System are aggregated and anonymised. Individual records
          are accessible only to authorised University personnel administering the tracer study.
        </p>

        <p style={{ fontWeight: 700 }}>5. Retention and Security</p>
        <p>
          Records are retained for as long as required for institutional research, accreditation, and
          reporting. Images and identity data are stored in secured cloud storage with restricted access.
        </p>

        <p style={{ fontWeight: 700 }}>6. Your Rights</p>
        <p>
          Under Republic Act No. 10173 (Data Privacy Act of 2012) you have the right to be informed, to
          access and correct your data, to object to its processing, and to request its erasure. You may
          withdraw any consent given here at any time by contacting the BSIS Program Chair, without
          affecting the lawfulness of processing already carried out.
        </p>

        <p style={{ fontWeight: 700 }}>7. Accuracy</p>
        <p>
          You confirm that the information you provide is true and correct to the best of your knowledge.
          Knowingly submitting false information may result in your record being invalidated.
        </p>
      </div>

      {!scrolledToEnd && (
        <p className="text-gray-400 text-xs text-center">Scroll to the end of the terms to continue</p>
      )}

      {/* Required: Terms & Conditions */}
      <label
        className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
          termsAccepted ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
        } ${scrolledToEnd ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
      >
        <input
          type="checkbox"
          checked={termsAccepted}
          disabled={!scrolledToEnd}
          onChange={(e) => { setTermsAccepted(e.target.checked); setError(''); }}
          className="mt-0.5 size-4 accent-emerald-600 shrink-0"
        />
        <span className="text-xs text-gray-700 leading-relaxed">
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
          className="mt-0.5 size-4 accent-emerald-600 shrink-0"
        />
        <span className="text-xs text-gray-700 leading-relaxed">
          <span className="inline-flex items-center gap-1.5" style={{ fontWeight: 700 }}>
            <MapPin className="size-3.5 text-emerald-600" />
            Geomap consent (optional)
          </span>
          <br />
          I allow my workplace location to be plotted on the University&apos;s graduate distribution map.
          The map shows where BSIS graduates are employed. Declining does not affect your registration -
          your responses are still counted in all aggregated reports.
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
          className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition flex items-center gap-1.5"
          style={{ fontWeight: 600 }}
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={!termsAccepted}
          className="flex-1 bg-[#166534] hover:bg-[#14532d] disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm transition"
          style={{ fontWeight: 600 }}
        >
          Agree &amp; Complete Registration
        </button>
      </div>
    </div>
  );
}
