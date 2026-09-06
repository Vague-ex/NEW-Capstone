/**
 * Draft persistence for the multi-step alumni registration.
 *
 * Registration spans two long forms. Losing everything to an accidental
 * refresh is the difference between a graduate finishing the survey and
 * abandoning it, which directly costs the study its sample size.
 *
 * sessionStorage, not localStorage: these drafts hold personal information,
 * and registrations are often done on shared or lab machines. sessionStorage
 * dies with the tab; localStorage would outlive the person using it.
 */

export const PERSONAL_DRAFT_KEY = 'alumniPersonalDraft';
export const EMPLOYMENT_DRAFT_KEY = 'employmentFormData';

/**
 * Never written to storage. A password in sessionStorage is readable by any
 * script on the origin and survives until the tab closes, which is not a
 * trade worth making to save one field of typing.
 */
const NEVER_PERSIST = ['password', 'confirmPassword'] as const;

export function saveDraft(key: string, value: Record<string, unknown>): void {
    try {
        const safe: Record<string, unknown> = { ...value };
        for (const field of NEVER_PERSIST) delete safe[field];
        sessionStorage.setItem(key, JSON.stringify(safe));
    } catch {
        // Private browsing, disabled storage, or quota exceeded. A draft is a
        // convenience; failing to save one must never break the form.
    }
}

/**
 * Restores a draft merged OVER the defaults, so a draft written before a field
 * existed cannot leave that field undefined. Replacing the object wholesale —
 * which the employment form used to do — turns any later schema change into a
 * crash for anyone holding an older draft.
 */
export function loadDraft<T extends object>(key: string, defaults: T): T {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
        return { ...defaults, ...(parsed as Partial<T>) };
    } catch {
        return defaults;
    }
}

export function hasDraft(key: string): boolean {
    try {
        return sessionStorage.getItem(key) !== null;
    } catch {
        return false;
    }
}

/**
 * Call on successful registration. Without this the next person to register in
 * the same tab inherits the previous graduate's answers — a data-integrity bug
 * before it is a privacy one.
 */
export function clearRegistrationDrafts(): void {
    try {
        sessionStorage.removeItem(PERSONAL_DRAFT_KEY);
        sessionStorage.removeItem(EMPLOYMENT_DRAFT_KEY);
    } catch {
        // Nothing to do; storage is unavailable, so there is no draft to clear.
    }
}
