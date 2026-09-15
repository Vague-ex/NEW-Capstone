import { useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, PencilLine, Search } from 'lucide-react';
import {
  checkJobTitle,
  isMarkedUnlisted,
  jobTextProblem,
  markJobTitleUnlisted,
  tidyJobTitle,
  unmarkJobTitleUnlisted,
  type JobTitleOption,
} from '../../app/job-titles';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Active titles from the admin list (Settings > Industries & Jobs). */
  options: JobTitleOption[];
  placeholder?: string;
  className?: string;
  id?: string;
};

/**
 * Job title picker backed by the admin's list.
 *
 * Typing searches the list (title or industry). A title that is not on the
 * list is not accepted as-is: the graduate either picks one ("Did you mean
 * Artist?") or taps "My job isn't listed" and types it, which is checked for
 * vulgar words and left for the admin to review. Parents gate Next/Save with
 * `jobTitleProblem`.
 */
export function JobTitleInput({ value, onChange, options, placeholder, className = '', id }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);

  const optionsKey = options.map((o) => o.name).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byLower = useMemo(() => new Map(options.map((o) => [o.name.trim().toLowerCase(), o])), [optionsKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => options.map((o) => o.name), [optionsKey]);

  const listed = byLower.get(value.trim().toLowerCase());
  const [unlisted, setUnlisted] = useState(() => !!value.trim() && !listed && isMarkedUnlisted(value));

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    return options
      .filter((o) => o.name.toLowerCase().includes(query) || (o.industry ?? '').toLowerCase().includes(query))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, query]);

  const change = (next: string) => {
    if (unlisted) {
      unmarkJobTitleUnlisted(value);
      markJobTitleUnlisted(next);
    }
    onChange(next);
  };

  const pick = (name: string) => {
    unmarkJobTitleUnlisted(value);
    setUnlisted(false);
    onChange(name);
    setFocused(false);
    setTimeout(() => inputRef.current?.blur(), 0);
  };

  const goUnlisted = () => {
    setUnlisted(true);
    markJobTitleUnlisted(value);
    setFocused(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const backToList = () => {
    unmarkJobTitleUnlisted(value);
    setUnlisted(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const trimmed = value.trim();
  const check = !listed && !unlisted && trimmed ? checkJobTitle(trimmed, names) : null;
  const suggestion = check?.kind === 'typo' ? check.suggestion : null;
  const unlistedProblem = unlisted ? jobTextProblem(value) : null;

  return (
    <div className="relative">
      <div className="relative">
        {!unlisted && (
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        )}
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          placeholder={unlisted ? 'Type your job title' : placeholder ?? 'Search job titles'}
          className={`${className} ${unlisted ? '' : '!pl-10'}`}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck
          role="combobox"
          aria-expanded={focused && !unlisted && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => change(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            const current = e.currentTarget.value;
            const hit = byLower.get(current.trim().toLowerCase());
            if (hit) {
              // Typed an exact listed title (in any casing): use the list's spelling.
              if (unlisted) {
                unmarkJobTitleUnlisted(current);
                setUnlisted(false);
              }
              if (hit.name !== current) onChange(hit.name);
            } else if (unlisted) {
              const tidy = tidyJobTitle(current);
              if (tidy !== current) change(tidy);
            }
          }}
        />
      </div>

      {focused && !unlisted && query && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {matches.map((option) => (
            <li key={option.name} role="option" aria-selected={listed?.name === option.name}>
              <button
                type="button"
                // Keep focus in the input so the list does not vanish mid-tap.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option.name)}
                className="flex min-h-11 w-full flex-col items-start justify-center px-3 py-1.5 text-left hover:bg-gray-50 active:bg-gray-100"
              >
                <span className="text-sm text-gray-900">{option.name}</span>
                {option.industry && <span className="text-xs text-gray-500">{option.industry}</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-gray-600">No job title matches &ldquo;{trimmed}&rdquo;.</li>
          )}
          <li className="border-t border-gray-100">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={goUnlisted}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-[#166534] hover:bg-gray-50"
              style={{ fontWeight: 600 }}
            >
              <PencilLine className="size-4" /> My job isn&apos;t listed
            </button>
          </li>
        </ul>
      )}

      {!focused && listed && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-700">
          <Check className="size-3.5 shrink-0" />
          On the job title list{listed.industry ? ` · ${listed.industry}` : ''}
        </p>
      )}

      {!focused && !listed && !unlisted && trimmed && (
        <div role="status" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            {suggestion ? (
              <span>Did you mean <strong>{suggestion}</strong>?</span>
            ) : (
              <span>&ldquo;{trimmed}&rdquo; is not on the job title list.</span>
            )}
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {suggestion ? (
              <button
                type="button"
                onClick={() => pick(suggestion)}
                className="min-h-11 rounded-lg bg-[#166534] px-3 py-2 text-sm text-white hover:bg-[#14532d]"
                style={{ fontWeight: 600 }}
              >
                Use &ldquo;{suggestion}&rdquo;
              </button>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.focus()}
                className="min-h-11 rounded-lg bg-[#166534] px-3 py-2 text-sm text-white hover:bg-[#14532d]"
                style={{ fontWeight: 600 }}
              >
                Choose from list
              </button>
            )}
            <button
              type="button"
              onClick={goUnlisted}
              className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
              style={{ fontWeight: 600 }}
            >
              My job isn&apos;t listed
            </button>
          </div>
        </div>
      )}

      {unlisted && !focused && (
        <div className={`mt-2 rounded-xl border p-3 ${unlistedProblem ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
          {unlistedProblem ? (
            <p role="alert" className="text-sm text-red-800">This job title {unlistedProblem}. Please change it.</p>
          ) : trimmed ? (
            <p className="text-sm text-gray-700">
              Not on the list. The admin will review &ldquo;{trimmed}&rdquo; and may add it.
            </p>
          ) : (
            <p className="text-sm text-gray-700">Type your job title above.</p>
          )}
          <button
            type="button"
            onClick={backToList}
            className="mt-1.5 min-h-9 text-sm text-[#166534] underline-offset-2 hover:underline"
            style={{ fontWeight: 600 }}
          >
            Choose from the list instead
          </button>
        </div>
      )}
    </div>
  );
}
