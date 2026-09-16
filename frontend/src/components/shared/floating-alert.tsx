import { AlertCircle, X } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Fixed-position dismissable alert used on the biometric screens so an error
 * never shoves the camera off the fold. Rendered outside the normal document
 * flow -- it does not push layout, closes on backdrop tap or the X button, and
 * traps focus for keyboard users.
 */
export function FloatingAlert({
  message,
  onClose,
  tone = 'error',
}: {
  message: string;
  onClose: () => void;
  tone?: 'error' | 'warn';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!message) return null;

  const palette = tone === 'error'
    ? { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'text-red-500' }
    : { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'text-amber-500' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-6 px-4 pointer-events-none">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        className={`pointer-events-auto w-full max-w-md rounded-xl border shadow-lg ${palette.bg} ${palette.border} p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2`}
      >
        <AlertCircle className={`size-5 shrink-0 mt-0.5 ${palette.icon}`} />
        <p className={`flex-1 text-sm ${palette.text}`}>{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close alert"
          className={`shrink-0 rounded-md p-1 hover:bg-black/5 ${palette.icon}`}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
