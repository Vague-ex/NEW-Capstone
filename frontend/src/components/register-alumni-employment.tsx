/**
 * Alumni Registration - Employment Information Component
 * Handles: Academic Profile, Employment Status, First Job, Current Job, Work Address, Competency
 * Steps: 1-6 (Employment Component)
 *
 * This component collects comprehensive employment history and skills assessment.
 * Conditional step skipping based on employment status (never employed, seeking, employed).
 * Final submission merges employment data with personal data for backend.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { EMPLOYMENT_DRAFT_KEY, saveDraft, loadDraft } from './registration-draft';
import { JobTitleInput } from './shared/job-title-input';
import { jobTitleProblem } from '../app/job-titles';
import { describeGpsFailure, geocoderCityName, locateDevice } from '../app/geolocation';
import HomeLocationMap from './home-location-map';
import {
  Briefcase, MapPin, Award, BookOpen, ChevronRight, ChevronLeft, ChevronDown,
  AlertCircle, CheckCircle2, Code, Users, Loader, X, LocateFixed,
} from 'lucide-react';
import {
  useReferenceData,
  provincesApi,
  citiesApi,
  locationApi,
  FALLBACK_BSIS_CORE_SKILLS,
  type SkillItem,
  type RegionItem,
  type ProvinceItem,
  type CityMunicipalityItem,
} from '../hooks/useReferenceData';

// Types
type EmploymentStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface EmploymentFormData {
  // Step 1: Academic & Pre-Employment Profile
  academic_honors: number | null;
  /** Paid work besides the required OJT, before graduating. */
  prior_work_experience: boolean;
  ojt_relevance: number | null;
  has_portfolio: boolean;

  // Step 2: Employment Status
  employment_status: string;
  /** Follow-up for Seeking / Not seeking: have they held any job since
   *  graduating? Decides whether First Job is asked. Not sent as an answer of
   *  its own; the First Job details (or their absence) carry it. */
  has_worked_since_graduation: boolean | null;

  // Step 3: First Job Details
  time_to_hire_months: number | null;
  time_to_hire_raw: string;
  first_job_sector: string;
  first_job_status: string;
  first_job_title: string;
  first_job_company: string;
  first_job_related_to_bsis: boolean | null;
  first_job_unrelated_reason: string;
  first_job_applications_count: number | null;
  first_job_applications_raw: string;
  first_job_source: string;
  first_job_source_display: string;

  // Step 4: Current Job
  current_job_sector: string;
  current_job_title: string;
  current_job_company: string;
  current_job_related_to_bsis: boolean | null;
  location_type: boolean | null;

  // Step 5: Work Address
  street_address: string;
  barangay: string;
  city_municipality: string;
  province_work: string;
  region: string;
  zip_code: string;
  country: string;
  latitude: number | null;
  longitude: number | null;

  // Step 6: Competency Assessment
  technical_skills: string[];
  soft_skills: string[];
  professional_certifications: string;
}

// Constants
const EMPLOYMENT_STEP_CONFIG = [
  { n: 1 as EmploymentStep, label: 'Academic Profile' },
  { n: 2 as EmploymentStep, label: 'Employment Status' },
  { n: 3 as EmploymentStep, label: 'First Job' },
  { n: 4 as EmploymentStep, label: 'Current Job' },
  { n: 5 as EmploymentStep, label: 'Work Address' },
  { n: 6 as EmploymentStep, label: 'Skills & Competency' },
];

// Offline fallback only; the soft picker normally lists the "Soft" category.
const SOFT_SKILLS = [
  'Oral Communication',
  'Written Communication',
  'Teamwork/Collaboration',
  'Problem-solving/Critical Thinking',
  'Adaptability/Flexibility',
  'Leadership',
  'Customer Service Orientation',
  'Attention to Detail',
  'Ability to Work Under Pressure',
  'Time Management',
];

type SkillGroup = { label: string; skills: string[] };

// Case- and spacing-insensitive, so "SQL" and "sql", or "Technical Support /
// Troubleshooting" and "Technical Support/Troubleshooting", appear once.
const skillKey = (name: string) => name.toLowerCase().replace(/\s+/g, '');

/**
 * The skills catalog grouped by category for one picker: the "Soft" category,
 * or every other category (the backend counts anything not "Soft" as
 * technical). CHED's BSIS core list comes first so its spelling wins over
 * duplicates; skills saved by past registrations ("Technical") go last as Other.
 */
function groupSkills(skills: SkillItem[], soft: boolean): SkillGroup[] {
  const softKeys = new Set(
    [...SOFT_SKILLS, ...skills.filter((s) => s.category_name === 'Soft').map((s) => s.name)].map(skillKey),
  );
  const labelOf = (category: string | null) =>
    !category || category === 'Technical'
      ? 'Other'
      // "Data & AI" and "Data and AI" were seeded separately; show one group.
      : category.replace(/ and /g, ' & ');
  const rank = (label: string) => (label === 'BSIS Core Competencies' ? 0 : label === 'Other' ? 2 : 1);

  const rows = skills
    .filter((s) => s.is_active && (s.category_name === 'Soft') === soft)
    .map((s) => ({ name: s.name, label: soft ? 'Soft Skills' : labelOf(s.category_name) }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label) || a.name.localeCompare(b.name));

  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const { name, label } of rows) {
    const key = skillKey(name);
    // Soft skills are offered only in the soft picker; My Skills drops them from technical.
    if (seen.has(key) || (!soft && softKeys.has(key))) continue;
    seen.add(key);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(name);
  }
  return Array.from(groups, ([label, names]) => ({ label, skills: names }));
}

const PHILIPPINE_REGIONS = [
  'NCR', 'Region I', 'Region II', 'Region III', 'Region IV-A', 'Region IV-B',
  'Region V', 'Region VI', 'Region VII', 'Region VIII', 'Region IX', 'Region X',
  'Region XI', 'Region XII', 'Region XIII', 'CAR', 'BARMM', 'Abroad',
];

// Mirrors EmploymentProfile.EmploymentStatusChoices in backend/tracer/models.py,
// plus 'never_employed' which the survey tracks separately from 'seeking'.
// Labels match the Employment Details page (alumni-employment.tsx) word for
// word. The options come from the CHED tracer and must not be removed or
// reworded in meaning, so the confusing ones get a hint instead.
const EMPLOYMENT_STATUS_OPTIONS = [
  { label: 'Yes, full-time', value: 'employed_full_time' },
  { label: 'Yes, part-time', value: 'employed_part_time' },
  { label: 'Yes, self-employed/freelance', value: 'self_employed' },
  { label: 'No, currently seeking employment', value: 'seeking' },
  { label: 'No, not seeking employment (further studies, personal reasons)', value: 'not_seeking' },
  { label: 'Never employed', value: 'never_employed' },
];

const EMPLOYMENT_STATUS_HINTS: Record<string, string> = {
  seeking: "You don't have a job right now and are looking for one. Choose this even if you worked before.",
  not_seeking: "You don't have a job right now and aren't looking for one, for example because of further studies, family or health. Choose this even if you worked before.",
  never_employed: 'You have not had any job at all since you graduated.',
};

const EMPLOYED_STATUSES = ['employed_full_time', 'employed_part_time', 'self_employed'];
const UNEMPLOYED_STATUSES = ['seeking', 'not_seeking'];

const INITIAL_EMPLOYMENT_FORM: EmploymentFormData = {
  academic_honors: null,
  prior_work_experience: false,
  ojt_relevance: null,
  has_portfolio: false,
  employment_status: '',
  has_worked_since_graduation: null,
  time_to_hire_months: null,
  time_to_hire_raw: '',
  first_job_sector: '',
  first_job_status: '',
  first_job_title: '',
  first_job_company: '',
  first_job_related_to_bsis: null,
  first_job_unrelated_reason: '',
  first_job_applications_count: null,
  first_job_applications_raw: '',
  first_job_source: '',
  first_job_source_display: '',
  current_job_sector: '',
  current_job_title: '',
  current_job_company: '',
  current_job_related_to_bsis: null,
  location_type: null,
  street_address: '',
  barangay: '',
  city_municipality: '',
  province_work: '',
  region: '',
  zip_code: '',
  country: 'Philippines',
  latitude: null,
  longitude: null,
  technical_skills: [],
  soft_skills: [],
  professional_certifications: '',
};

const FIELD_CLS = 'w-full px-3 py-2 border rounded-lg text-gray-900';

/** Input classes, red when the graduate tried to continue past it empty. */
function fieldCls(invalid: boolean, extra = '') {
  return `${FIELD_CLS} ${invalid ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-gray-300'} ${extra}`.trim();
}

function Required() {
  return <span className="text-red-500"> *</span>;
}

// Reusable Components (imported from context or duplicated here)
function SectionHeader({ icon: Icon, title, subtitle }: any) {
  return (
    <div className="mb-4 sm:mb-6">
      <div className="flex items-center gap-2.5 sm:gap-3 mb-1.5 sm:mb-2">
        <div className="flex size-7 sm:size-8 items-center justify-center rounded-lg bg-emerald-100 shrink-0">
          <Icon className="size-4 text-emerald-600" />
        </div>
        <h2 className="text-gray-900 text-base sm:text-lg leading-tight" style={{ fontWeight: 700 }}>{title}</h2>
      </div>
      {subtitle && <p className="text-gray-500 text-xs sm:text-sm">{subtitle}</p>}
    </div>
  );
}

function RadioOption<T>({ label, value, current, onSelect }: {
  label: string;
  value: T;
  current: T | null | undefined;
  onSelect: (v: T) => void;
}) {
  const isSelected = current === value;
  return (
    <button type="button" onClick={() => onSelect(value)}
      className={`px-4 py-2.5 rounded-lg border-2 transition text-sm ${
        isSelected ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
      }`} style={{ fontWeight: isSelected ? 600 : 500 }}>
      {label}
    </button>
  );
}

// Checkbox dropdown: a searchable checklist grouped by category that stays
// open while several skills are ticked. It expands in place rather than
// floating, so no scrolling container on a phone can clip it. Chosen skills
// also show as removable chips underneath.
function SkillPicker({ groups, selected, onChange, placeholder }: {
  groups: SkillGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on a click outside or Escape, like a native dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = groups
    .map((g) => ({ ...g, skills: g.skills.filter((s) => s.toLowerCase().includes(q)) }))
    .filter((g) => g.skills.length > 0);
  const toggle = (skill: string) =>
    onChange(selected.includes(skill) ? selected.filter((s) => s !== skill) : [...selected, skill]);

  return (
    <div className="space-y-2">
      <div ref={boxRef}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white text-left text-gray-500">
          {placeholder}
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills" aria-label="Search skills"
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-900" />
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {visible.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-gray-500">{`No skills match "${query}".`}</p>
              )}
              {visible.map((g) => (
                <div key={g.label} role="group" aria-label={g.label}>
                  {groups.length > 1 && (
                    <p className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-gray-500" style={{ fontWeight: 600 }}>
                      {g.label}
                    </p>
                  )}
                  {g.skills.map((skill) => (
                    <label key={skill} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-800 hover:bg-emerald-50 cursor-pointer">
                      <input type="checkbox" checked={selected.includes(skill)} onChange={() => toggle(skill)}
                        className="size-4 shrink-0 accent-[#166534]" />
                      {skill}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((skill) => (
            <span key={skill}
              className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
              {skill}
              <button type="button" aria-label={`Remove ${skill}`}
                onClick={() => onChange(selected.filter((s) => s !== skill))}
                className="text-emerald-500 hover:text-emerald-800">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled = false, isSubmit = false }: any) {
  return (
    <div className="flex gap-3 mt-6">
      <button onClick={onBack}
        className="flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
        style={{ fontWeight: 600 }}>
        <ChevronLeft className="size-4" /> Back
      </button>
      <button onClick={onNext} disabled={nextDisabled}
        className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-white transition text-sm ${
          nextDisabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#166534] hover:bg-[#14532d]'
        }`}
        style={{ fontWeight: 600 }}>
        {nextLabel} {!isSubmit && <ChevronRight className="size-4" />}
      </button>
    </div>
  );
}

// Encoding Mappers
const timeToHireMapper = (selection: string | null): number | null => ({
  'Within 1 month': 1,
  '1-3 months': 3,
  '3-6 months': 4.5,
  '6 months to 1 year': 9,
  '1-2 years': 18,
  'More than 2 years': 30,
}[selection ?? ''] ?? null);

const jobApplicationsMapper = (selection: string | null): number | null => ({
  '1-5 applications': 1,
  '6-15 applications': 2,
  '16-30 applications': 3,
  '31+ applications': 4,
}[selection ?? ''] ?? null);

const jobSourceMapper = (selection: string | null): string => ({
  'Personal Network/Referral': 'personal_network',
  'Online Job Portal': 'online_portal',
  'CHMSU Career Fair': 'career_fair',
  'Company Walk-in/Direct Hire': 'walk_in',
  'Social Media': 'social_media',
  'Started own business': 'entrepreneurship',
  'Other': 'other',
}[selection ?? ''] ?? 'other');

const sectorMapper = (selection: string | null): string => ({
  'Government': 'government',
  'Private Sector': 'private',
  'Entrepreneurial/Freelance/Self-Employed': 'entrepreneurial',
}[selection ?? ''] ?? 'private');

// Main Component
export interface RegisterAlumniEmploymentProps {
  onComplete: (employmentData: EmploymentFormData) => Promise<void>;
  onBack: () => void;
  /** Seeded when the graduate is sent back to fix a rejected answer, so the
   *  whole survey does not have to be retyped. */
  initialForm?: EmploymentFormData | null;
  /** Server-reported problems, keyed by field name. */
  fieldErrors?: Record<string, string> | null;
}

export default function RegisterAlumniEmployment({
  onComplete,
  onBack,
  initialForm,
  fieldErrors,
}: RegisterAlumniEmploymentProps) {
  const { data: referenceData } = useReferenceData();
  const refJobTitleOptions = useMemo(
    () => (referenceData?.job_titles ?? [])
      .filter((jt) => jt.is_active !== false)
      .map((jt) => ({ name: jt.name, industry: jt.industry_name })),
    [referenceData],
  );
  const refJobTitles = useMemo(() => refJobTitleOptions.map((o) => o.name), [refJobTitleOptions]);
  const [step, setStep] = useState<EmploymentStep>(1);
  const [form, setForm] = useState<EmploymentFormData>(initialForm ?? INITIAL_EMPLOYMENT_FORM);
  const [stepError, setStepError] = useState('');
  // Set when Continue is pressed with required answers missing; outlines those
  // inputs in red until the step changes.
  const [showMissing, setShowMissing] = useState(false);
  const missing = (empty: boolean) => showMissing && empty;
  const [isSubmitting, setIsSubmitting] = useState(false);
  // "Is your current job the same as your first job?" - copies the first-job
  // answers into the current-job fields so the graduate doesn't retype them.
  const [sameAsFirstJob, setSameAsFirstJob] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const applySameAsFirstJob = (checked: boolean) => {
    setSameAsFirstJob(checked);
    if (checked) {
      setForm((f) => ({
        ...f,
        // Sector option values are identical between first/current job selects.
        current_job_sector: f.first_job_sector,
        current_job_title: f.first_job_title,
        current_job_company: f.first_job_company,
        current_job_related_to_bsis: f.first_job_related_to_bsis,
      }));
    }
  };

  // Smooth-scroll the error banner into view whenever a new error fires.
  useEffect(() => {
    if (stepError && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [stepError]);

  // Restore form from sessionStorage on mount.
  // loadDraft merges over the defaults rather than replacing the object, so a
  // draft written before a field was added restores with that field at its
  // default instead of undefined.
  useEffect(() => {
    setForm((prev) => loadDraft(EMPLOYMENT_DRAFT_KEY, prev));
  }, []);

  // Persist form to sessionStorage
  useEffect(() => {
    saveDraft(EMPLOYMENT_DRAFT_KEY, form as unknown as Record<string, unknown>);
  }, [form]);

  // Get available regions (from Supabase or fallback)
  const regions = referenceData?.regions?.map((r: any) => r.name) || PHILIPPINE_REGIONS;

  // Cascading location dropdowns now sourced live from the reference DB
  // (Region → Province → CityMunicipality). The legacy /ph-locations.json
  // fallback is dropped - admin reference-data CRUD is the source of truth.
  //
  // Step 4's yes/no ("Philippines" vs "Abroad") wins when set; otherwise fall
  // back to the country value. That prevents step 5 from showing the PSGC
  // cascade for a graduate who already said their work is abroad but hasn't
  // picked a foreign country yet (country would still be empty at that point).
  const isPhilippinesWork = form.location_type === true
    ? true
    : form.location_type === false
      ? false
      : (!form.country || form.country === 'Philippines');
  const apiRegions: RegionItem[] = referenceData?.regions ?? [];
  const [apiProvinces, setApiProvinces] = useState<ProvinceItem[]>([]);
  const [apiCities, setApiCities] = useState<CityMunicipalityItem[]>([]);

  // When the user picks a region by name, load that region's provinces.
  useEffect(() => {
    if (!isPhilippinesWork || !form.region) {
      setApiProvinces([]);
      return;
    }
    const region = apiRegions.find((r) => r.name === form.region);
    if (!region) {
      setApiProvinces([]);
      return;
    }
    let active = true;
    void provincesApi
      .list(region.id)
      .then(({ provinces }) => { if (active) setApiProvinces(provinces); })
      .catch(() => { if (active) setApiProvinces([]); });
    return () => { active = false; };
  }, [form.region, apiRegions, isPhilippinesWork]);

  // Cities load once region+province is picked. NCR and similar regions have
  // no provinces in PSGC, so cities are filtered by region only in that case.
  useEffect(() => {
    if (!isPhilippinesWork || !form.region) {
      setApiCities([]);
      return;
    }
    const region = apiRegions.find((r) => r.name === form.region);
    if (!region) {
      setApiCities([]);
      return;
    }
    let active = true;
    if (form.province_work) {
      const province = apiProvinces.find((p) => p.name === form.province_work);
      if (!province) {
        setApiCities([]);
        return;
      }
      void citiesApi
        .list({ provinceId: province.id })
        .then(({ cities }) => { if (active) setApiCities(cities); })
        .catch(() => { if (active) setApiCities([]); });
    } else if (apiProvinces.length === 0) {
      // Region has no provinces (NCR-style) → cities listed directly under region.
      void citiesApi
        .list({ regionId: region.id })
        .then(({ cities }) => { if (active) setApiCities(cities); })
        .catch(() => { if (active) setApiCities([]); });
    } else {
      setApiCities([]);
    }
    return () => { active = false; };
  }, [form.region, form.province_work, apiRegions, apiProvinces, isPhilippinesWork]);

  const phRegionsWork = apiRegions;
  const phProvincesWork = apiProvinces;
  const phCitiesWork = apiCities;

  // ── Workplace pin ─────────────────────────────────────────────────────────
  // GPS only describes the workplace when the graduate is standing in it, so
  // "Use my current location" is offered only after they say they are at work
  // right now. Otherwise the pin starts at the chosen city and they drag it.
  const [atWorkplace, setAtWorkplace] = useState<boolean | null>(null);
  const [locatingWork, setLocatingWork] = useState(false);
  const [workNote, setWorkNote] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [workPinExact, setWorkPinExact] = useState(false);
  // City the current pin was placed in by GPS or by hand. A city-level pin is
  // only re-placed when the city changes away from it.
  const exactPinCityRef = useRef<string | null>(null);
  const lastWorkCityRef = useRef<string | null>(null);

  const fillWorkAddressFromPoint = async (lat: number, lng: number, via: 'gps' | 'pin') => {
    const subject = via === 'gps' ? 'your location' : 'the pin';
    try {
      const found = await locationApi.lookup(lat, lng);
      if (found.abroad) {
        if (isPhilippinesWork) {
          setWorkNote({ tone: 'warn', text: 'That point is outside the Philippines. If you work abroad, go back and choose Abroad under Work Location.' });
          return;
        }
        exactPinCityRef.current = found.locality || null;
        setForm((f) => ({ ...f, city_municipality: found.locality || f.city_municipality }));
        setWorkNote({ tone: 'ok', text: `Pinned in ${found.country || 'another country'}. Please check your city and country below.` });
        return;
      }
      if (!isPhilippinesWork) {
        setWorkNote({ tone: 'warn', text: 'That point is in the Philippines. If you work here, go back and choose Philippines under Work Location.' });
        return;
      }
      if (!found.region && !found.city) {
        setWorkNote({ tone: 'warn', text: "We pinned your workplace but couldn't match an address. Please choose it below." });
        return;
      }
      exactPinCityRef.current = found.city?.name ?? null;
      // The cascading selects load their options from these names.
      setForm((f) => ({
        ...f,
        region: found.region?.name ?? f.region,
        province_work: found.province?.name ?? '',
        city_municipality: found.city?.name ?? '',
        barangay: '',
      }));
      setWorkNote(found.city
        ? { tone: 'ok', text: `Work address filled in from ${subject}. Please check it and adjust anything that is off.` }
        : { tone: 'warn', text: 'We filled in what we could. Please choose your city below.' });
    } catch (err) {
      setWorkNote({
        tone: 'warn',
        text: err instanceof Error && err.message ? err.message : "We pinned your workplace but couldn't look up the address. Please fill it in below.",
      });
    }
  };

  const fillWorkFromMyLocation = async () => {
    setWorkNote(null);
    setLocatingWork(true);
    try {
      const { fix, failure } = await locateDevice();
      if (!fix) {
        setWorkNote({ tone: 'error', text: describeGpsFailure(failure) });
        return;
      }
      setForm((f) => ({ ...f, latitude: fix.lat, longitude: fix.lng }));
      setWorkPinExact(true);
      await fillWorkAddressFromPoint(fix.lat, fix.lng, 'gps');
    } finally {
      setLocatingWork(false);
    }
  };

  const moveWorkPin = (lat: number, lng: number) => {
    setForm((f) => ({ ...f, latitude: lat, longitude: lng }));
    setWorkPinExact(true);
    void fillWorkAddressFromPoint(lat, lng, 'pin');
  };

  const removeWorkPin = () => {
    setForm((f) => ({ ...f, latitude: null, longitude: null }));
    setWorkPinExact(false);
    // Treat the removal as a decision for this city, so the city pin is not
    // put straight back. Choosing another city pins that one.
    exactPinCityRef.current = form.city_municipality.trim() || null;
    setWorkNote(null);
  };

  // Start the pin at the chosen city so the graduate only has to drag it.
  // A pin restored from the draft is kept; a new city re-places a city-level pin.
  useEffect(() => {
    const city = form.city_municipality.trim();
    if (step !== 5 || !city) return;
    const previous = lastWorkCityRef.current;
    lastWorkCityRef.current = city;
    if (exactPinCityRef.current === city) return;
    const cityChanged = previous !== null && previous !== city;
    if (form.latitude != null && !cityChanged) return;

    const parts = isPhilippinesWork
      ? [geocoderCityName(city), form.province_work, 'Philippines']
      : [city, form.country];
    const query = parts.filter(Boolean).join(', ');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        { signal: controller.signal, headers: { 'Accept-Language': 'en' } },
      )
        .then((r) => r.json())
        .then((results: Array<{ lat: string; lon: string }>) => {
          if (!Array.isArray(results) || results.length === 0) return;
          const lat = Number(results[0].lat);
          const lng = Number(results[0].lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          exactPinCityRef.current = null;
          setWorkPinExact(false);
          setForm((f) => ({ ...f, latitude: lat, longitude: lng }));
        })
        .catch(() => { /* aborted or offline: the pin is optional */ });
    }, 500); // debounce fast cascade changes; Nominatim allows 1 request per second
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, form.city_municipality, form.province_work, form.country, isPhilippinesWork]);

  // The whole skills catalog from the reference API. This used to read
  // `category.name`, but the API sends `category` as an id (the label is
  // `category_name`), so the form always fell back to a short fixed list.
  const apiSkills = referenceData?.skills ?? [];
  const technicalGroups = apiSkills.length > 0
    ? groupSkills(apiSkills, false)
    : groupSkills(FALLBACK_BSIS_CORE_SKILLS, false);
  const softFromApi = groupSkills(apiSkills, true);
  const softGroups = softFromApi.length > 0 ? softFromApi : [{ label: 'Soft Skills', skills: SOFT_SKILLS }];

  // Validation logic
  const validateStep = (): boolean => {
    setStepError('');
    setShowMissing(false);
    const fail = (message: string) => {
      setStepError(message);
      setShowMissing(true);
      return false;
    };

    switch (step) {
      case 1: // Academic Profile
        if (form.academic_honors === null || form.academic_honors === undefined) {
          return fail('Please select your academic honors (choose "None" if not applicable).');
        }
        break;
      case 2: // Employment Status
        if (!form.employment_status) {
          return fail('Please select your employment status.');
        }
        if (UNEMPLOYED_STATUSES.includes(form.employment_status) && form.has_worked_since_graduation === null) {
          return fail('Please tell us whether you have had a job since graduating.');
        }
        break;
      case 3: // First Job Details
        // Check everything at once so every missing box turns red together.
        if (
          !form.time_to_hire_raw || !form.first_job_sector || !form.first_job_status
          || !form.first_job_title || !form.first_job_company.trim()
          || !form.first_job_applications_raw || !form.first_job_source_display
        ) {
          return fail('Please answer the questions marked with a red asterisk.');
        }
        {
          const titleProblem = jobTitleProblem(form.first_job_title, refJobTitles);
          if (titleProblem) {
            setStepError(titleProblem);
            return false;
          }
        }
        break;
      case 4: { // Current Job (company required; a given title must be listed or marked "not listed")
        if (!form.current_job_company.trim()) {
          return fail('Please answer the questions marked with a red asterisk.');
        }
        const titleProblem = jobTitleProblem(form.current_job_title, refJobTitles);
        if (titleProblem) {
          setStepError(titleProblem);
          return false;
        }
        break;
      }
      case 5: // Work Address
        if (!form.city_municipality || (isPhilippinesWork && !form.region) || (!isPhilippinesWork && !form.country)) {
          return fail('Please answer the questions marked with a red asterisk.');
        }
        {
          const expectedZipLen = isPhilippinesWork ? 4 : 5;
          if (form.zip_code && form.zip_code.length !== expectedZipLen) {
            setStepError(`ZIP code must be exactly ${expectedZipLen} digits`);
            return false;
          }
        }
        break;
      case 6: // Competency (all optional)
        break;
    }

    return true;
  };

  // Navigation logic with conditional skipping.
  // Work Address (step 5) only applies to currently-employed graduates — it
  // captures where they work, which feeds the geomap. Everyone who isn't
  // currently employed skips First Job/Current Job/Work Address as appropriate
  // and goes straight to Skills (step 6), so they are never forced to enter a
  // workplace they don't have.
  //
  // Seeking / Not seeking graduates are asked whether they have worked since
  // graduating: those who have fill in First Job, those who haven't skip it.
  // Either way they are not currently employed, so Current Job and Work
  // Address are skipped rather than saved empty.
  const isEmployedNow = EMPLOYED_STATUSES.includes(form.employment_status);
  const asksFirstJob = isEmployedNow
    || (UNEMPLOYED_STATUSES.includes(form.employment_status) && form.has_worked_since_graduation === true);

  const goToStep = (next: EmploymentStep) => {
    setShowMissing(false);
    setStepError('');
    setStep(next);
  };

  const nextStep = () => {
    if (!validateStep()) return;

    if (step === 2 && !asksFirstJob) {
      goToStep(6);
      return;
    }
    if (step === 3 && !isEmployedNow) {
      goToStep(6);
      return;
    }
    if (step < 6) {
      goToStep((step + 1) as EmploymentStep);
    }
  };

  const prevStep = () => {
    // Mirror the forward skips when navigating back from Skills (step 6).
    if (step === 6 && !isEmployedNow) {
      goToStep(asksFirstJob ? 3 : 2);
      return;
    }
    if (step > 1) {
      goToStep((step - 1) as EmploymentStep);
    } else {
      onBack();
    }
  };

  // Submit handler with encoding transformations
  const handleSubmit = async () => {
    if (!validateStep()) return;

    setIsSubmitting(true);
    try {
      // Apply encoding transformations
      // Answers left behind on steps the graduate ended up skipping (e.g.
      // they filled First Job, then went back and chose "Never employed") must
      // not be saved as if they applied.
      const kept: EmploymentFormData = { ...form };
      if (!asksFirstJob) {
        Object.assign(kept, {
          time_to_hire_raw: '', first_job_sector: '', first_job_status: '', first_job_title: '',
          first_job_company: '', first_job_related_to_bsis: null, first_job_unrelated_reason: '',
          first_job_applications_raw: '', first_job_source_display: '',
        });
      }
      if (!isEmployedNow) {
        Object.assign(kept, {
          current_job_sector: '', current_job_title: '', current_job_company: '',
          current_job_related_to_bsis: null, location_type: null,
          street_address: '', barangay: '', city_municipality: '', province_work: '', region: '',
          zip_code: '', latitude: null, longitude: null,
        });
      }
      if (!UNEMPLOYED_STATUSES.includes(kept.employment_status)) {
        kept.has_worked_since_graduation = null;
      }
      if (isEmployedNow && isPhilippinesWork) {
        kept.country = 'Philippines';
      }
      const encoded: EmploymentFormData = {
        ...kept,
        time_to_hire_months: timeToHireMapper(kept.time_to_hire_raw),
        first_job_applications_count: jobApplicationsMapper(kept.first_job_applications_raw),
        first_job_source: kept.first_job_source_display ? jobSourceMapper(kept.first_job_source_display) : '',
        first_job_sector: kept.first_job_sector ? sectorMapper(kept.first_job_sector) : '',
        current_job_sector: kept.current_job_sector ? sectorMapper(kept.current_job_sector) : '',
      };

      await onComplete(encoded);
    } catch (error: any) {
      setStepError(error.message || 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Determine which step to render based on conditional skipping
  const isCurrentState = (stepNum: EmploymentStep): boolean => {
    return step === stepNum;
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-3 py-4 sm:p-6">
      {/* Progress Bar */}
      <div className="mb-5 sm:mb-8">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Step {step} of 6</span>
          <span>{(step / 6 * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all"
            style={{ width: `${(step / 6) * 100}%` }}
          />
        </div>
      </div>

      {/* Server-rejected answers. Shown on a correction pass so the graduate
          can see exactly which fields to fix — everything else they entered is
          still here. */}
      {fieldErrors && Object.keys(fieldErrors).length > 0 && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 rounded-lg flex gap-3">
          <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
          <div className="text-sm">
            <p className="text-red-800" style={{ fontWeight: 700 }}>
              Please correct {Object.keys(fieldErrors).length === 1 ? 'this answer' : 'these answers'}
            </p>
            <ul className="mt-1 list-disc list-inside text-red-700 space-y-0.5">
              {Object.entries(fieldErrors).map(([field, message]) => (
                <li key={field}>{message}</li>
              ))}
            </ul>
            <p className="text-red-600/80 text-xs mt-1.5">
              Your other answers have been kept.
            </p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {stepError && (
        <div ref={errorRef} className="mb-6 p-4 border border-red-200 bg-red-50 rounded-lg flex gap-3 scroll-mt-24">
          <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
          <p className="text-red-700 text-sm">{stepError}</p>
        </div>
      )}

      {/* Step 1: Academic & Pre-Employment Profile */}
      {isCurrentState(1) && (
        <div className="gt-stagger space-y-6">
          <SectionHeader icon={BookOpen} title="Academic & Pre-Employment Profile" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Academic Honors <span className="text-red-500">*</span>
            </label>
            <select
              value={form.academic_honors ?? ''}
              onChange={(e) => setForm({ ...form, academic_honors: e.target.value ? parseInt(e.target.value) : null })}
              className={fieldCls(missing(form.academic_honors === null || form.academic_honors === undefined))}
            >
              <option value="">Select Academic Honors</option>
              <option value="4">Summa Cum Laude</option>
              <option value="3">Magna Cum Laude</option>
              <option value="2">Cum Laude</option>
              <option value="1">None</option>
            </select>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Required. Pick &quot;None&quot; if you did not graduate with honors.
            </p>
          </div>

          {/* Worded to exclude the OJT: every BSIS graduate completes one, and
              the old "Prior Work Experience" label read as asking about it. */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">
              Besides your required OJT, did you have any paid work before graduating?
              <span className="block text-xs font-normal text-gray-500 mt-0.5">Part-time jobs, freelance work, or an extra internship.</span>
            </label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.prior_work_experience} onSelect={(v) => setForm({ ...form, prior_work_experience: v })} />
              <RadioOption label="No" value={false} current={form.prior_work_experience} onSelect={(v) => setForm({ ...form, prior_work_experience: v })} />
            </div>
          </div>

          {/* Asked of everyone: it used to appear only after a Yes above. */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Was your required OJT/Internship related to the job you eventually got?
            </label>
            <select
              value={form.ojt_relevance ?? ''}
              onChange={(e) => setForm({ ...form, ojt_relevance: e.target.value ? parseInt(e.target.value) : null })}
              className={fieldCls(false)}
            >
              <option value="">Select relevance</option>
              <option value="3">Yes, directly related</option>
              <option value="2">Somewhat related</option>
              <option value="1">Not related</option>
              <option value="0">Have not secured a job yet / Not applicable</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">
              Online portfolio, GitHub profile, or project showcase when applying?
            </label>
            <div className="flex gap-3">
              <RadioOption
                label="Yes"
                value={true}
                current={form.has_portfolio}
                onSelect={(v) => setForm({ ...form, has_portfolio: v })}
              />
              <RadioOption
                label="No"
                value={false}
                current={form.has_portfolio}
                onSelect={(v) => setForm({ ...form, has_portfolio: v })}
              />
            </div>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 2: Employment Status */}
      {isCurrentState(2) && (
        <div className="gt-stagger space-y-6">
          <SectionHeader icon={Briefcase} title="Current Employment Status" subtitle="This determines which information we'll ask for next" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Are you presently employed?<Required />
            </label>
            <select
              value={form.employment_status}
              onChange={(e) => setForm({
                ...form,
                employment_status: e.target.value,
                // Only meaningful for Seeking / Not seeking; re-ask on a change.
                has_worked_since_graduation: UNEMPLOYED_STATUSES.includes(e.target.value)
                  ? form.has_worked_since_graduation
                  : null,
              })}
              className={fieldCls(missing(!form.employment_status))}
            >
              <option value="">Select Employment Status</option>
              {EMPLOYMENT_STATUS_OPTIONS.map(({ label, value }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {EMPLOYMENT_STATUS_HINTS[form.employment_status] && (
              <p className="mt-1.5 text-xs text-gray-500">{EMPLOYMENT_STATUS_HINTS[form.employment_status]}</p>
            )}
          </div>

          {UNEMPLOYED_STATUSES.includes(form.employment_status) && (
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                Have you had a job at any point since graduating?<Required />
              </label>
              <p className="text-xs text-gray-500 mb-3">
                If yes, we&apos;ll ask about your first job next.
              </p>
              <div className={`flex flex-wrap gap-3 rounded-lg ${missing(form.has_worked_since_graduation === null) ? 'ring-2 ring-red-500 ring-offset-2' : ''}`}>
                <RadioOption label="Yes, I have worked before" value={true} current={form.has_worked_since_graduation} onSelect={(v) => setForm({ ...form, has_worked_since_graduation: v })} />
                <RadioOption label="No, not yet" value={false} current={form.has_worked_since_graduation} onSelect={(v) => setForm({ ...form, has_worked_since_graduation: v })} />
              </div>
            </div>
          )}

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 3: First Job Details */}
      {isCurrentState(3) && (
        <div className="gt-stagger space-y-6">
          <SectionHeader icon={Briefcase} title="Your First Job" />

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Time to Hire (from graduation to employment)<Required />
            </label>
            <select
              value={form.time_to_hire_raw}
              onChange={(e) => setForm({ ...form, time_to_hire_raw: e.target.value })}
              className={fieldCls(missing(!form.time_to_hire_raw))}
            >
              <option value="">Select Time Frame</option>
              <option value="Within 1 month">Within 1 month</option>
              <option value="1-3 months">1-3 months</option>
              <option value="3-6 months">3-6 months</option>
              <option value="6 months to 1 year">6 months to 1 year</option>
              <option value="1-2 years">1-2 years</option>
              <option value="More than 2 years">More than 2 years</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Employment Sector<Required /></label>
              <select
                value={form.first_job_sector}
                onChange={(e) => setForm({ ...form, first_job_sector: e.target.value })}
                className={fieldCls(missing(!form.first_job_sector))}
              >
                <option value="">Select Sector</option>
                <option value="Government">Government</option>
                <option value="Private Sector">Private Sector</option>
                <option value="Entrepreneurial/Freelance/Self-Employed">Entrepreneurial/Freelance</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Employment Status<Required /></label>
              <select
                value={form.first_job_status}
                onChange={(e) => setForm({ ...form, first_job_status: e.target.value })}
                className={fieldCls(missing(!form.first_job_status))}
              >
                <option value="">Select Status</option>
                <option value="regular">Regular / Permanent</option>
                <option value="probationary">Probationary</option>
                <option value="contractual">Contractual / Casual</option>
                <option value="self_employed">Self-Employed / Freelance</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Job Title<Required /></label>
            <JobTitleInput
              value={form.first_job_title}
              onChange={(v) => setForm((f) => ({ ...f, first_job_title: v }))}
              options={refJobTitleOptions}
              placeholder="e.g., Junior Software Developer"
              className={fieldCls(missing(!form.first_job_title))}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Company / Organization Name<Required /></label>
            <input
              type="text"
              value={form.first_job_company}
              onChange={(e) => setForm({ ...form, first_job_company: e.target.value })}
              placeholder="e.g., Tech Company Inc."
              className={fieldCls(missing(!form.first_job_company.trim()))}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Is this job related to your BSIS degree?</label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.first_job_related_to_bsis} onSelect={(v) => setForm({ ...form, first_job_related_to_bsis: v })} />
              <RadioOption label="No" value={false} current={form.first_job_related_to_bsis} onSelect={(v) => setForm({ ...form, first_job_related_to_bsis: v, first_job_unrelated_reason: '' })} />
            </div>
          </div>

          {form.first_job_related_to_bsis === false && (
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Why not?</label>
              <select
                value={form.first_job_unrelated_reason}
                onChange={(e) => setForm({ ...form, first_job_unrelated_reason: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              >
                <option value="">Select reason</option>
                <option value="better_opportunity">Better opportunity</option>
                <option value="higher_pay">Higher pay</option>
                <option value="family_reasons">Family reasons</option>
                <option value="location">Location</option>
                <option value="career_change">Career change</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Number of applications before getting hired<Required /></label>
            <select
              value={form.first_job_applications_raw}
              onChange={(e) => setForm({ ...form, first_job_applications_raw: e.target.value })}
              className={fieldCls(missing(!form.first_job_applications_raw))}
            >
              <option value="">Select range</option>
              <option value="1-5 applications">1-5 applications</option>
              <option value="6-15 applications">6-15 applications</option>
              <option value="16-30 applications">16-30 applications</option>
              <option value="31+ applications">31+ applications</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Where did you find this job?<Required /></label>
            <select
              value={form.first_job_source_display}
              onChange={(e) => setForm({ ...form, first_job_source_display: e.target.value })}
              className={fieldCls(missing(!form.first_job_source_display))}
            >
              <option value="">Select source</option>
              <option value="Personal Network/Referral">Personal Network / Referral</option>
              <option value="Online Job Portal">Online Job Portal</option>
              <option value="CHMSU Career Fair">CHMSU Career Fair</option>
              <option value="Company Walk-in/Direct Hire">Company Walk-in / Direct Hire</option>
              <option value="Social Media">Social Media</option>
              <option value="Started own business">Started own business</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 4: Current Job (Only if employed full-time, part-time, or self-employed) */}
      {isCurrentState(4) && ['employed_full_time', 'employed_part_time', 'self_employed'].includes(form.employment_status) && (
        <div className="gt-stagger space-y-6">
          <SectionHeader icon={Briefcase} title="Your Current / Most Recent Job" />

          {/* Quick-fill: reuse the first-job answers when it's the same job. */}
          {(form.first_job_title || form.first_job_sector || form.first_job_company) && (
            <label className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sameAsFirstJob}
                onChange={(e) => applySameAsFirstJob(e.target.checked)}
                className="size-4 rounded border-gray-300"
              />
              <span className="text-sm text-emerald-800">
                My current job is the same as my first job (copy those details)
              </span>
            </label>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Employment Sector</label>
            <select
              value={form.current_job_sector}
              onChange={(e) => setForm({ ...form, current_job_sector: e.target.value, })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              <option value="">Select Sector (optional)</option>
              <option value="Government">Government</option>
              <option value="Private Sector">Private Sector</option>
              <option value="Entrepreneurial/Freelance/Self-Employed">Entrepreneurial/Freelance</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Current Job Title</label>
            <JobTitleInput
              value={form.current_job_title}
              onChange={(v) => setForm((f) => ({ ...f, current_job_title: v }))}
              options={refJobTitleOptions}
              placeholder="e.g., Senior Software Developer"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Company / Organization Name<Required /></label>
            <input
              type="text"
              value={form.current_job_company}
              onChange={(e) => setForm({ ...form, current_job_company: e.target.value })}
              placeholder="e.g., Tech Company Inc."
              className={fieldCls(missing(!form.current_job_company.trim()))}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Is this job related to your BSIS degree?</label>
            <div className="flex gap-3">
              <RadioOption label="Yes" value={true} current={form.current_job_related_to_bsis} onSelect={(v) => setForm({ ...form, current_job_related_to_bsis: v })} />
              <RadioOption label="No" value={false} current={form.current_job_related_to_bsis} onSelect={(v) => setForm({ ...form, current_job_related_to_bsis: v })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-3">Work Location</label>
            <div className="flex gap-3">
              <RadioOption
                label="Philippines"
                value={true}
                current={form.location_type}
                onSelect={(v) => setForm({
                  ...form,
                  location_type: v,
                  // Locking country to Philippines here makes the Work Address
                  // step render the PSGC cascading dropdowns. Without this,
                  // switching from Abroad would leave `country` on the last
                  // foreign value and step 5 would still show free-text inputs.
                  country: 'Philippines',
                })}
              />
              <RadioOption
                label="Abroad"
                value={false}
                current={form.location_type}
                onSelect={(v) => setForm({
                  ...form,
                  location_type: v,
                  // Clear the PH default so the Work Address step's country
                  // picker prompts the graduate to choose their actual country
                  // instead of silently keeping "Philippines" selected.
                  country: form.country === 'Philippines' ? '' : form.country,
                  region: '',
                  province_work: '',
                })}
              />
            </div>
          </div>

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 5: Work Address */}
      {isCurrentState(5) && (
        <div className="gt-stagger space-y-6">
          <SectionHeader icon={MapPin} title="Work Address" subtitle="Help us map employment locations" />

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 sm:p-4 space-y-3">
            <div>
              <p className="text-sm text-gray-900" style={{ fontWeight: 600 }}>Are you at your workplace right now?</p>
              <p className="text-[11px] text-emerald-900/80 leading-snug mt-0.5">
                Your current location can only pin your workplace if you are there.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
              {([[true, "Yes, I'm at work"], [false, 'No']] as const).map(([value, text]) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => { setAtWorkplace(value); setWorkNote(null); }}
                  aria-pressed={atWorkplace === value}
                  className={`gt-press min-h-11 rounded-lg border px-3 py-2 text-sm transition ${
                    atWorkplace === value
                      ? 'border-[#166534] bg-[#166534] text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  {text}
                </button>
              ))}
            </div>

            {atWorkplace === true && (
              <div className="gt-fade flex flex-col sm:flex-row sm:items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void fillWorkFromMyLocation()}
                  disabled={locatingWork}
                  className="gt-press inline-flex shrink-0 min-h-11 items-center justify-center gap-2 rounded-lg bg-[#166534] hover:bg-[#14532d] disabled:opacity-60 text-white px-3.5 py-2.5 text-sm transition"
                  style={{ fontWeight: 600 }}
                >
                  {locatingWork
                    ? <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <LocateFixed className="size-4" />}
                  {locatingWork ? 'Finding your location…' : workPinExact ? 'Update my location' : 'Use my current location'}
                </button>
                <p className="text-[11px] text-emerald-900/80 leading-snug">
                  Fills in your work address and pins your workplace. Your browser will ask for permission.
                </p>
              </div>
            )}
            {atWorkplace === false && (
              <p className="gt-fade text-xs text-gray-600 leading-snug">
                Choose your work address below. The map will start at your city; drag the pin onto your workplace if you know where it is.
              </p>
            )}

            {workNote && (
              <p
                className={`text-xs leading-snug ${
                  workNote.tone === 'ok' ? 'text-emerald-800' : workNote.tone === 'warn' ? 'text-amber-700' : 'text-red-600'
                }`}
                role="status"
              >
                {workNote.text}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Street Address (optional)</label>
            <input
              type="text"
              value={form.street_address}
              onChange={(e) => setForm({ ...form, street_address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          {/* Cascading location (Philippines) or free-text (abroad) */}
          {isPhilippinesWork ? (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Region<Required /></label>
                <select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value, province_work: '', city_municipality: '', barangay: '', zip_code: '' })}
                  className={fieldCls(missing(!form.region))}
                >
                  <option value="">Select Region</option>
                  {(phRegionsWork.length > 0 ? phRegionsWork.map(r => r.name) : regions).map((r: string) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Province</label>
                  <select
                    value={form.province_work}
                    onChange={(e) => setForm({ ...form, province_work: e.target.value, city_municipality: '', barangay: '', zip_code: '' })}
                    disabled={!form.region}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100"
                  >
                    <option value="">Select Province</option>
                    {phProvincesWork.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">City / Municipality<Required /></label>
                  <select
                    value={form.city_municipality}
                    onChange={(e) => {
                      // PSGC dataset has no ZIP column - user types it manually now.
                      setForm({ ...form, city_municipality: e.target.value, barangay: '' });
                    }}
                    disabled={!form.province_work && phProvincesWork.length > 0}
                    className={fieldCls(missing(!form.city_municipality), 'disabled:bg-gray-100')}
                  >
                    <option value="">Select City</option>
                    {phCitiesWork.map(c => <option key={c.id} value={c.name}>{c.name}{c.is_city ? ' (City)' : ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Barangay intentionally omitted on the WORK address form -
                  workplaces are recorded at city level for the geomap; barangay
                  is only meaningful for a home address. The DB column is kept
                  (sent empty) so the schema is unchanged. */}
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">City / Municipality<Required /></label>
                <input
                  type="text"
                  value={form.city_municipality}
                  onChange={(e) => setForm({ ...form, city_municipality: e.target.value })}
                  placeholder="Required"
                  className={fieldCls(missing(!form.city_municipality))}
                />
              </div>
              {/* Barangay omitted on the work address form (see note above). */}
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                ZIP Code (optional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={isPhilippinesWork ? 4 : 5}
                value={form.zip_code}
                onChange={(e) => {
                  const max = isPhilippinesWork ? 4 : 5;
                  const digits = e.target.value.replace(/\D/g, '').slice(0, max);
                  setForm({ ...form, zip_code: digits });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
              {form.zip_code && form.zip_code.length !== (isPhilippinesWork ? 4 : 5) && (
                <p className="text-red-500 text-xs mt-1">ZIP must be exactly {isPhilippinesWork ? 4 : 5} digits</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Country<Required /></label>
              {isPhilippinesWork ? (
                // Work Location "Philippines" was picked, so the country is fixed.
                <select
                  value="Philippines"
                  disabled
                  className={fieldCls(false, 'bg-gray-100 text-gray-700 cursor-not-allowed')}
                >
                  <option value="Philippines">Philippines</option>
                </select>
              ) : (
              <select
                value={form.country === 'Philippines' ? '' : form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className={fieldCls(missing(!form.country))}
              >
                <option value="">Select country</option>
                <optgroup label="ASEAN">
                  <option value="Indonesia">Indonesia</option>
                  <option value="Malaysia">Malaysia</option>
                  <option value="Singapore">Singapore</option>
                  <option value="Thailand">Thailand</option>
                  <option value="Vietnam">Vietnam</option>
                  <option value="Myanmar">Myanmar</option>
                  <option value="Cambodia">Cambodia</option>
                  <option value="Laos">Laos</option>
                  <option value="Brunei">Brunei</option>
                </optgroup>
                <optgroup label="East Asia">
                  <option value="Japan">Japan</option>
                  <option value="South Korea">South Korea</option>
                  <option value="China">China</option>
                  <option value="Hong Kong">Hong Kong</option>
                  <option value="Taiwan">Taiwan</option>
                </optgroup>
                <optgroup label="South Asia & Middle East">
                  <option value="India">India</option>
                  <option value="UAE">UAE</option>
                  <option value="Saudi Arabia">Saudi Arabia</option>
                  <option value="Qatar">Qatar</option>
                  <option value="Kuwait">Kuwait</option>
                  <option value="Bahrain">Bahrain</option>
                </optgroup>
                <optgroup label="Oceania">
                  <option value="Australia">Australia</option>
                  <option value="New Zealand">New Zealand</option>
                </optgroup>
                <optgroup label="Americas & Europe">
                  <option value="United States">United States</option>
                  <option value="Canada">Canada</option>
                  <option value="United Kingdom">United Kingdom</option>
                </optgroup>
                <option value="Other">Other</option>
              </select>
              )}
            </div>
          </div>

          {form.latitude != null && form.longitude != null && (
            <div className="gt-fade space-y-1.5">
              <label className="block text-sm font-semibold text-gray-900">Workplace Pin (optional)</label>
              <HomeLocationMap
                lat={form.latitude}
                lng={form.longitude}
                zoom={workPinExact ? 17 : 13}
                label="Map of your workplace. Drag the pin or tap the map to move it."
                onMove={moveWorkPin}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span>
                  {workPinExact
                    ? 'Drag the pin or tap the map if it is off.'
                    : `Pinned at ${form.city_municipality || 'your city'}. Drag the pin or tap the map to mark your workplace.`}
                </span>
                <button type="button" onClick={removeWorkPin} className="underline hover:text-gray-700">
                  Remove pin
                </button>
              </div>
              <p className="text-[10px] text-gray-400 leading-snug">
                Address lookup by{' '}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
                  © OpenStreetMap contributors
                </a>
                . Your workplace only appears on the admin geomap if you allow it on the consent step.
              </p>
            </div>
          )}

          <NavButtons onBack={prevStep} onNext={nextStep} />
        </div>
      )}

      {/* Step 6: Competency Assessment */}
      {isCurrentState(6) && (
        <div className="gt-stagger space-y-6">
          <SectionHeader icon={Award} title="Skills & Competencies" />

          {/* Technical Skills */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Technical Skills ({form.technical_skills.length} selected)
            </label>
            <SkillPicker
              groups={technicalGroups}
              selected={form.technical_skills}
              placeholder="Select technical skills"
              onChange={(next) => setForm({ ...form, technical_skills: next })}
            />
          </div>

          {/* Soft Skills */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Soft Skills ({form.soft_skills.length} selected)
            </label>
            <SkillPicker
              groups={softGroups}
              selected={form.soft_skills}
              placeholder="Select soft skills"
              onChange={(next) => setForm({ ...form, soft_skills: next })}
            />
          </div>

          {/* Professional Certifications */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              Professional Certifications (comma-separated, optional)
            </label>
            <input
              type="text"
              value={form.professional_certifications}
              onChange={(e) => setForm({ ...form, professional_certifications: e.target.value })}
              placeholder="e.g., AWS Solutions Architect, Google Cloud Professional"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>

          <NavButtons
            onBack={prevStep}
            onNext={handleSubmit}
            nextLabel={isSubmitting ? 'Submitting...' : 'Complete'}
            nextDisabled={isSubmitting}
            isSubmit={true}
          />
        </div>
      )}
    </div>
  );
}
