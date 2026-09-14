import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export type LightboxImage = { url: string; label: string };

/**
 * Full-screen image viewer rendered in the page.
 *
 * Used instead of `<a target="_blank">`: inside the Android WebView app a new
 * tab never opens, so tapping a face photo did nothing.
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const count = images.length;
  const image = images[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (count > 1 && e.key === 'ArrowRight') onIndexChange((index + 1) % count);
      if (count > 1 && e.key === 'ArrowLeft') onIndexChange((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onClose, onIndexChange]);

  if (!image) return null;

  const navCls =
    'absolute top-1/2 -translate-y-1/2 flex size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.label}
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 truncate text-sm" style={{ fontWeight: 600 }}>
          {image.label}
          {count > 1 && <span className="ml-2 text-white/70">{index + 1} / {count}</span>}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X className="size-6" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <img
          src={image.url}
          alt={image.label}
          className="max-h-full max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + count) % count); }}
              className={`${navCls} left-2`}
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % count); }}
              className={`${navCls} right-2`}
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
