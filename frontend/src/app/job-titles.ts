/**
 * Job-title typo guard.
 *
 * Job titles stay free text: graduates work far outside the admin's reference
 * list (a freelance artist matches none of the IT titles). Free text let typos
 * such as "Artits" straight into analytics, so a title is checked against the
 * reference list plus common occupations. A near miss asks "Did you mean
 * Artist?" and the graduate either takes the fix or keeps what they typed.
 */

export const COMMON_JOB_TITLES: string[] = [
  // IT and information systems
  'Software Developer', 'Software Engineer', 'Web Developer', 'Front-End Developer', 'Back-End Developer',
  'Full-Stack Developer', 'Mobile App Developer', 'Game Developer', 'Computer Programmer', 'QA Tester',
  'Quality Assurance Analyst', 'Systems Analyst', 'Business Analyst', 'Business Systems Analyst', 'Data Analyst',
  'Data Scientist', 'Data Engineer', 'Database Administrator', 'Network Administrator', 'Network Engineer',
  'Systems Administrator', 'IT Support Specialist', 'Technical Support Specialist', 'Technical Support Representative',
  'Help Desk Technician', 'Cybersecurity Analyst', 'Cloud Engineer', 'DevOps Engineer', 'UI/UX Designer',
  'IT Specialist', 'IT Officer', 'IT Auditor', 'IT Consultant', 'IT Instructor', 'MIS Officer',
  'Information Systems Officer', 'ERP Consultant', 'SAP Consultant', 'Project Manager', 'IT Project Manager',
  'Product Manager', 'Scrum Master', 'Technical Writer', 'Computer Technician', 'Data Encoder',
  // Creative and freelance
  'Artist', 'Visual Artist', 'Digital Artist', 'Freelance Artist', 'Illustrator', 'Graphic Designer',
  'Multimedia Artist', 'Animator', 'Video Editor', 'Photographer', 'Videographer', 'Content Creator',
  'Social Media Manager', 'Virtual Assistant', 'Freelancer', 'Copywriter', 'Writer', 'Editor', 'Translator',
  'Transcriptionist', 'Musician', 'Makeup Artist', 'Tattoo Artist',
  // Business, office and services
  'Entrepreneur', 'Business Owner', 'Online Seller', 'Store Manager', 'Sales Associate', 'Sales Representative',
  'Marketing Assistant', 'Digital Marketing Specialist', 'SEO Specialist', 'Customer Service Representative',
  'Call Center Agent', 'Team Leader', 'Administrative Assistant', 'Administrative Aide', 'Office Staff', 'Clerk',
  'Secretary', 'Receptionist', 'Bookkeeper', 'Accounting Staff', 'HR Assistant', 'Recruiter', 'Cashier',
  'Bank Teller', 'Logistics Coordinator', 'Warehouse Staff', 'Delivery Rider', 'Driver', 'Barista', 'Service Crew',
  'Cook', 'Chef',
  // Education, public service and others
  'Teacher', 'Instructor', 'Professor', 'Tutor', 'Researcher', 'Research Assistant', 'Government Employee',
  'Police Officer', 'Soldier', 'Nurse', 'Caregiver', 'Electrician', 'Technician', 'Farmer',
];

export type JobTitleCheck =
  | { kind: 'empty' }
  | { kind: 'known'; canonical: string }
  | { kind: 'typo'; suggestion: string }
  | { kind: 'custom' };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}/&+ ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Reference titles first (the admin's spelling wins), then common ones, de-duplicated. */
export function mergeJobTitles(referenceTitles: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of [...referenceTitles, ...COMMON_JOB_TITLES]) {
    const key = normalize(title);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(title.trim());
    }
  }
  return out;
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

/** Short words get no slack: "Cook" vs "Book" is a different word, not a typo. */
function allowedEdits(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

export function checkJobTitle(value: string, referenceTitles: string[] = []): JobTitleCheck {
  const input = normalize(value);
  if (!input) return { kind: 'empty' };

  const titles = mergeJobTitles(referenceTitles);
  const byNorm = new Map(titles.map((t) => [normalize(t), t]));
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

  // Word-level: "Senior Web Develper" -> "Senior Web Developer".
  const vocabulary = new Map<string, string>();
  for (const title of titles) {
    for (const word of title.split(/\s+/)) {
      const key = normalize(word);
      if (key.length >= 4 && !vocabulary.has(key)) vocabulary.set(key, word);
    }
  }
  let changed = false;
  const corrected = value.trim().split(/\s+/).map((word) => {
    const key = normalize(word);
    if (key.length < 4 || vocabulary.has(key)) return word;
    let hit: string | null = null;
    let hitDistance = Infinity;
    for (const [vocabKey, vocabWord] of vocabulary) {
      if (Math.abs(vocabKey.length - key.length) > 2) continue;
      const d = editDistance(key, vocabKey);
      if (d < hitDistance) {
        hitDistance = d;
        hit = vocabWord;
      }
    }
    if (hit && hitDistance <= allowedEdits(key.length)) {
      changed = true;
      return hit;
    }
    return word;
  });
  if (changed) return { kind: 'typo', suggestion: corrected.join(' ') };

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

// Titles the graduate chose to keep despite a suggestion. Module-level so the
// form's step validation can see a choice made inside the input component.
const keptAsTyped = new Set<string>();

export function keepJobTitleAsTyped(value: string): void {
  keptAsTyped.add(normalize(value));
}

export function isKeptAsTyped(value: string): boolean {
  return keptAsTyped.has(normalize(value));
}

/** True while a likely typo has neither been fixed nor explicitly kept. */
export function jobTitleNeedsReview(value: string, referenceTitles: string[] = []): boolean {
  return checkJobTitle(value, referenceTitles).kind === 'typo' && !isKeptAsTyped(value);
}
