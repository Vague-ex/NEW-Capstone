import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI } from '../../data/app-data';
import { updateAlumniEmployment } from '../../app/api-client';
import { useReferenceData } from '../../hooks/useReferenceData';
import {
  Briefcase, CheckCircle2, Clock, Save, Building2,
  MapPin, AlertTriangle, BookOpen, Star, Plus, X, Info, Award,
} from 'lucide-react';

// ── Shared UI ─────────────────────────────────────────────────────────────────

function RadioOption({ label, value, current, onSelect }: {
  label: string; value: string; current: string; onSelect: (v: string) => void;
}) {
  const active = current === value;
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition select-none ${active ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
      <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-[#166534]' : 'border-gray-300'}`}>
        {active && <div className="size-2 rounded-full bg-[#166534]" />}
      </div>
      <input type="radio" className="hidden" value={value} checked={active} onChange={() => onSelect(value)} />
      {label}
    </label>
  );
}

function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition select-none ${checked ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
      <div className={`size-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'border-[#166534] bg-[#166534]' : 'border-gray-300'}`}>
        {checked && (
          <svg className="size-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <input type="checkbox" className="hidden" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
      {children} {required && <span className="text-red-500">*</span>}
    </label>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
        <Icon className="size-4 text-[#166534]" /> {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

// ── Constants ─────────────────────────────────────────────────────────────────

const BSIS_CORE_SKILLS = [
  'Programming/Software Development',
  'Database Management',
  'Network Administration',
  'Business Process Analysis',
  'Project Management',
  'Technical Support / Troubleshooting',
  'Data Analytics',
  'Web Development',
  'System Analysis and Design',
  'Communication Skills (Oral/Written)',
  'Teamwork/Collaboration',
  'Problem-solving / Critical Thinking',
];

const ADDITIONAL_CATEGORIES: Record<string, string[]> = {
  'Web Development': ['HTML/CSS', 'React', 'Vue.js', 'Angular', 'Next.js', 'Tailwind CSS', 'Bootstrap', 'JavaScript', 'TypeScript'],
  'Backend': ['Node.js', 'Laravel', 'Django', 'Spring Boot', '.NET / C#', 'PHP', 'Python', 'Java', 'Express.js'],
  'Mobile': ['Flutter / Dart', 'React Native', 'Android (Java)', 'iOS / Swift', 'Kotlin'],
  'Database': ['MySQL', 'PostgreSQL', 'MongoDB', 'Oracle DB', 'SQL Server', 'Redis', 'Firebase'],
  'Cloud & DevOps': ['AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'CI/CD', 'Git / GitHub'],
  'Data & AI': ['Python (Data)', 'Machine Learning', 'Data Analysis', 'Tableau', 'Power BI', 'TensorFlow', 'SQL'],
  'Cybersecurity': ['Network Security', 'Penetration Testing', 'SOC', 'SIEM', 'Ethical Hacking', 'Firewall'],
  'Project Mgmt Tools': ['Agile / Scrum', 'JIRA', 'Trello', 'PMP', 'Risk Management', 'Confluence'],
  'Design': ['UI/UX Design', 'Figma', 'Adobe XD', 'Photoshop', 'Canva'],
  'Networking': ['Cisco Networking', 'CCNA', 'Network Admin', 'Linux', 'VPN', 'OSPF'],
};

const SOFT_SKILLS = [
  'Oral Communication',
  'Written Communication',
  'Teamwork / Collaboration',
  'Problem-solving / Critical Thinking',
  'Adaptability / Flexibility',
  'Leadership',
  'Customer Service Orientation',
  'Attention to Detail',
  'Ability to Work Under Pressure',
  'Time Management',
];

const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'employed_full_time', label: 'Yes, full-time' },
  { value: 'employed_part_time', label: 'Yes, part-time' },
  { value: 'self_employed', label: 'Yes, self-employed/freelance' },
  { value: 'seeking', label: 'No, currently seeking employment' },
  { value: 'not_seeking', label: 'No, not seeking employment (further studies, personal reasons)' },
  { value: 'never_employed', label: 'Never employed' },
];

function normalizeEmploymentStatus(status: string): string {
  if (status === 'employed_full_time' || status === 'employed_part_time') return 'employed';
  if (status === 'self_employed') return 'self-employed';
  return 'unemployed';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AlumniEmployment() {
  const { data: referenceData } = useReferenceData();
  const rawUser = sessionStorage.getItem('alumni_user');
  const alumni = rawUser ? JSON.parse(rawUser) : VALID_ALUMNI[0];
  const alumniId = String(alumni?.id ?? '');
  const isVerified = (alumni.verificationStatus ?? 'pending') === 'verified';
  const isPending = !isVerified;

  const sd = (alumni.surveyData ?? {}) as Record<string, unknown>;

  // ── Form state ──────────────────────────────────────────────────────────────

  const [form, setForm] = useState({
    // Section 4: Academic & Pre-Employment
    general_average_range: String(sd.general_average_range ?? ''),
    academic_honors: String(sd.academic_honors ?? ''),
    prior_work_experience: String(sd.prior_work_experience ?? ''),
    ojt_relevance: String(sd.ojt_relevance ?? ''),
    has_portfolio: String(sd.has_portfolio ?? ''),
    english_proficiency: String(sd.english_proficiency ?? ''),

    // Section 5: Employment Status
    employment_status: String(sd.employment_status ?? alumni.employmentStatus ?? ''),

    // Section 6: First Job
    timeToHire: String(sd.timeToHire ?? ''),
    firstJobSector: String(sd.firstJobSector ?? ''),
    firstJobStatus: String(sd.firstJobStatus ?? ''),
    firstJobTitle: String(sd.firstJobTitle ?? sd.first_job_title ?? alumni.jobTitle ?? ''),
    firstJobRelated: String(sd.firstJobRelated ?? ''),
    firstJobUnrelatedReason: String(sd.firstJobUnrelatedReason ?? ''),
    firstJobUnrelatedOther: String(sd.firstJobUnrelatedOther ?? ''),
    jobRetention: String(sd.jobRetention ?? ''),
    jobApplications: String(sd.jobApplications ?? ''),
    jobSource: String(sd.jobSource ?? ''),
    jobSourceOther: String(sd.jobSourceOther ?? ''),

    // Section 7: Current Job
    currentJobSector: String(sd.currentJobSector ?? ''),
    currentJobTitleId: String(sd.currentJobTitleId ?? alumni.jobTitleId ?? ''),
    currentJobPosition: String(sd.currentJobPosition ?? sd.current_job_title ?? alumni.jobTitle ?? ''),
    currentJobCompany: String(sd.currentJobCompany ?? sd.current_job_company ?? alumni.company ?? ''),
    currentJobRelated: String(sd.currentJobRelated ?? ''),
    currentJobLocation: String(sd.currentJobLocation ?? (alumni.workLocation?.toLowerCase().includes('abroad') ? 'Abroad / Remote Foreign Employer' : 'Local (Philippines)')),

    // Section 8: Work Address
    street_address: String(sd.street_address ?? ''),
    barangay: String(sd.barangay ?? ''),
    city_municipality: String(sd.city_municipality ?? ''),
    currentJobRegionId: String(sd.currentJobRegionId ?? sd.region_address ?? alumni.regionId ?? ''),
    zip_code: String(sd.zip_code ?? ''),
    country_address: String(sd.country_address ?? 'Philippines'),

    // Section 9: Skills
    technical_skills: Array.isArray(sd.technical_skills) ? (sd.technical_skills as string[]) : [],
    soft_skills: Array.isArray(sd.soft_skills) ? (sd.soft_skills as string[]) : [],
    professional_certifications: String(sd.professional_certifications ?? ''),
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [employerLinkStatus, setEmployerLinkStatus] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const employerPortalLink = typeof window === 'undefined' ? '/employer' : `${window.location.origin}/employer`;

  const setF = (key: string, value: string) => {
    setSaved(false); setSaveError('');
    setForm(f => ({ ...f, [key]: value }));
  };

  const toggleSkill = (field: 'technical_skills' | 'soft_skills', value: string) => {
    setSaved(false); setSaveError('');
    setForm(f => {
      const arr = f[field];
      return { ...f, [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };

  const removeSkill = (skill: string) => {
    setSaved(false); setSaveError('');
    const allAdditional = Object.values(ADDITIONAL_CATEGORIES).flat();
    if (BSIS_CORE_SKILLS.includes(skill) || allAdditional.includes(skill)) {
      setForm(f => ({ ...f, technical_skills: f.technical_skills.filter(s => s !== skill) }));
    } else {
      setForm(f => ({ ...f, soft_skills: f.soft_skills.filter(s => s !== skill) }));
    }
  };

  const handleShareLink = async () => {
    try {
      await navigator.clipboard.writeText(employerPortalLink);
      setEmployerLinkStatus('Employer Portal link copied. Share it with your employer.');
    } catch {
      setEmployerLinkStatus('Copy not available. Share the link below manually.');
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────

  const isCurrentlyEmployed = ['employed_full_time', 'employed_part_time', 'self_employed'].includes(form.employment_status);
  const isNeverEmployed = form.employment_status === 'never_employed';

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError('');

    const normalizedStatus = normalizeEmploymentStatus(form.employment_status);

    const matchedByName = referenceData.job_titles.find(
      jt => jt.name.toLowerCase() === form.currentJobPosition.trim().toLowerCase(),
    );
    const resolvedJobTitleId = form.currentJobTitleId || matchedByName?.id || undefined;
    const resolvedRegionId = form.currentJobRegionId || undefined;

    const surveyDataPayload = {
      ...sd,
      ...form,
      currentJobTitleId: resolvedJobTitleId || '',
      currentJobRegionId: resolvedRegionId || '',
    };

    try {
      let serverAlumni: Record<string, unknown> = {};
      if (alumniId) {
        const response = await updateAlumniEmployment(alumniId, {
          employment_status: normalizedStatus,
          survey_data: surveyDataPayload,
          job_title_id: resolvedJobTitleId,
          region_id: resolvedRegionId,
          skill_entries: [
            ...form.technical_skills.map(name => ({ name, proficiency: 'intermediate' })),
            ...form.soft_skills.map(name => ({ name, proficiency: 'intermediate' })),
          ],
        });
        if (response.alumni && typeof response.alumni === 'object') {
          serverAlumni = response.alumni as Record<string, unknown>;
        }
      }

      const updated = {
        ...alumni,
        ...serverAlumni,
        employmentStatus: normalizedStatus,
        jobTitle: form.currentJobPosition || form.firstJobTitle || alumni.jobTitle,
        company: form.currentJobCompany || alumni.company,
        jobAlignment: form.currentJobRelated === 'Yes, directly related (IT/IS role)' ? 'related'
          : form.currentJobRelated === 'Not related (different field)' ? 'not-related' : alumni.jobAlignment,
        workLocation: form.currentJobLocation === 'Abroad / Remote Foreign Employer' ? 'Abroad' : 'Local (Philippines)',
        jobTitleId: resolvedJobTitleId || alumni.jobTitleId,
        regionId: resolvedRegionId || alumni.regionId,
        surveyData: surveyDataPayload,
        dateUpdated: new Date().toISOString().split('T')[0],
      };

      sessionStorage.setItem('alumni_user', JSON.stringify(updated));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save employment data right now.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PortalLayout role="alumni" pageTitle="Employment Details" pageSubtitle="CHED Graduate Tracer Survey — Employment Record">
      <div className="max-w-3xl mx-auto space-y-5">

        {isPending && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <Clock className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-800 text-sm" style={{ fontWeight: 700 }}>Account pending verification</p>
              <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
                You can update and save your employment data at any time. Your information will{' '}
                <span style={{ fontWeight: 700 }}>not appear in analytics</span> until the Program Chair approves your account.
              </p>
            </div>
          </div>
        )}

        {isCurrentlyEmployed && (
          <div className="rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-400 shadow">
                <Building2 className="size-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-amber-900 text-base" style={{ fontWeight: 800 }}>Important — Share Employer Portal Link</p>
                <p className="text-amber-800 text-sm mt-1 leading-relaxed">
                  To verify your employment, your <span style={{ fontWeight: 700 }}>employer or HR supervisor</span> must confirm your record through the Employer Portal.
                  Copy the link below and send it to them — they register for free and verify your status in minutes.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={handleShareLink}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-2.5 text-sm text-white shadow transition"
                    style={{ fontWeight: 700 }}>
                    <Building2 className="size-4" /> Copy Employer Portal Link
                  </button>
                  <span className="break-all text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2 font-mono">
                    {employerPortalLink}
                  </span>
                </div>
                {employerLinkStatus && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700" style={{ fontWeight: 600 }}>
                    <CheckCircle2 className="size-4 text-emerald-500" /> {employerLinkStatus}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">

          {/* ── Section 4: Academic & Pre-Employment ─────────────────────────── */}
          <SectionCard icon={BookOpen} title="Part III — Academic & Pre-Employment Profile">

            <div>
              <FieldLabel>1. General Average Range during BSIS</FieldLabel>
              <div className="space-y-2">
                {['95 - 100', '90 - 94', '85 - 89', '80 - 84', '75 - 79', 'Below 75', "I don't remember"].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.general_average_range} onSelect={v => setF('general_average_range', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>2. Academic Honors Received at Graduation</FieldLabel>
              <div className="space-y-2">
                {['Summa Cum Laude', 'Magna Cum Laude', 'Cum Laude', 'No Academic Honors'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.academic_honors} onSelect={v => setF('academic_honors', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>3. Work experience (part-time, freelance, internship beyond OJT) BEFORE graduating?</FieldLabel>
              <div className="flex gap-2">
                {['Yes', 'No'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.prior_work_experience} onSelect={v => setF('prior_work_experience', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>4. Was your required OJT/Internship related to the job you eventually got?</FieldLabel>
              <div className="space-y-2">
                {['Yes, directly related', 'Somewhat related', 'Not related', 'Have not secured a job yet / Not applicable'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.ojt_relevance} onSelect={v => setF('ojt_relevance', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>5. Online portfolio, GitHub profile, or project showcase when applying?</FieldLabel>
              <div className="flex gap-2">
                {['Yes', 'No'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.has_portfolio} onSelect={v => setF('has_portfolio', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>6. English communication skills</FieldLabel>
              <div className="space-y-2">
                {[
                  'Basic (simple conversations only)',
                  'Conversational (can handle daily work communication)',
                  'Professional/Business (can write reports, present, negotiate)',
                ].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.english_proficiency} onSelect={v => setF('english_proficiency', v)} />
                ))}
              </div>
            </div>
          </SectionCard>

          {/* ── Section 5: Employment Status ─────────────────────────────────── */}
          <SectionCard icon={Briefcase} title="Part IV — Current Employment Status">
            <div>
              <FieldLabel required>Are you presently employed?</FieldLabel>
              <div className="space-y-2">
                {EMPLOYMENT_STATUS_OPTIONS.map(opt => (
                  <RadioOption key={opt.value} label={opt.label} value={opt.value}
                    current={form.employment_status} onSelect={v => setF('employment_status', v)} />
                ))}
              </div>
            </div>
          </SectionCard>

          {/* ── Section 6: First Job ─────────────────────────────────────────── */}
          {!isNeverEmployed && form.employment_status && (
            <SectionCard icon={Clock} title="Part V — First Job Details">

              <div>
                <FieldLabel>1. How long did it take to land your FIRST job after graduation?</FieldLabel>
                <div className="space-y-2">
                  {['Within 1 month', '1 - 3 months', '3 - 6 months', '6 months to 1 year', '1 - 2 years', 'More than 2 years'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.timeToHire} onSelect={v => setF('timeToHire', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>2. Employment Sector of FIRST JOB</FieldLabel>
                <div className="space-y-2">
                  {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.firstJobSector} onSelect={v => setF('firstJobSector', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>3. Employment Status of FIRST JOB</FieldLabel>
                <div className="space-y-2">
                  {['Regular/Permanent', 'Probationary', 'Contractual/Casual/Job Order', 'Self-Employed / Freelance'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.firstJobStatus} onSelect={v => setF('firstJobStatus', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>4. Job Title / Position in FIRST JOB</FieldLabel>
                <input type="text" placeholder="e.g. Junior Software Developer"
                  value={form.firstJobTitle} onChange={e => setF('firstJobTitle', e.target.value)} className={inputCls} />
              </div>

              <div>
                <FieldLabel>5. Is/Was your FIRST JOB related to your BSIS degree?</FieldLabel>
                <div className="space-y-2">
                  {['Yes, directly related (IT/IS role)', 'Somewhat related (uses some IT skills)', 'Not related (different field)'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.firstJobRelated} onSelect={v => setF('firstJobRelated', v)} />
                  ))}
                </div>
              </div>

              {(form.firstJobRelated === 'Somewhat related (uses some IT skills)' || form.firstJobRelated === 'Not related (different field)') && (
                <div>
                  <FieldLabel>6. Primary reason for accepting unrelated/semi-related job</FieldLabel>
                  <div className="space-y-2">
                    {['Salary & Benefits', 'Career Challenge/Advancement', 'Proximity to Residence',
                      'Lack of related job openings at the time', 'Family/Peer influence', 'Others'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt} current={form.firstJobUnrelatedReason} onSelect={v => setF('firstJobUnrelatedReason', v)} />
                      ))}
                  </div>
                  {form.firstJobUnrelatedReason === 'Others' && (
                    <input type="text" placeholder="Please specify…"
                      value={form.firstJobUnrelatedOther} onChange={e => setF('firstJobUnrelatedOther', e.target.value)}
                      className={`${inputCls} mt-2`} />
                  )}
                </div>
              )}

              <div>
                <FieldLabel>7. How long did you stay in your FIRST JOB?</FieldLabel>
                <div className="space-y-2">
                  {['Less than 3 months', '3 - 6 months', '6 months to 1 year', '1 - 2 years', 'More than 2 years', 'Currently in first job'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.jobRetention} onSelect={v => setF('jobRetention', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>8. Approximately how many job applications before your FIRST job offer?</FieldLabel>
                <div className="space-y-2">
                  {['1 - 5 applications', '6 - 15 applications', '16 - 30 applications', '31+ applications'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.jobApplications} onSelect={v => setF('jobApplications', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>9. Where did you find your first job opening?</FieldLabel>
                <div className="space-y-2">
                  {[
                    'Online Job Portal (JobStreet, LinkedIn, etc.)',
                    'CHMSU Career Orientation / Job Fair',
                    'Personal Network / Referral',
                    'Company Walk-in / Direct Hire',
                    'Social media (Facebook groups, etc.)',
                    'Started own business / Freelance platform',
                    'Others',
                  ].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.jobSource} onSelect={v => setF('jobSource', v)} />
                  ))}
                </div>
                {form.jobSource === 'Others' && (
                  <input type="text" placeholder="Please specify…"
                    value={form.jobSourceOther} onChange={e => setF('jobSourceOther', e.target.value)}
                    className={`${inputCls} mt-2`} />
                )}
              </div>
            </SectionCard>
          )}

          {/* ── Section 7: Current Job ───────────────────────────────────────── */}
          {isCurrentlyEmployed && (
            <SectionCard icon={Building2} title="Part VI — Current / Most Recent Job Details">

              <div>
                <FieldLabel>1. Employment Sector of CURRENT/MOST RECENT JOB</FieldLabel>
                <div className="space-y-2">
                  {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.currentJobSector} onSelect={v => setF('currentJobSector', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>2. Current Occupation / Position</FieldLabel>
                <select
                  value={form.currentJobTitleId}
                  onChange={e => {
                    const id = e.target.value;
                    const title = referenceData.job_titles.find(jt => jt.id === id);
                    setForm(f => ({ ...f, currentJobTitleId: id, currentJobPosition: title ? title.name : f.currentJobPosition }));
                    setSaved(false); setSaveError('');
                  }}
                  className={`${inputCls} mb-2`}
                >
                  <option value="">Select suggested job title (optional)</option>
                  {referenceData.job_titles.map(jt => (
                    <option key={jt.id} value={jt.id}>{jt.name}</option>
                  ))}
                </select>
                <input type="text" placeholder="e.g. Systems Analyst"
                  value={form.currentJobPosition} onChange={e => setF('currentJobPosition', e.target.value)} className={inputCls} />
              </div>

              <div>
                <FieldLabel>3. Name of Company / Organization</FieldLabel>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  <input type="text" placeholder="Company or organization name"
                    value={form.currentJobCompany} onChange={e => setF('currentJobCompany', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white" />
                </div>
              </div>

              <div>
                <FieldLabel>4. Is your CURRENT job related to your BSIS degree?</FieldLabel>
                <div className="space-y-2">
                  {['Yes, directly related (IT/IS role)', 'Somewhat related (uses some IT skills)', 'Not related (different field)', 'Not applicable'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.currentJobRelated} onSelect={v => setF('currentJobRelated', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>5. Location Type</FieldLabel>
                <div className="space-y-2">
                  {['Local (Philippines)', 'Abroad / Remote Foreign Employer'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.currentJobLocation} onSelect={v => setF('currentJobLocation', v)} />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-emerald-900 text-xs leading-relaxed" style={{ fontWeight: 600 }}>
                  To verify your workplace and employment details, share this Employer Portal link with your supervisor or HR.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button type="button" onClick={handleShareLink}
                    className="inline-flex items-center justify-center rounded-lg bg-[#166534] px-3.5 py-2 text-xs text-white transition hover:bg-[#14532d]"
                    style={{ fontWeight: 600 }}>
                    Give Employer Portal Link
                  </button>
                  {employerLinkStatus && <p className="text-[11px] text-emerald-700">{employerLinkStatus}</p>}
                </div>
                <p className="mt-2 break-all text-[11px] text-emerald-700">{employerPortalLink}</p>
              </div>
            </SectionCard>
          )}

          {/* ── Section 8: Work Address ──────────────────────────────────────── */}
          {isCurrentlyEmployed && (
            <SectionCard icon={MapPin} title="Part VII — Work Address for Mapping">
              <p className="text-gray-400 text-xs -mt-2">For employment distribution mapping — company name kept confidential.</p>

              <div>
                <FieldLabel>Street Address / Building / Unit (optional)</FieldLabel>
                <input type="text" placeholder="e.g. 123 Rizal St., Floor 4"
                  value={form.street_address} onChange={e => setF('street_address', e.target.value)} className={inputCls} />
              </div>

              <div>
                <FieldLabel>Barangay (optional)</FieldLabel>
                <input type="text" placeholder="Barangay name"
                  value={form.barangay} onChange={e => setF('barangay', e.target.value)} className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel required>City / Municipality</FieldLabel>
                  <input type="text" placeholder="e.g. Talisay City"
                    value={form.city_municipality} onChange={e => setF('city_municipality', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <FieldLabel>ZIP Code (optional)</FieldLabel>
                  <input type="text" placeholder="e.g. 6115"
                    value={form.zip_code} onChange={e => setF('zip_code', e.target.value)} className={inputCls} />
                </div>
              </div>

              <div>
                <FieldLabel required>Region</FieldLabel>
                <select value={form.currentJobRegionId} onChange={e => setF('currentJobRegionId', e.target.value)} className={inputCls}>
                  <option value="">Select region...</option>
                  {referenceData.regions.map(region => (
                    <option key={region.id} value={region.id}>{region.code} — {region.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel required>Country</FieldLabel>
                <select value={form.country_address} onChange={e => setF('country_address', e.target.value)} className={inputCls}>
                  <option value="Philippines">Philippines</option>
                  <optgroup label="ASEAN">
                    <option>Indonesia</option><option>Malaysia</option><option>Singapore</option>
                    <option>Thailand</option><option>Vietnam</option><option>Myanmar</option>
                    <option>Cambodia</option><option>Laos</option><option>Brunei</option><option>Timor-Leste</option>
                  </optgroup>
                  <optgroup label="East Asia">
                    <option>Japan</option><option>South Korea</option><option>China</option>
                    <option>Hong Kong</option><option>Taiwan</option>
                  </optgroup>
                  <optgroup label="Middle East">
                    <option>Saudi Arabia</option><option>United Arab Emirates</option><option>Qatar</option>
                    <option>Kuwait</option><option>Bahrain</option><option>Oman</option>
                  </optgroup>
                  <optgroup label="Oceania">
                    <option>Australia</option><option>New Zealand</option>
                  </optgroup>
                  <optgroup label="Americas &amp; Europe">
                    <option>United States</option><option>Canada</option><option>United Kingdom</option>
                    <option>Germany</option><option>Italy</option><option>Spain</option>
                  </optgroup>
                  <optgroup label="Other"><option>Other</option></optgroup>
                </select>
              </div>
            </SectionCard>
          )}

          {/* ── Section 9: Skills ─────────────────────────────────────────────── */}

          {/* Skills header banner */}
          <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-white/20 shrink-0">
                <Award className="size-5 text-white" />
              </div>
              <div>
                <h3 className="text-white" style={{ fontWeight: 700 }}>Part VIII — Competency &amp; Skills Assessment</h3>
                <p className="text-green-100 text-sm mt-0.5">
                  Based on the CHED Graduate Tracer Survey — select all skills you actively use in your current employment.
                </p>
              </div>
            </div>
          </div>

          {/* BSIS Core Skills */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>BSIS Program Skills — Skills Utilized</h3>
              <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
                {form.technical_skills.filter(s => BSIS_CORE_SKILLS.includes(s)).length}/{BSIS_CORE_SKILLS.length}
              </span>
            </div>
            <div className="flex items-start gap-2 mb-5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
              <Info className="size-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-blue-700 text-xs">
                Check <span style={{ fontWeight: 600 }}>all BSIS program skills</span> that you actively use in your current employment.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {BSIS_CORE_SKILLS.map(skill => {
                const checked = form.technical_skills.includes(skill);
                return (
                  <button key={skill} type="button" onClick={() => toggleSkill('technical_skills', skill)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${checked ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534]/30 hover:bg-green-50/50'}`}>
                    <div className={`size-5 rounded border-2 flex items-center justify-center shrink-0 transition ${checked ? 'border-[#166534] bg-[#166534]' : 'border-gray-300'}`}>
                      {checked && <svg className="size-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <span className="text-sm" style={{ fontWeight: checked ? 600 : 400 }}>{skill}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Additional Technical Skills — Category Browser */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Additional Technical Skills</h3>
              {form.technical_skills.filter(s => !BSIS_CORE_SKILLS.includes(s)).length > 0 && (
                <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
                  {form.technical_skills.filter(s => !BSIS_CORE_SKILLS.includes(s)).length} selected
                </span>
              )}
            </div>
            <p className="text-gray-500 text-xs mb-4">Browse categories for specific frameworks, tools, and certifications.</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.keys(ADDITIONAL_CATEGORIES).map(cat => (
                <button key={cat} type="button"
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition ${activeCategory === cat ? 'bg-[#166534] border-[#166534] text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                  style={{ fontWeight: activeCategory === cat ? 600 : 400 }}>
                  {cat}
                </button>
              ))}
            </div>
            {activeCategory ? (
              <div>
                <p className="text-gray-500 text-xs mb-3" style={{ fontWeight: 600 }}>{activeCategory}</p>
                <div className="flex flex-wrap gap-2">
                  {ADDITIONAL_CATEGORIES[activeCategory].map(skill => {
                    const isSelected = form.technical_skills.includes(skill);
                    return (
                      <button key={skill} type="button" onClick={() => toggleSkill('technical_skills', skill)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition ${isSelected ? 'bg-[#166534] border-[#166534] text-white' : 'border-gray-200 text-gray-700 hover:border-[#166534]/30 hover:bg-green-50'}`}
                        style={{ fontWeight: isSelected ? 600 : 400 }}>
                        {isSelected ? <X className="size-3" /> : <Plus className="size-3" />}
                        {skill}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm text-center py-4">Click a category above to browse and add skills</p>
            )}
            {form.technical_skills.filter(s => !BSIS_CORE_SKILLS.includes(s)).length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-gray-500 text-xs mb-2" style={{ fontWeight: 600 }}>Your additional skills</p>
                <div className="flex flex-wrap gap-2">
                  {form.technical_skills.filter(s => !BSIS_CORE_SKILLS.includes(s)).map(skill => (
                    <span key={skill} className="inline-flex items-center gap-1.5 bg-[#166534] text-white text-xs px-3 py-1.5 rounded-full" style={{ fontWeight: 500 }}>
                      {skill}
                      <button type="button" onClick={() => removeSkill(skill)} className="hover:text-red-300 transition ml-0.5">
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Soft Skills */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Soft Skills</h3>
              <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
                {form.soft_skills.length}/{SOFT_SKILLS.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SOFT_SKILLS.map(skill => (
                <CheckOption key={skill} label={skill}
                  checked={form.soft_skills.includes(skill)}
                  onChange={() => toggleSkill('soft_skills', skill)} />
              ))}
            </div>
          </div>

          {/* All Selected Skills Summary */}
          {(form.technical_skills.length + form.soft_skills.length) > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-3" style={{ fontWeight: 700 }}>
                All Selected Skills
                <span className="text-gray-400 text-sm ml-2" style={{ fontWeight: 400 }}>({form.technical_skills.length + form.soft_skills.length})</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {[...form.technical_skills, ...form.soft_skills].map(skill => (
                  <span key={skill} className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-xs px-3 py-1.5 rounded-full" style={{ fontWeight: 500 }}>
                    {skill}
                    <button type="button" onClick={() => removeSkill(skill)} className="hover:text-red-500 transition ml-0.5">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Professional Certifications */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <FieldLabel>Professional awards or certifications received after graduation (optional)</FieldLabel>
            <input type="text" placeholder="e.g. AWS Certified Cloud Practitioner, 2024"
              value={form.professional_certifications}
              onChange={e => setF('professional_certifications', e.target.value)}
              className={inputCls} />
          </div>

          {/* ── Save Controls ─────────────────────────────────────────────────── */}
          {saveError && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
              <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs">{saveError}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-70"
              style={{ fontWeight: 600 }}>
              {isSaving
                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : <><Save className="size-4" /> Save Employment Data</>}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-emerald-600 text-sm shrink-0" style={{ fontWeight: 600 }}>
                <CheckCircle2 className="size-5" /> Saved!
              </span>
            )}
          </div>

        </form>
      </div>
    </PortalLayout>
  );
}
