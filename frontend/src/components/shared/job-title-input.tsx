import { useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  checkJobTitle,
  isKeptAsTyped,
  keepJobTitleAsTyped,
  mergeJobTitles,
  tidyJobTitle,
} from '../../app/job-titles';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Admin-managed titles; common occupations are added on top. */
  referenceTitles?: string[];
  placeholder?: string;
  className?: string;
  id?: string;
};

/**
 * Free-text job title with suggestions while typing and a "Did you mean…?"
 * check once the field is left. Parents block their Next/Save with
 * `jobTitleNeedsReview` until the graduate picks the fix or keeps their text.
 */
export function JobTitleInput({ value, onChange, referenceTitles = [], placeholder, className = '', id }: Props) {
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [, rerender] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const referenceKey = referenceTitles.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const titles = useMemo(() => mergeJobTitles(referenceTitles), [referenceKey]);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (query.length < 2) return [];
    return titles
      .filter((t) => t.toLowerCase().includes(query) && t.toLowerCase() !== query)
      .sort((a, b) => Number(!a.toLowerCase().startsWith(query)) - Number(!b.toLowerCase().startsWith(query)))
      .slice(0, 6);
  }, [titles, query]);

  const check = checkJobTitle(value, referenceTitles);
  // A likely typo is flagged whenever the field is not being edited, including
  // a title saved earlier (e.g. "Artits") the moment the page opens. The Save
  // or Next button refuses to continue until it is resolved, so the prompt must
  // never depend on a blur having fired.
  const showTypo = !focused && check.kind === 'typo' && !isKeptAsTyped(value);
  // The softer "not in our list" note waits until the graduate has left the field.
  const showCustomNote = touched && !focused && check.kind === 'custom';

  const pick = (title: string) => {
    onChange(title);
    setFocused(false);
    setTouched(true);
    // Blur after React has applied the new value, so onBlur reads it.
    setTimeout(() => inputRef.current?.blur(), 0);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        className={className}
        autoComplete="organization-title"
        autoCapitalize="words"
        spellCheck
        role="combobox"
        aria-expanded={focused && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          setTouched(true);
          const current = e.currentTarget.value;
          const result = checkJobTitle(current, referenceTitles);
          const next = result.kind === 'known' ? result.canonical : tidyJobTitle(current);
          if (next !== current) onChange(next);
        }}
      />

      {focused && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {matches.map((title) => (
            <li key={title} role="option" aria-selected={false}>
              <button
                type="button"
                // Keep focus in the input so the list does not vanish mid-tap.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(title)}
                className="flex min-h-11 w-full items-center px-3 text-left text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100"
              >
                {title}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showTypo && check.kind === 'typo' && (
        <div role="status" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              Did you mean <strong>{check.suggestion}</strong>?
            </span>
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChange(check.suggestion)}
              className="min-h-11 rounded-lg bg-[#166534] px-3 py-2 text-sm text-white hover:bg-[#14532d]"
              style={{ fontWeight: 600 }}
            >
              Use &ldquo;{check.suggestion}&rdquo;
            </button>
            <button
              type="button"
              onClick={() => {
                keepJobTitleAsTyped(value);
                rerender((n) => n + 1);
              }}
              className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100 [overflow-wrap:anywhere]"
              style={{ fontWeight: 600 }}
            >
              Keep &ldquo;{value.trim()}&rdquo;
            </button>
          </div>
        </div>
      )}

      {showCustomNote && (
        <p className="mt-1.5 text-xs text-gray-500">Not in our suggestions, which is fine. Just double-check the spelling.</p>
      )}
    </div>
  );
}
