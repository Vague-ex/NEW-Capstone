/**
 * No emoji in any text box. One capture-phase listener on the document covers
 * every input and textarea in the app (typing, pasting, dropping, the phone
 * emoji keyboard), including boxes added later, so no page has to remember a
 * per-field filter.
 */

// Extended_Pictographic is Unicode's "this is an emoji" property. (c), (R) and
// TM are in it but belong in company names, so they are let through. The
// bracket lists the invisible pieces emoji are assembled from: flag letters,
// skin tones, tag characters, the emoji variation selector, joiner and keycap.
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}️‍⃣]/gu;

export function stripEmoji(value: string): string {
  return value.replace(EMOJI, '');
}

function clean(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  const next = stripEmoji(el.value);
  if (next === el.value) return false;
  let caret: number | null = null;
  try {
    // Keep the caret after the text that was before it. Email and number
    // inputs have no selection and throw here.
    if (el.selectionStart != null) caret = stripEmoji(el.value.slice(0, el.selectionStart)).length;
  } catch { /* no selection API on this input type */ }
  // The prototype setter, not `el.value = next`: React watches the value
  // through its own setter on the element, and has to still see a change here
  // or it skips onChange and the state keeps the emoji the box no longer shows.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
  if (caret != null) {
    try { el.setSelectionRange(caret, caret); } catch { /* see above */ }
  }
  return true;
}

/** Install once at the app root. Returns the uninstall function. */
export function installEmojiGuard(): () => void {
  const onInput = (e: Event) => {
    // Rewriting the value mid-composition (Chinese/Japanese keyboards) breaks
    // the composition; compositionend below catches whatever it produced.
    if ((e as InputEvent).isComposing) return;
    clean(e.target);
  };
  const onCompositionEnd = (e: Event) => {
    // Chrome sends its last input event before compositionend, so React has
    // already stored the emoji: announce the cleaned value as a new input.
    if (clean(e.target)) e.target?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.addEventListener('input', onInput, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  return () => {
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
  };
}
