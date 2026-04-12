import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI } from '../../data/app-data';
import { Award, Plus, X, CheckCircle2, Save, Info } from 'lucide-react';

// ── CHED BSIS Core Skills (Part IV — Skills Utilized) ────────────────────────

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

// ── Additional Technical Skills (Category Browser) ───────────────────────────

const ADDITIONAL_CATEGORIES: Record<string, string[]> = {
  'Web Development':    ['HTML/CSS', 'React', 'Vue.js', 'Angular', 'Next.js', 'Tailwind CSS', 'Bootstrap', 'JavaScript', 'TypeScript'],
  'Backend':            ['Node.js', 'Laravel', 'Django', 'Spring Boot', '.NET / C#', 'PHP', 'Python', 'Java', 'Express.js'],
  'Mobile':             ['Flutter / Dart', 'React Native', 'Android (Java)', 'iOS / Swift', 'Kotlin'],
  'Database':           ['MySQL', 'PostgreSQL', 'MongoDB', 'Oracle DB', 'SQL Server', 'Redis', 'Firebase'],
  'Cloud & DevOps':     ['AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'CI/CD', 'Git / GitHub'],
  'Data & AI':          ['Python (Data)', 'Machine Learning', 'Data Analysis', 'Tableau', 'Power BI', 'TensorFlow', 'SQL'],
  'Cybersecurity':      ['Network Security', 'Penetration Testing', 'SOC', 'SIEM', 'Ethical Hacking', 'Firewall'],
  'Project Mgmt Tools': ['Agile / Scrum', 'JIRA', 'Trello', 'PMP', 'Risk Management', 'Confluence'],
  'Design':             ['UI/UX Design', 'Figma', 'Adobe XD', 'Photoshop', 'Canva'],
  'Networking':         ['Cisco Networking', 'CCNA', 'Network Admin', 'Linux', 'VPN', 'OSPF'],
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AlumniSkills() {
  const rawUser = sessionStorage.getItem('alumni_user');
  const graduate = rawUser ? JSON.parse(rawUser) : VALID_ALUMNI[0];

  const [selectedSkills, setSelectedSkills] = useState<string[]>(graduate.skills ?? []);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const toggleSkill = (skill: string) => {
    setSaved(false);
    setSelectedSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const removeSkill = (skill: string) => {
    setSelectedSkills(prev => prev.filter(s => s !== skill));
    setSaved(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 900));
    const updated = { ...graduate, skills: selectedSkills, dateUpdated: new Date().toISOString().split('T')[0] };
    sessionStorage.setItem('alumni_user', JSON.stringify(updated));
    setSaved(true);
    setIsSaving(false);
  };

  const coreSelected = selectedSkills.filter(s => BSIS_CORE_SKILLS.includes(s));
  const additionalSelected = selectedSkills.filter(s => !BSIS_CORE_SKILLS.includes(s));

  return (
    <PortalLayout role="alumni" pageTitle="My Skills" pageSubtitle="Manage your BSIS competency and skills profile">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header banner */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white/20 shrink-0">
              <Award className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-white" style={{ fontWeight: 700 }}>BSIS Skills Profile</h3>
              <p className="text-green-100 text-sm mt-0.5">
                Based on the CHED Graduate Tracer Survey — select all skills you actively use in your current employment.
              </p>
            </div>
          </div>
        </div>

        {/* ── BSIS Core Skills Checklist ──────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-gray-800" style={{ fontWeight: 700 }}>
              BSIS Program Skills — Skills Utilized
            </h3>
            <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
              {coreSelected.length}/{BSIS_CORE_SKILLS.length}
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
              const checked = selectedSkills.includes(skill);
              return (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${
                    checked
                      ? 'border-[#166534] bg-[#166534]/5 text-[#166534]'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534]/30 hover:bg-green-50/50'
                  }`}
                >
                  <div className={`size-5 rounded border-2 flex items-center justify-center shrink-0 transition ${
                    checked ? 'border-[#166534] bg-[#166534]' : 'border-gray-300'
                  }`}>
                    {checked && (
                      <svg className="size-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm" style={{ fontWeight: checked ? 600 : 400 }}>{skill}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Additional Skills (Category Browser) ───────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-1">
            <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Additional Technical Skills</h3>
            {additionalSelected.length > 0 && (
              <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
                {additionalSelected.length} selected
              </span>
            )}
          </div>
          <p className="text-gray-500 text-xs mb-4">Browse categories for specific frameworks, tools, and certifications.</p>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.keys(ADDITIONAL_CATEGORIES).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={`px-3 py-1.5 rounded-full text-xs border transition ${
                  activeCategory === cat
                    ? 'bg-[#166534] border-[#166534] text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
                style={{ fontWeight: activeCategory === cat ? 600 : 400 }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Skills grid for active category */}
          {activeCategory ? (
            <div>
              <p className="text-gray-500 text-xs mb-3" style={{ fontWeight: 600 }}>{activeCategory}</p>
              <div className="flex flex-wrap gap-2">
                {ADDITIONAL_CATEGORIES[activeCategory].map(skill => {
                  const isSelected = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      onClick={() => toggleSkill(skill)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition ${
                        isSelected
                          ? 'bg-[#166534] border-[#166534] text-white'
                          : 'border-gray-200 text-gray-700 hover:border-[#166534]/30 hover:bg-green-50'
                      }`}
                      style={{ fontWeight: isSelected ? 600 : 400 }}
                    >
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

          {/* Selected additional skills */}
          {additionalSelected.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-gray-500 text-xs mb-2" style={{ fontWeight: 600 }}>Your additional skills</p>
              <div className="flex flex-wrap gap-2">
                {additionalSelected.map(skill => (
                  <span key={skill}
                    className="inline-flex items-center gap-1.5 bg-[#166534] text-white text-xs px-3 py-1.5 rounded-full"
                    style={{ fontWeight: 500 }}>
                    {skill}
                    <button onClick={() => removeSkill(skill)} className="hover:text-red-300 transition ml-0.5">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── All Selected Skills Summary ─────────────────────────────── */}
        {selectedSkills.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>
                All Selected Skills
                <span className="text-gray-400 text-sm ml-2" style={{ fontWeight: 400 }}>({selectedSkills.length})</span>
              </h3>
              {saved && (
                <span className="flex items-center gap-1 text-emerald-600 text-xs" style={{ fontWeight: 600 }}>
                  <CheckCircle2 className="size-4" /> Saved
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedSkills.map(skill => (
                <span key={skill}
                  className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-xs px-3 py-1.5 rounded-full"
                  style={{ fontWeight: 500 }}>
                  {skill}
                  <button onClick={() => removeSkill(skill)} className="hover:text-red-500 transition ml-0.5">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Save button */}
        <button onClick={handleSave} disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-70 sticky bottom-4 shadow-lg"
          style={{ fontWeight: 600 }}>
          {isSaving
            ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
            : <><Save className="size-4" /> Save Skills ({selectedSkills.length} selected)</>}
        </button>

      </div>
    </PortalLayout>
  );
}
