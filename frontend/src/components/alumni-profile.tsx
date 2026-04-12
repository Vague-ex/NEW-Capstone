import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, GraduationCap, LogOut, Save, ChevronDown, User } from 'lucide-react';
import { INDUSTRIES, UNEMPLOYMENT_REASONS, type AlumniRecord, type EmploymentStatus } from '../data/app-data';
import { StatusBadge } from './ui/status-badge';

export function AlumniProfile() {
  const navigate = useNavigate();
  const [alumni, setAlumni] = useState<AlumniRecord | null>(null);
  const [saved, setSaved] = useState(false);

  // Form state
  const [status, setStatus] = useState<EmploymentStatus | ''>('');
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [industry, setIndustry] = useState('');
  const [jobAlignment, setJobAlignment] = useState<'related' | 'not-related' | ''>('');
  const [workLocation, setWorkLocation] = useState('');
  const [unemploymentReason, setUnemploymentReason] = useState('');

  useEffect(() => {
    const data = sessionStorage.getItem('verified_alumni');
    if (!data) {
      navigate('/');
      return;
    }
    const record: AlumniRecord = JSON.parse(data);
    setAlumni(record);
    setStatus(record.employmentStatus || '');
    setJobTitle(record.jobTitle || '');
    setCompany(record.company || '');
    setIndustry(record.industry || '');
    setJobAlignment(record.jobAlignment || '');
    setWorkLocation(record.workLocation || '');
    setUnemploymentReason(record.unemploymentReason || '');
  }, [navigate]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, this would call an API
    setSaved(true);
    setTimeout(() => setSaved(false), 3500);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('verified_alumni');
    navigate('/');
  };

  if (!alumni) return null;

  const isEmployed = status === 'employed' || status === 'self-employed';
  const isUnemployed = status === 'unemployed';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <header className="bg-[#166534] shadow-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-white/20">
              <GraduationCap className="size-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <p className="text-white text-sm" style={{ fontWeight: 600 }}>CHMSU Talisay</p>
              <p className="text-white/60 text-xs -mt-0.5">BSIS Alumni Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
              <User className="size-3.5 text-white/70" />
              <span className="text-white/90 text-xs" style={{ fontWeight: 500 }}>{alumni.name}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-white/70 hover:text-white text-xs transition"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Welcome Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-[#166534] to-[#15803d] p-6 mb-6 text-white shadow-lg">
          <p className="text-white/70 text-sm">Welcome back,</p>
          <h1 className="mt-0.5 text-2xl" style={{ fontWeight: 700 }}>{alumni.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/80">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-white/50" />
              Student ID: <span style={{ fontWeight: 600 }} className="text-white">{alumni.studentId}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-white/50" />
              Batch: <span style={{ fontWeight: 600 }} className="text-white">{alumni.graduationYear}</span>
            </span>
            {status && (
              <StatusBadge status={status as EmploymentStatus} size="sm" />
            )}
          </div>
          {alumni.dateUpdated && (
            <p className="mt-3 text-white/50 text-xs">
              Last updated: {new Date(alumni.dateUpdated).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          )}
        </div>

        {/* Success Banner */}
        {saved && (
          <div className="mb-5 flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 shadow-sm">
            <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>Profile saved successfully!</p>
              <p className="text-emerald-600 text-xs">Your employment information has been updated.</p>
            </div>
          </div>
        )}

        {/* Profile Form */}
        <form onSubmit={handleSave}>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
            <h2 className="text-gray-800 mb-1" style={{ fontWeight: 600, fontSize: '1rem' }}>
              Employment Status
            </h2>
            <p className="text-gray-400 text-sm mb-5">Select your current employment situation.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  {
                    value: 'employed',
                    label: 'Employed',
                    desc: 'Working for a company or organization',
                    color: 'emerald',
                  },
                  {
                    value: 'self-employed',
                    label: 'Self-Employed',
                    desc: 'Running own business or freelancing',
                    color: 'blue',
                  },
                  {
                    value: 'unemployed',
                    label: 'Unemployed',
                    desc: 'Currently not working',
                    color: 'orange',
                  },
                ] as const
              ).map((opt) => {
                const selected = status === opt.value;
                const borderCls =
                  selected
                    ? opt.color === 'emerald'
                      ? 'border-emerald-500 bg-emerald-50'
                      : opt.color === 'blue'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300';
                const dotCls =
                  selected
                    ? opt.color === 'emerald'
                      ? 'border-emerald-500 bg-emerald-500'
                      : opt.color === 'blue'
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-orange-500 bg-orange-500'
                    : 'border-gray-300';
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 p-4 transition ${borderCls}`}
                  >
                    <input
                      type="radio"
                      name="status"
                      value={opt.value}
                      checked={status === opt.value}
                      onChange={() => setStatus(opt.value)}
                      className="sr-only"
                    />
                    <div
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition ${dotCls}`}
                    >
                      {selected && <span className="size-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className="text-gray-800 text-sm" style={{ fontWeight: 600 }}>{opt.label}</p>
                      <p className="text-gray-400 text-xs mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Employed / Self-Employed Section */}
          {isEmployed && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="size-2 rounded-full bg-emerald-500" />
                <h2 className="text-gray-800" style={{ fontWeight: 600, fontSize: '1rem' }}>
                  Employment Details
                </h2>
              </div>
              <p className="text-gray-400 text-sm mb-5">Provide information about your current position.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-600 text-sm mb-1.5">
                    Job Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Software Developer"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 text-sm mb-1.5">
                    Company / Organization <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Accenture Philippines"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 text-sm mb-1.5">
                    Industry
                  </label>
                  <div className="relative">
                    <select
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10 focus:bg-white"
                    >
                      <option value="">Select industry</option>
                      {INDUSTRIES.map((i) => (
                        <option key={i} value={i}>{i}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-gray-600 text-sm mb-1.5">
                    Work Location
                  </label>
                  <input
                    type="text"
                    value={workLocation}
                    onChange={(e) => setWorkLocation(e.target.value)}
                    placeholder="e.g. Bacolod City, Negros Occidental"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10 focus:bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-gray-600 text-sm mb-2">
                    Job Alignment with BSIS Program
                  </label>
                  <div className="flex gap-3">
                    {([
                      { value: 'related', label: 'Related to BSIS', color: 'blue' },
                      { value: 'not-related', label: 'Not Related', color: 'gray' },
                    ] as const).map((opt) => {
                      const selected = jobAlignment === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2.5 text-sm transition ${
                            selected
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="jobAlignment"
                            value={opt.value}
                            checked={selected}
                            onChange={() => setJobAlignment(opt.value)}
                            className="sr-only"
                          />
                          <span
                            className={`size-3.5 rounded-full border-2 flex items-center justify-center ${
                              selected ? 'border-blue-500' : 'border-gray-300'
                            }`}
                          >
                            {selected && <span className="size-1.5 rounded-full bg-blue-500" />}
                          </span>
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Unemployed Section */}
          {isUnemployed && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="size-2 rounded-full bg-orange-500" />
                <h2 className="text-gray-800" style={{ fontWeight: 600, fontSize: '1rem' }}>
                  Unemployment Information
                </h2>
              </div>
              <p className="text-gray-400 text-sm mb-5">This information is optional but helps improve program support.</p>

              <div>
                <label className="block text-gray-600 text-sm mb-1.5">
                  Reason for Unemployment <span className="text-gray-400">(Optional)</span>
                </label>
                <div className="relative">
                  <select
                    value={unemploymentReason}
                    onChange={(e) => setUnemploymentReason(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10 focus:bg-white"
                  >
                    <option value="">Select a reason</option>
                    {UNEMPLOYMENT_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                </div>
              </div>
            </div>
          )}

          {/* Save Button */}
          <button
            type="submit"
            disabled={!status}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#166534] px-6 py-3 text-white text-sm transition hover:bg-[#14532d] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            style={{ fontWeight: 600 }}
          >
            <Save className="size-4" />
            Save Profile
          </button>
        </form>
      </main>
    </div>
  );
}