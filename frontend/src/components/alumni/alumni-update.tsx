import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import {
  Briefcase, Camera, MapPin, CheckCircle2, AlertTriangle,
  Save, RefreshCw, Video, VideoOff, Clock, Building2, Award,
  Plus, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { VALID_ALUMNI } from '../../data/app-data';

// ── Skill data ────────────────────────────────────────────────────────────────

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
  'Web Dev':        ['HTML/CSS', 'React', 'Vue.js', 'Angular', 'Next.js', 'JavaScript', 'TypeScript', 'Tailwind CSS'],
  'Backend':        ['Node.js', 'Laravel', 'Django', 'Spring Boot', '.NET / C#', 'PHP', 'Python', 'Java'],
  'Mobile':         ['Flutter / Dart', 'React Native', 'Android (Java)', 'iOS / Swift', 'Kotlin'],
  'Database':       ['MySQL', 'PostgreSQL', 'MongoDB', 'Oracle DB', 'SQL Server', 'Redis', 'Firebase'],
  'Cloud & DevOps': ['AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'CI/CD', 'Git / GitHub'],
  'Data & AI':      ['Python (Data)', 'Machine Learning', 'Data Analysis', 'Tableau', 'Power BI', 'TensorFlow'],
  'Security':       ['Network Security', 'Penetration Testing', 'SOC', 'SIEM', 'Ethical Hacking', 'Firewall'],
  'Design':         ['UI/UX Design', 'Figma', 'Adobe XD', 'Photoshop', 'Canva'],
  'Networking':     ['Cisco Networking', 'CCNA', 'Linux', 'VPN', 'OSPF'],
};

// ── Shared Components ─────────────────────────────────────────────────────────

function RadioOption({ label, value, current, onSelect }: {
  label: string; value: string; current: string; onSelect: (v: string) => void;
}) {
  const active = current === value;
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition select-none ${
      active ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
    }`}>
      <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-[#166534]' : 'border-gray-300'}`}>
        {active && <div className="size-2 rounded-full bg-[#166534]" />}
      </div>
      <input type="radio" className="hidden" value={value} checked={active} onChange={() => onSelect(value)} />
      {label}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

// ── Component ─────────────────────────────────────────────────────────────────

export function AlumniUpdate() {
  const navigate = useNavigate();
  const rawUser = sessionStorage.getItem('alumni_user');
  const alumni = rawUser ? JSON.parse(rawUser) : VALID_ALUMNI[0];

  const sd = alumni.surveyData ?? {};

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [captureTime, setCaptureTime] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'employment' | 'skills' | 'biometric'>('employment');

  // Employment form state (CHED structure)
  const [empForm, setEmpForm] = useState({
    employmentStatus: sd.employmentStatus
      || (alumni.employmentStatus === 'employed' ? 'Yes' : alumni.employmentStatus === 'unemployed' ? 'No' : ''),
    timeToHire: sd.timeToHire || '',
    firstJobSector: sd.firstJobSector || '',
    firstJobStatus: sd.firstJobStatus || '',
    firstJobTitle: sd.firstJobTitle || alumni.jobTitle || '',
    firstJobRelated: sd.firstJobRelated || (alumni.jobAlignment === 'related' ? 'Yes' : alumni.jobAlignment === 'not-related' ? 'No' : ''),
    firstJobUnrelatedReason: sd.firstJobUnrelatedReason || '',
    firstJobUnrelatedOther: sd.firstJobUnrelatedOther || '',
    currentJobSector: sd.currentJobSector || '',
    currentJobPosition: sd.currentJobPosition || alumni.jobTitle || '',
    currentJobCompany: sd.currentJobCompany || alumni.company || '',
    currentJobLocation: sd.currentJobLocation || 'Local (Philippines)',
    currentJobRelated: sd.currentJobRelated || (alumni.jobAlignment === 'related' ? 'Yes' : ''),
    jobRetention: sd.jobRetention || '',
    jobSource: sd.jobSource || '',
    jobSourceOther: sd.jobSourceOther || '',
  });

  // Skills state
  const [selectedSkills, setSelectedSkills] = useState<string[]>(alumni.skills ?? []);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [showFirstJob, setShowFirstJob] = useState(true);

  useEffect(() => { return () => { stopCamera(); }; }, []);

  const setE = (key: string, value: string) => setEmpForm(f => ({ ...f, [key]: value }));

  const toggleSkill = (skill: string) => {
    setSelectedSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  // ── Camera helpers ──────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setCameraOn(true);
    } catch {
      setCameraError('Camera access denied or not available. Please allow camera permission.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx?.drawImage(videoRef.current, 0, 0);
    const img = canvasRef.current.toDataURL('image/jpeg', 0.8);
    setCapturedImage(img);
    setCaptureTime(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }));
    setCaptured(true);
    stopCamera();
    fetchGPS();
  };

  const fetchGPS = () => {
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });
        setGpsLoading(false);
      },
      () => {
        setGps({ lat: 10.7202, lng: 122.5621, accuracy: 150 });
        setGpsError('GPS unavailable — using simulated coordinates for demo.');
        setGpsLoading(false);
      },
      { timeout: 8000 }
    );
  };

  const retakePhoto = () => {
    setCaptured(false);
    setCapturedImage(null);
    setGps(null);
    setCaptureTime(null);
    startCamera();
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 1500));
    const updated = {
      ...alumni,
      employmentStatus: empForm.employmentStatus === 'Yes' ? 'employed' : 'unemployed',
      jobTitle: empForm.currentJobPosition || empForm.firstJobTitle || alumni.jobTitle,
      company: empForm.currentJobCompany || alumni.company,
      jobAlignment: empForm.currentJobRelated === 'Yes' ? 'related' : empForm.currentJobRelated === 'No' ? 'not-related' : alumni.jobAlignment,
      skills: selectedSkills,
      surveyData: { ...(alumni.surveyData ?? {}), ...empForm },
      biometricCaptured: captured || alumni.biometricCaptured,
      biometricDate: captured ? new Date().toISOString().split('T')[0] : alumni.biometricDate,
      dateUpdated: new Date().toISOString().split('T')[0],
      lat: gps?.lat ?? alumni.lat,
      lng: gps?.lng ?? alumni.lng,
    };
    sessionStorage.setItem('alumni_user', JSON.stringify(updated));
    setSaved(true);
    setIsSaving(false);
  };

  const SECTION_TABS = [
    { key: 'employment' as const, label: 'Employment', icon: Briefcase },
    { key: 'skills' as const,     label: 'Skills',      icon: Award },
    { key: 'biometric' as const,  label: 'Biometric',   icon: Camera },
  ];

  if (saved) {
    return (
      <PortalLayout role="alumni" pageTitle="Employment Update" pageSubtitle="Your profile has been updated">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center max-w-md">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 mx-auto mb-5">
              <CheckCircle2 className="size-9 text-emerald-500" />
            </div>
            <h2 className="text-gray-900 mb-2" style={{ fontWeight: 700, fontSize: '1.4rem' }}>Profile Updated!</h2>
            <p className="text-gray-500 text-sm mb-2">Your employment record has been saved{captured ? ' with biometric capture' : ''}.</p>
            {gps && <p className="text-gray-400 text-xs mb-6">GPS: {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</p>}
            <div className="flex gap-3">
              <button onClick={() => navigate('/alumni/dashboard')}
                className="flex-1 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
                style={{ fontWeight: 600 }}>
                Go to Dashboard
              </button>
              <button onClick={() => setSaved(false)}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 py-2.5 rounded-xl text-sm transition"
                style={{ fontWeight: 500 }}>
                Edit Again
              </button>
            </div>
          </div>
        </div>
      </PortalLayout>
    );
  }

  const isEmployed = empForm.employmentStatus === 'Yes';
  const hasEmployed = empForm.employmentStatus && empForm.employmentStatus !== 'Never Employed';
  const additionalSelected = selectedSkills.filter(s => !BSIS_CORE_SKILLS.includes(s));

  return (
    <PortalLayout role="alumni" pageTitle="Employment Update" pageSubtitle="Update your current status">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Section Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {SECTION_TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveSection(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition ${activeSection === tab.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              style={{ fontWeight: activeSection === tab.key ? 600 : 400 }}>
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Employment Section ── */}
        {activeSection === 'employment' && (
          <div className="space-y-4">

            {/* Q1: Status */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Briefcase className="size-4 text-[#166534]" /> 1. Employment Status
              </h3>
              <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                Are you presently employed?
              </label>
              <div className="flex flex-wrap gap-2">
                {['Yes', 'No', 'Never Employed'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt}
                    current={empForm.employmentStatus} onSelect={v => setE('employmentStatus', v)} />
                ))}
              </div>
            </div>

            {/* Q2: Time to hire */}
            {hasEmployed && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Clock className="size-4 text-[#166534]" /> 2. Job Acquisition Speed
                </h3>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  How long did it take to land your first job after graduation?
                </label>
                <div className="space-y-2">
                  {['Within 1 month','1-3 months','3-6 months','6 months to 1 year','Within 2 years','After 2 years'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt}
                      current={empForm.timeToHire} onSelect={v => setE('timeToHire', v)} />
                  ))}
                </div>
              </div>
            )}

            {/* Q3: First Job */}
            {hasEmployed && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <button type="button"
                  onClick={() => setShowFirstJob(v => !v)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition">
                  <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
                    <Building2 className="size-4 text-[#166534]" /> 3. First Job Details
                  </h3>
                  {showFirstJob ? <ChevronUp className="size-4 text-gray-400" /> : <ChevronDown className="size-4 text-gray-400" />}
                </button>
                {showFirstJob && (
                  <div className="px-6 pb-6 space-y-5 border-t border-gray-100 pt-4">
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Sector</label>
                      <div className="space-y-2">
                        {['Government','Private','Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={empForm.firstJobSector} onSelect={v => setE('firstJobSector', v)} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Status (First Job)</label>
                      <div className="space-y-2">
                        {['Regular/Permanent','Probationary','Contractual/Casual/Job Order'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={empForm.firstJobStatus} onSelect={v => setE('firstJobStatus', v)} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Job Title / Position</label>
                      <input type="text" placeholder="e.g. Junior Software Developer"
                        value={empForm.firstJobTitle} onChange={e => setE('firstJobTitle', e.target.value)}
                        className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Was this job related to your BSIS degree?</label>
                      <div className="flex gap-2">
                        {['Yes','No'].map(opt => (
                          <RadioOption key={opt} label={opt} value={opt}
                            current={empForm.firstJobRelated} onSelect={v => setE('firstJobRelated', v)} />
                        ))}
                      </div>
                    </div>
                    {empForm.firstJobRelated === 'No' && (
                      <div>
                        <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Reason for accepting unrelated job</label>
                        <div className="space-y-2">
                          {['Salary & Benefits','Career Challenge/Advancement','Proximity to Residence',
                            'Lack of related job openings at the time','Others'].map(opt => (
                            <RadioOption key={opt} label={opt} value={opt}
                              current={empForm.firstJobUnrelatedReason} onSelect={v => setE('firstJobUnrelatedReason', v)} />
                          ))}
                        </div>
                        {empForm.firstJobUnrelatedReason === 'Others' && (
                          <input type="text" placeholder="Please specify…"
                            value={empForm.firstJobUnrelatedOther} onChange={e => setE('firstJobUnrelatedOther', e.target.value)}
                            className={`${inputCls} mt-2`} />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Q4: Current Job */}
            {isEmployed && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-gray-800 mb-5 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <MapPin className="size-4 text-[#166534]" /> 4. Current Job Details
                </h3>
                <div className="space-y-5">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Employment Sector</label>
                    <div className="space-y-2">
                      {['Government','Private','Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt}
                          current={empForm.currentJobSector} onSelect={v => setE('currentJobSector', v)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Current Occupation / Position</label>
                    <input type="text" placeholder="e.g. Systems Analyst"
                      value={empForm.currentJobPosition} onChange={e => setE('currentJobPosition', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Name of Company / Organization</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                      <input type="text" placeholder="Company or organization name"
                        value={empForm.currentJobCompany} onChange={e => setE('currentJobCompany', e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Location of Employment</label>
                    <div className="space-y-2">
                      {['Local (Philippines)','Abroad / Remote Foreign Employer'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt}
                          current={empForm.currentJobLocation} onSelect={v => setE('currentJobLocation', v)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Is your current job related to your BSIS degree?</label>
                    <div className="flex gap-2">
                      {['Yes','No'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt}
                          current={empForm.currentJobRelated} onSelect={v => setE('currentJobRelated', v)} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Q5: Retention */}
            {hasEmployed && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Clock className="size-4 text-[#166534]" /> 5. Job Retention
                </h3>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  How long did you stay in your first job (or current role)?
                </label>
                <div className="space-y-2">
                  {['Less than 6 months','6 months to 1 year','1 to 2 years','2 years and above'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt}
                      current={empForm.jobRetention} onSelect={v => setE('jobRetention', v)} />
                  ))}
                </div>
              </div>
            )}

            {/* Q6: Source */}
            {hasEmployed && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Briefcase className="size-4 text-[#166534]" /> 6. Source of Job Opportunity
                </h3>
                <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                  Where did you find your first job opening?
                </label>
                <div className="space-y-2">
                  {['CHMSU Career Orientation / Job Fair',
                    'Online Job Portal (JobStreet, LinkedIn, etc.)',
                    'Personal Network / Referral',
                    'Company Walk-in / Direct Hire',
                    'Others'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt}
                      current={empForm.jobSource} onSelect={v => setE('jobSource', v)} />
                  ))}
                </div>
                {empForm.jobSource === 'Others' && (
                  <input type="text" placeholder="Please specify…"
                    value={empForm.jobSourceOther} onChange={e => setE('jobSourceOther', e.target.value)}
                    className={`${inputCls} mt-3`} />
                )}
              </div>
            )}

            <button onClick={() => setActiveSection('skills')}
              className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
              style={{ fontWeight: 600 }}>
              Next: Update Skills →
            </button>
          </div>
        )}

        {/* ── Skills Section ── */}
        {activeSection === 'skills' && (
          <div className="space-y-4">

            {/* BSIS Core Skills */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-gray-800" style={{ fontWeight: 700 }}>BSIS Program Skills</h3>
                  <p className="text-gray-500 text-xs mt-0.5">Check all skills you actively use in employment.</p>
                </div>
                <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
                  {selectedSkills.filter(s => BSIS_CORE_SKILLS.includes(s)).length}/{BSIS_CORE_SKILLS.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {BSIS_CORE_SKILLS.map(skill => {
                  const checked = selectedSkills.includes(skill);
                  return (
                    <button key={skill} onClick={() => toggleSkill(skill)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${
                        checked ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534]/30'
                      }`}>
                      <div className={`size-5 rounded border-2 flex items-center justify-center shrink-0 ${
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

            {/* Additional Skills Category Browser */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Additional Technical Skills</h3>
                {additionalSelected.length > 0 && (
                  <span className="text-xs text-[#166534] bg-[#166534]/10 px-2.5 py-1 rounded-full shrink-0 ml-2" style={{ fontWeight: 600 }}>
                    {additionalSelected.length}
                  </span>
                )}
              </div>
              <p className="text-gray-500 text-xs mb-4">Frameworks, tools, and certifications.</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.keys(ADDITIONAL_CATEGORIES).map(cat => (
                  <button key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition ${
                      activeCategory === cat ? 'bg-[#166534] border-[#166534] text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    style={{ fontWeight: activeCategory === cat ? 600 : 400 }}>
                    {cat}
                  </button>
                ))}
              </div>
              {activeCategory ? (
                <div className="flex flex-wrap gap-2">
                  {ADDITIONAL_CATEGORIES[activeCategory].map(skill => {
                    const isSelected = selectedSkills.includes(skill);
                    return (
                      <button key={skill} onClick={() => toggleSkill(skill)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition ${
                          isSelected ? 'bg-[#166534] border-[#166534] text-white' : 'border-gray-200 text-gray-700 hover:border-[#166534]/30 hover:bg-green-50'
                        }`}
                        style={{ fontWeight: isSelected ? 600 : 400 }}>
                        {isSelected ? <X className="size-3" /> : <Plus className="size-3" />}
                        {skill}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-3">Click a category to browse skills</p>
              )}
              {additionalSelected.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-gray-500 text-xs mb-2" style={{ fontWeight: 600 }}>Selected</p>
                  <div className="flex flex-wrap gap-2">
                    {additionalSelected.map(s => (
                      <span key={s} className="inline-flex items-center gap-1.5 bg-[#166534] text-white text-xs px-3 py-1.5 rounded-full" style={{ fontWeight: 500 }}>
                        {s}
                        <button onClick={() => toggleSkill(s)} className="hover:text-red-300 transition">
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setActiveSection('employment')}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 py-2.5 rounded-xl text-sm transition"
                style={{ fontWeight: 500 }}>
                Back
              </button>
              <button onClick={() => setActiveSection('biometric')}
                className="flex-1 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
                style={{ fontWeight: 600 }}>
                Next: Biometric →
              </button>
            </div>
          </div>
        )}

        {/* ── Biometric Section ── */}
        {activeSection === 'biometric' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
              <Camera className="size-5 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-green-800 text-sm" style={{ fontWeight: 600 }}>Biometric Capture</p>
                <p className="text-green-700 text-xs mt-0.5">Your face photo will be stamped with the current date, time, and GPS coordinates for identity verification compliance.</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Camera className="size-4 text-[#166534]" /> Face Capture
              </h3>

              <div className="relative bg-gray-900 rounded-xl overflow-hidden mb-4" style={{ aspectRatio: '4/3', maxHeight: '320px' }}>
                {!cameraOn && !captured && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Video className="size-12 text-gray-600 mb-3" />
                    <p className="text-gray-400 text-sm">Camera is off</p>
                  </div>
                )}
                <video ref={videoRef}
                  className={`w-full h-full object-cover ${(!cameraOn || captured) ? 'hidden' : ''}`}
                  playsInline muted autoPlay />
                {captured && capturedImage && (
                  <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                )}
                {cameraOn && !captured && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="size-40 rounded-full border-2 border-dashed border-white/50" />
                  </div>
                )}
                {gpsLoading && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 rounded-lg px-3 py-1.5">
                    <span className="size-3 border border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-white text-xs">Getting GPS…</span>
                  </div>
                )}
                {gps && !gpsLoading && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-lg px-3 py-1.5">
                    <MapPin className="size-3.5 text-emerald-400" />
                    <span className="text-white text-xs">{gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>
                  </div>
                )}
                {captured && captureTime && (
                  <div className="absolute top-3 right-3 bg-black/60 rounded-lg px-3 py-1.5">
                    <span className="text-white text-xs">{captureTime}</span>
                  </div>
                )}
              </div>

              {cameraError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-xs">{cameraError}</p>
                </div>
              )}
              {gpsError && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-amber-700 text-xs">{gpsError}</p>
                </div>
              )}

              <canvas ref={canvasRef} className="hidden" />

              <div className="flex gap-3">
                {!cameraOn && !captured && (
                  <button onClick={startCamera}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
                    style={{ fontWeight: 600 }}>
                    <Video className="size-4" /> Start Camera
                  </button>
                )}
                {cameraOn && !captured && (
                  <>
                    <button onClick={stopCamera}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition flex items-center gap-2"
                      style={{ fontWeight: 500 }}>
                      <VideoOff className="size-4" /> Cancel
                    </button>
                    <button onClick={capturePhoto}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm transition"
                      style={{ fontWeight: 600 }}>
                      <Camera className="size-4" /> Capture Photo
                    </button>
                  </>
                )}
                {captured && (
                  <button onClick={retakePhoto}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition flex items-center gap-2"
                    style={{ fontWeight: 500 }}>
                    <RefreshCw className="size-4" /> Retake
                  </button>
                )}
              </div>

              {captured && (
                <div className="mt-4 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-3">
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>Biometric captured successfully</p>
                    <p className="text-emerald-600 text-xs">
                      Timestamp: {captureTime} · GPS: {gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Fetching…'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setActiveSection('skills')}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 py-2.5 rounded-xl text-sm transition"
                style={{ fontWeight: 500 }}>
                Back
              </button>
              <button onClick={handleSave} disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm transition disabled:opacity-70"
                style={{ fontWeight: 600 }}>
                {isSaving
                  ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                  : <><Save className="size-4" /> Save All Changes</>}
              </button>
            </div>

            {!captured && (
              <p className="text-center text-gray-400 text-xs">
                You can save without biometric capture, but it is required for full verification compliance.
              </p>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
