/**
 * Job titles: pick from the admin's list, or type one under "My job isn't listed".
 *
 * The admin list (Settings > Industries & Jobs) is the source of truth, so
 * analytics group graduates by a clean title and industry. A graduate whose job
 * is missing may type it, but a typed title is checked for vulgar words and
 * nonsense here and again on the server, and stays unlinked so the admin can
 * review it and add it to the list.
 */

export type JobTitleOption = { name: string; industry?: string | null };

export type JobTitleCheck =
  | { kind: 'empty' }
  | { kind: 'known'; canonical: string }
  | { kind: 'typo'; suggestion: string }
  | { kind: 'custom' };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}/&+ ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance that also counts an adjacent swap as one edit ("artits" -> "artist" = 1). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** Short words get no slack: "Book" vs "Cook" is a different word, not a typo. */
function allowedEdits(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

/** Compare a typed title against the listed titles: exact, likely typo, or not on the list. */
export function checkJobTitle(value: string, listedTitles: string[]): JobTitleCheck {
  const input = normalize(value);
  if (!input) return { kind: 'empty' };

  const byNorm = new Map<string, string>();
  for (const title of listedTitles) {
    const key = normalize(title);
    if (key && !byNorm.has(key)) byNorm.set(key, title.trim());
  }
  const exact = byNorm.get(input);
  if (exact) return { kind: 'known', canonical: exact };

  // Whole-title near miss: "Graphic Desginer" -> "Graphic Designer".
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const [norm, title] of byNorm) {
    if (Math.abs(norm.length - input.length) > 2) continue;
    // "Teacher I" is a real plantilla position, not a typo of "Teacher".
    if (input.startsWith(`${norm} `) || norm.startsWith(`${input} `)) continue;
    const d = editDistance(input, norm);
    if (d < bestDistance) {
      bestDistance = d;
      best = title;
    }
  }
  if (best && bestDistance <= allowedEdits(input.length)) return { kind: 'typo', suggestion: best };
  return { kind: 'custom' };
}

const ACRONYMS = new Set(['it', 'hr', 'qa', 'ui', 'ux', 'ui/ux', 'seo', 'erp', 'sap', 'mis', 'ict', 'bpo', 'ceo', 'cto', 'cfo', 'crm', 'gis', 'lms', 'csr', 'ii', 'iii', 'iv']);
const SMALL_WORDS = new Set(['of', 'and', 'the', 'in', 'for', 'at', 'to', 'a', 'an', 'or']);

/** Collapse spaces and title-case text typed all-lowercase or ALL-CAPS; deliberate mixed case ("iOS Developer") is kept. */
export function tidyJobTitle(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const letters = collapsed.replace(/[^\p{L}]/gu, '');
  if (!letters || (letters !== letters.toLowerCase() && letters !== letters.toUpperCase())) return collapsed;
  return collapsed
    .split(' ')
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

// Mirrors backend/tracer/text_quality.py so a typed title is refused here with
// a clear message instead of only failing on the server.
const PROFANE_WORDS = new Set([
  'fuck', 'fucker', 'fucking', 'motherfucker', 'fvck', 'fck', 'fuk', 'phuck', 'shit', 'shyt', 'bullshit',
  'bitch', 'biatch', 'asshole', 'dick', 'dickhead', 'cunt', 'bastard', 'whore', 'slut', 'nigger', 'nigga',
  'faggot', 'fag', 'retard', 'porn', 'pussy', 'cock',
  'putangina', 'tangina', 'tanginamo', 'tangna', 'tngina', 'putang', 'puta', 'pota', 'gago', 'gaga', 'ulol',
  'tarantado', 'bobo', 'leche', 'pakyu', 'kupal', 'hindot', 'pokpok', 'burat', 'titi', 'puki', 'kantot',
  'jakol', 'bilat', 'inutil', 'tanga', 'punyeta', 'yawa', 'buang',
]);
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
const collapseRepeats = (s: string) => s.replace(/(.)\1+/g, '$1');
const COLLAPSED_PROFANE = new Set([...PROFANE_WORDS].map(collapseRepeats));
const SQUASHED_PROFANE = [...PROFANE_WORDS].filter((w) => w.length >= 6).map(collapseRepeats);

/** Why a typed job title or company cannot be saved, or null when it is fine. */
export function jobTextProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/\p{L}/u.test(text)) return 'has no letters';
  if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return 'is too short';
  const folded = collapseRepeats(
    text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c]),
  );
  const words = folded.match(/[a-z]+/g) ?? [];
  if (words.some((w) => PROFANE_WORDS.has(w) || COLLAPSED_PROFANE.has(w))) return 'contains a word that is not allowed';
  const squashed = words.join('');
  if (SQUASHED_PROFANE.some((term) => squashed.includes(term))) return 'contains a word that is not allowed';
  return null;
}

// Titles the graduate typed under "My job isn't listed". Module-level so a
// form's Next/Save validation sees a choice made inside the input component.
const markedUnlisted = new Set<string>();

export function markJobTitleUnlisted(value: string): void {
  if (value.trim()) markedUnlisted.add(normalize(value));
}

export function unmarkJobTitleUnlisted(value: string): void {
  markedUnlisted.delete(normalize(value));
}

export function isMarkedUnlisted(value: string): boolean {
  return markedUnlisted.has(normalize(value));
}

/** Message to show when a job title cannot be accepted yet, or null when it can. */
export function jobTitleProblem(value: string, listedTitles: string[]): string | null {
  const text = value.trim();
  if (!text) return null;
  if (checkJobTitle(text, listedTitles).kind === 'known') return null;
  if (isMarkedUnlisted(text)) {
    const problem = jobTextProblem(text);
    return problem ? `Your job title ${problem}. Please change it.` : null;
  }
  return 'Please choose your job title from the list, or tap "My job isn\'t listed" under it.';
}
