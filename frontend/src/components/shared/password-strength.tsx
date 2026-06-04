import { CheckCircle2, Circle } from 'lucide-react';

/**
 * Shared password-strength rules so every "create password" screen (graduate
 * registration, employer registration, forgot-password reset) enforces the
 * same policy and shows the same live checklist.
 */
export function evaluatePassword(p: string) {
  return {
    length: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    number: /[0-9]/.test(p),
    special: /[^A-Za-z0-9]/.test(p),
  };
}

export function isPasswordStrong(p: string): boolean {
  return Object.values(evaluatePassword(p)).every(Boolean);
}

export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';

/** Live checklist that turns each item green as it is satisfied. */
export function PasswordChecklist({ password, show = true }: { password: string; show?: boolean }) {
  if (!show) return null;
  const c = evaluatePassword(password);
  const items = [
    { ok: c.length, label: 'At least 8 characters' },
    { ok: c.upper, label: 'An uppercase letter (A–Z)' },
    { ok: c.lower, label: 'A lowercase letter (a–z)' },
    { ok: c.number, label: 'A number (0–9)' },
    { ok: c.special, label: 'A special character (!@#$…)' },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mt-2">
      <p className="text-gray-600 text-[11px] mb-2" style={{ fontWeight: 600 }}>
        Your password must include:
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {items.map((req) => (
          <li key={req.label} className="flex items-center gap-1.5">
            {req.ok
              ? <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
              : <Circle className="size-3.5 text-gray-300 shrink-0" />}
            <span
              className={`text-[11px] ${req.ok ? 'text-emerald-700' : 'text-gray-500'}`}
              style={{ fontWeight: req.ok ? 600 : 400 }}
            >
              {req.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
