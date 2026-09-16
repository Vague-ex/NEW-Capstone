import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2 } from 'lucide-react';
import { createAlumniVerificationInvite, ApiClientError } from '../../app/api-client';

// Share-your-verification-link modal. Mints a fresh one-time token every time
// it opens, so it is shared by the Employment Details page (after a company
// change) and the dashboard (first login with a job and no link yet).
export function EmployerInviteModal({
  open,
  onClose,
  alumniId,
  subtitle = 'Your employer needs this link to confirm your new role.',
  footnote,
}: {
  open: boolean;
  onClose: () => void;
  alumniId: string;
  subtitle?: string;
  footnote?: string;
}) {
  // Empty until a token is minted: without a token there is no meaningful link
  // to share, since the token is what ties the response back to this graduate.
  const [link, setLink] = useState('');
  const [status, setStatus] = useState('');
  // Short read-lock so the graduate can't accidentally tap Close before they
  // have registered what the modal is telling them.
  const [closeCountdown, setCloseCountdown] = useState(3);

  useEffect(() => {
    if (!open) return;
    setCloseCountdown(3);
    const id = window.setInterval(() => {
      setCloseCountdown(c => (c > 0 ? c - 1 : 0));
    }, 1000);
    // Prevent the page under the modal from scrolling on mobile.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearInterval(id);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // The token row holds an `alumni` foreign key, so the response comes back
  // tied to this graduate automatically — the employer never has to identify
  // them, and never needs an account.
  // One mint per opening. The ref (not an effect cleanup flag) is what stops
  // StrictMode's double effect run from minting two tokens, each of which
  // counts against the backend's live-links cap.
  const mintedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      mintedRef.current = false;
      return;
    }
    if (mintedRef.current) return;
    mintedRef.current = true;
    setStatus('');
    // Clear any link left over from a previous open — otherwise a fresh mint
    // that fails silently would leave the stale URL visible as if it were new.
    setLink('');
    if (!alumniId) {
      setStatus('Your session has expired. Please sign in again.');
      return;
    }
    void (async () => {
      try {
        const res = await createAlumniVerificationInvite(alumniId);
        const tokenId = res?.token?.id;
        if (tokenId) {
          const base = typeof window === 'undefined' ? '' : window.location.origin;
          setLink(`${base}/verify/${tokenId}`);
        } else {
          setStatus('Could not create a verification link. Please try again.');
        }
      } catch (err) {
        // Surface the backend's own message when there is one — the common
        // failures ("save your current job first", the live-links cap, an
        // expired session) all need a different fix by the graduate.
        const detail = err instanceof ApiClientError ? err.message : '';
        setStatus(detail || 'Could not create a verification link. Please try again.');
      }
    })();
  }, [open, alumniId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Verification link copied. Send it to your employer or HR supervisor.');
    } catch {
      setStatus('Copy not available. Share the link below manually.');
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-link-title"
    >
      {/* Backdrop and Escape intentionally do NOT close the modal —
          this is the graduate's first look at how their employer
          actually verifies them, and a mis-tap outside should not
          dismiss it before they have read it. */}
      <div className="bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-2xl sm:max-w-md max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {/* Grabber — visual cue that this is a sheet on mobile. */}
        <div className="pt-2 pb-1 sm:hidden flex justify-center" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <div className="flex size-10 sm:size-9 items-center justify-center rounded-xl bg-amber-100 shrink-0">
            <Building2 className="size-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p id="share-link-title" className="text-gray-900 text-base sm:text-sm" style={{ fontWeight: 700 }}>Share your verification link</p>
            <p className="text-gray-500 text-sm sm:text-xs mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700 space-y-3 overflow-y-auto">
          <p>
            To verify your employment, your <span style={{ fontWeight: 600 }}>employer or HR supervisor</span> just opens the link below and answers a few questions.
            <span style={{ fontWeight: 600 }}> No account or sign-up is needed.</span> The link already identifies you, so they never have to look you up.
          </p>
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm sm:text-xs font-mono break-all text-gray-700 leading-relaxed">
            {link || (status ? '—' : 'Creating your link…')}
          </div>
          <p className="text-gray-500 text-xs">
            This link works once and expires in 7 days. You can create another for a different contact.
          </p>
          {footnote && <p className="text-gray-500 text-xs">{footnote}</p>}
          {status && (
            link ? (
              <p className="flex items-start gap-1.5 text-sm sm:text-xs text-emerald-700" style={{ fontWeight: 600 }}>
                <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" /> <span>{status}</span>
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-sm sm:text-xs text-red-700" style={{ fontWeight: 600 }}>
                <AlertTriangle className="size-4 text-red-500 mt-0.5 shrink-0" /> <span>{status}</span>
              </p>
            )
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              if (closeCountdown > 0) return;
              onClose();
            }}
            disabled={closeCountdown > 0}
            aria-live="polite"
            className="px-4 py-3 sm:py-2 rounded-xl border border-gray-200 text-gray-700 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-gray-100"
            style={{ fontWeight: 500 }}
          >
            {closeCountdown > 0 ? `Please read first (${closeCountdown})` : "I've got the link"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!link}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-2 rounded-xl bg-[#166534] hover:bg-[#14532d] text-white text-sm transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#166534]"
            style={{ fontWeight: 600 }}
          >
            <Building2 className="size-4" /> Copy link
          </button>
        </div>
      </div>
    </div>
  );
}
