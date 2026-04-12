import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircle, GraduationCap, ChevronDown, Eye, EyeOff, Info } from 'lucide-react';
import { VALID_ALUMNI, GRADUATION_YEARS } from '../data/app-data';
import { ImageWithFallback } from './figma/ImageWithFallback';

export function VerificationGate() {
  const navigate = useNavigate();
  const [studentId, setStudentId] = useState('');
  const [graduationYear, setGraduationYear] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showHints, setShowHints] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!studentId.trim()) {
      setError('Please enter your Student ID.');
      return;
    }
    if (!graduationYear) {
      setError('Please select your Graduation Year.');
      return;
    }

    setIsLoading(true);

    await new Promise((r) => setTimeout(r, 1200));

    const found = VALID_ALUMNI.find(
      (a) =>
        a.studentId.toLowerCase() === studentId.trim().toLowerCase() &&
        a.graduationYear === parseInt(graduationYear),
    );

    if (found) {
      sessionStorage.setItem('verified_alumni', JSON.stringify(found));
      navigate('/profile');
    } else {
      setError(
        'No matching record found. Please verify your Student ID and Graduation Year. Contact your Program Chair if you believe this is an error.',
      );
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel — Hero */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between overflow-hidden">
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1613688365965-8abc666fe1e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx1bml2ZXJzaXR5JTIwY2FtcHVzJTIwUGhpbGlwcGluZXMlMjBncmFkdWF0aW9uJTIwY2VyZW1vbnl8ZW58MXx8fHwxNzcyNjM2NDg1fDA&ixlib=rb-4.1.0&q=80&w=1080"
          alt="CHMSU campus"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#052e16]/90 via-[#166534]/85 to-[#052e16]/75" />

        {/* Content */}
        <div className="relative z-10 p-10">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
              <GraduationCap className="size-6 text-white" />
            </div>
            <div>
              <p className="text-white/90 text-sm tracking-widest uppercase">CHMSU Talisay</p>
              <p className="text-white/60 text-xs">College of Computing Studies</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 p-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 backdrop-blur-sm">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/90 text-sm">AACCUP Accreditation Monitoring</span>
          </div>
          <h1 className="text-4xl text-white mb-4" style={{ fontWeight: 700 }}>
            BSIS Alumni<br />Employability Portal
          </h1>
          <p className="text-white/70 text-base leading-relaxed max-w-sm">
            Track and monitor the career outcomes of BSIS graduates to support
            institutional quality assurance and program improvement.
          </p>

          {/* Stats strip */}
          <div className="mt-8 grid grid-cols-3 gap-4">
            {[
              { value: '25+', label: 'Registered Alumni' },
              { value: '82%', label: 'Employment Rate' },
              { value: '6', label: 'Batch Years' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-white/10 backdrop-blur-sm p-4 text-center">
                <p className="text-2xl text-white" style={{ fontWeight: 700 }}>{s.value}</p>
                <p className="text-white/60 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel — Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center bg-gray-50 px-6 py-12">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]">
            <GraduationCap className="size-5 text-white" />
          </div>
          <div>
            <p className="text-[#166534] text-sm" style={{ fontWeight: 600 }}>CHMSU Talisay</p>
            <p className="text-gray-500 text-xs">BSIS Alumni Portal</p>
          </div>
        </div>

        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex size-12 items-center justify-center rounded-xl bg-[#166534]/10 mb-4">
                <GraduationCap className="size-6 text-[#166534]" />
              </div>
              <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.5rem' }}>
                Identity Verification
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Enter your BSIS student credentials to access your alumni profile.
              </p>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3.5">
                <AlertCircle className="size-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-5">
              {/* Student ID */}
              <div>
                <label className="block text-gray-700 text-sm mb-1.5" htmlFor="studentId">
                  Student ID <span className="text-red-500">*</span>
                </label>
                <input
                  id="studentId"
                  type="text"
                  placeholder="e.g. BSIS-2023-001"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-900 placeholder-gray-400 text-sm outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                />
              </div>

              {/* Graduation Year */}
              <div>
                <label className="block text-gray-700 text-sm mb-1.5" htmlFor="gradYear">
                  Graduation Year <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    id="gradYear"
                    value={graduationYear}
                    onChange={(e) => setGraduationYear(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                  >
                    <option value="">Select graduation year</option>
                    {GRADUATION_YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-[#166534] py-2.5 text-white text-sm transition hover:bg-[#14532d] active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed"
                style={{ fontWeight: 600 }}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying…
                  </span>
                ) : (
                  'Verify & Continue'
                )}
              </button>
            </form>

            {/* Hints */}
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowHints(!showHints)}
                className="flex items-center gap-1.5 text-[#166534] text-xs hover:underline"
              >
                <Info className="size-3.5" />
                {showHints ? 'Hide demo credentials' : 'Show demo credentials'}
                {showHints ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </button>
              {showHints && (
                <div className="mt-3 rounded-lg bg-green-50 border border-green-100 p-3 text-xs text-green-800 space-y-1">
                  <p className="font-medium mb-1.5">Demo credentials (try any):</p>
                  {[
                    { id: 'BSIS-2023-001', year: '2023' },
                    { id: 'BSIS-2022-004', year: '2022' },
                    { id: 'BSIS-2021-002', year: '2021' },
                  ].map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between cursor-pointer hover:bg-green-100 rounded px-2 py-1"
                      onClick={() => {
                        setStudentId(c.id);
                        setGraduationYear(c.year);
                        setShowHints(false);
                      }}
                    >
                      <span>{c.id}</span>
                      <span className="text-green-600">Year: {c.year}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Admin link */}
          <p className="text-center text-gray-400 text-xs mt-5">
            Program Chair?{' '}
            <button
              type="button"
              onClick={() => navigate('/admin/login')}
              className="text-[#166534] hover:underline"
              style={{ fontWeight: 500 }}
            >
              Access Admin Dashboard →
            </button>
          </p>
          <p className="text-center text-gray-400 text-xs mt-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-[#166534] hover:underline"
              style={{ fontWeight: 500 }}
            >
              ← Return to Home
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}