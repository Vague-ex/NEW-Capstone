import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import { StatCard } from '../shared/stat-card';
import {
  Briefcase, Calendar, Clock, Star,
  CheckCircle2, AlertTriangle, Camera, Award, ArrowRight,
  Hash, ShieldCheck, Lock, UserCircle,
} from 'lucide-react';
import { VALID_ALUMNI } from '../../data/app-data';
import { fetchAlumniAccountStatus } from '../../app/api-client';

export function AlumniDashboard() {
  const navigate = useNavigate();
  const rawUser = sessionStorage.getItem('alumni_user');
  const [alumni, setAlumni] = useState(() => rawUser ? JSON.parse(rawUser) : (VALID_ALUMNI[0] ?? {}));
  const alumniId = String(alumni?.id ?? '');

  useEffect(() => {
    if (!alumniId) {
      return;
    }

    let active = true;
    const syncAlumniStatus = async () => {
      try {
        const latest = await fetchAlumniAccountStatus(alumniId);
        if (!active || !latest || Object.keys(latest).length === 0) {
          return;
        }

        setAlumni((current: Record<string, unknown>) => {
          const merged = { ...current, ...latest };
          sessionStorage.setItem('alumni_user', JSON.stringify(merged));
          return merged;
        });
      } catch {
        // Keep existing session data when status sync is temporarily unavailable.
      }
    };

    void syncAlumniStatus();
    return () => {
      active = false;
    };
  }, [alumniId]);

  const isVerified = (alumni.verificationStatus ?? 'pending') === 'verified';
  const isPending = (alumni.verificationStatus ?? 'pending') === 'pending';

  const statusColor = {
    employed: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Employed' },
    'self-employed': { bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500', label: 'Self-Employed' },
    unemployed: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400', label: 'Unemployed' },
  }[alumni.employmentStatus] ?? { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400', label: 'Unknown' };

  const batchPeers = VALID_ALUMNI.filter(a => a.graduationYear === alumni.graduationYear);
  const batchEmployed = batchPeers.filter(a => a.employmentStatus !== 'unemployed').length;
  const batchRate = batchPeers.length ? Math.round((batchEmployed / batchPeers.length) * 100) : 0;

  const daysSinceUpdate = Math.floor(
    (new Date().getTime() - new Date(alumni.dateUpdated || Date.now()).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <PortalLayout role="alumni" pageTitle="Alumni Dashboard" pageSubtitle={`Welcome back, ${alumni.name?.split(' ')[0] ?? 'Alumni'}!`}>
      <div className="space-y-6">

        {/* ── Profile Banner ── */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-6 text-white relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-48 opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 100% 50%, white 0%, transparent 70%)' }} />
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Avatar */}
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white/20 text-white shrink-0"
              style={{ fontWeight: 700, fontSize: '1.4rem' }}>
              {alumni.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2) ?? 'AL'}
            </div>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-white" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{alumni.name}</h2>
                {/* Verification badge */}
                {isVerified ? (
                  <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs px-2.5 py-1 rounded-full" style={{ fontWeight: 600 }}>
                    <ShieldCheck className="size-3.5" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs px-2.5 py-1 rounded-full" style={{ fontWeight: 600 }}>
                    <Clock className="size-3.5 animate-pulse" /> Pending Verification
                  </span>
                )}
                {/* Employment badge */}
                <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full ${statusColor.bg} ${statusColor.text}`} style={{ fontWeight: 600 }}>
                  <span className={`size-1.5 rounded-full ${statusColor.dot}`} />
                  {statusColor.label}
                </span>
              </div>
              <p className="text-white/60 text-sm flex items-center gap-2">
                <Hash className="size-3.5" /> {alumni.schoolId ?? alumni.studentId}
                <span className="text-white/30">·</span>
                BSIS Batch {alumni.graduationYear}
              </p>
              {alumni.jobTitle && alumni.company && (
                <p className="text-white/50 text-xs mt-1">{alumni.jobTitle} @ {alumni.company}</p>
              )}
            </div>

            <div className="flex flex-col sm:items-end gap-2 shrink-0">
              <button onClick={() => navigate('/alumni/skills')}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs px-3 py-2 rounded-lg transition"
                style={{ fontWeight: 600 }}>
                <Star className="size-3.5" /> Manage Skills
              </button>
              <button onClick={() => navigate('/alumni/profile')}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs px-3 py-2 rounded-lg transition"
                style={{ fontWeight: 600 }}>
                <UserCircle className="size-3.5" /> Edit Profile
              </button>
              <button onClick={() => navigate('/alumni/employment')}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs px-3 py-2 rounded-lg transition"
                style={{ fontWeight: 600 }}>
                <Briefcase className="size-3.5" /> Update Employment
              </button>
            </div>
          </div>
        </div>

        {/* ── Pending Verification Alert ── */}
        {isPending && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <Clock className="size-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-amber-800 text-sm" style={{ fontWeight: 600 }}>Awaiting BSIS Admin Verification</p>
              <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
                Your account is being reviewed. The BSIS Admin will verify your identity and biometric submission.
                Once approved, your Employment Details section will be unlocked.
              </p>
            </div>
          </div>
        )}

        {/* ── No Biometric Alert ── */}
        {!alumni.biometricCaptured && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <Camera className="size-5 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-red-800 text-sm" style={{ fontWeight: 600 }}>Biometric capture missing</p>
              <p className="text-red-700 text-xs mt-0.5">No face capture on file. This is required for identity verification.</p>
            </div>
          </div>
        )}

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Verification Status"
            value={isVerified ? 'Verified' : 'Pending'}
            sub={isVerified ? 'BSIS Admin approved' : 'Awaiting review'}
            icon={isVerified ? CheckCircle2 : Clock}
            iconBg={isVerified ? 'bg-emerald-50' : 'bg-amber-50'}
            iconColor={isVerified ? 'text-emerald-600' : 'text-amber-600'}
          />
          <StatCard
            label="Employment Status"
            value={statusColor.label}
            sub={alumni.company ?? 'Not currently employed'}
            icon={Briefcase}
            iconBg={alumni.employmentStatus === 'employed' ? 'bg-emerald-50' : alumni.employmentStatus === 'self-employed' ? 'bg-teal-50' : 'bg-gray-50'}
            iconColor={alumni.employmentStatus === 'employed' ? 'text-emerald-600' : alumni.employmentStatus === 'self-employed' ? 'text-teal-600' : 'text-gray-500'}
          />
          <StatCard
            label="Batch Employment Rate"
            value={`${batchRate}%`}
            sub={`${batchEmployed} of ${batchPeers.length} · Batch ${alumni.graduationYear}`}
            icon={Award}
            iconBg="bg-green-50"
            iconColor="text-green-700"
            trend={batchRate >= 80 ? '↑ Good' : '↓ Below avg'}
            trendUp={batchRate >= 80}
          />
          <StatCard
            label="Last Updated"
            value={new Date(alumni.dateUpdated || Date.now()).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
            sub={daysSinceUpdate > 30 ? `${daysSinceUpdate} days ago` : 'Recently updated'}
            icon={Calendar}
            iconBg="bg-slate-50"
            iconColor="text-slate-600"
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Employment Detail */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Briefcase className="size-4 text-[#166534]" /> Current Employment Record
              {!isVerified && <Lock className="size-3.5 text-gray-400 ml-auto" />}
            </h3>
            {isVerified ? (
              <div className="grid grid-cols-2 gap-4">
                {(() => {
                  const sd = (alumni.surveyData ?? {}) as Record<string, unknown>;
                  const rawAlignment = alumni.jobAlignment ?? (
                    sd.currentJobRelated === 'Yes, directly related (IT/IS role)' ? 'related' :
                    sd.currentJobRelated === 'Not related (different field)' ? 'not-related' : undefined
                  );
                  return [
                    { label: 'Employment Status', value: statusColor.label },
                    { label: 'Job Title', value: (alumni.jobTitle ?? sd.currentJobPosition ?? '—') as string },
                    { label: 'Company / Organization', value: (alumni.company ?? sd.currentJobCompany ?? '—') as string },
                    { label: 'Industry', value: (alumni.industry ?? '—') as string },
                    { label: 'Job Alignment', value: rawAlignment === 'related' ? '✅ Related to BSIS' : rawAlignment === 'not-related' ? '❌ Not BSIS-related' : '—' },
                    { label: 'Work Location', value: (alumni.workLocation ?? '—') as string },
                  ];
                })().map(row => (
                  <div key={row.label}>
                    <p className="text-gray-400 text-xs mb-0.5">{row.label}</p>
                    <p className="text-gray-800 text-sm" style={{ fontWeight: 500 }}>{row.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Lock className="size-10 text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm" style={{ fontWeight: 600 }}>Locked until verified</p>
                <p className="text-gray-400 text-xs mt-1 max-w-xs">
                  Employment details will be available once the BSIS Admin verifies your account.
                </p>
              </div>
            )}
            {isVerified && (
              <button onClick={() => navigate('/alumni/employment')}
                className="mt-5 flex items-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white text-xs px-4 py-2 rounded-lg transition"
                style={{ fontWeight: 600 }}>
                Update Employment Record →
              </button>
            )}
          </div>

          {/* Biometric + Skills */}
          <div className="space-y-4">
            {/* Biometric Status */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-gray-800 mb-3 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Camera className="size-4 text-[#166534]" /> Biometric Status
              </h3>
              {alumni.biometricCaptured ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="size-5 text-emerald-500" />
                    <span className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>Captured</span>
                  </div>
                  <p className="text-gray-400 text-xs">{alumni.biometricDate ?? alumni.dateUpdated}</p>
                  <p className="text-gray-400 text-xs mt-0.5">GPS stamp included ✓</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="size-5 text-red-400" />
                    <span className="text-red-600 text-sm" style={{ fontWeight: 600 }}>Not captured</span>
                  </div>
                  <p className="text-gray-400 text-xs">Required for verification.</p>
                </div>
              )}
            </div>

            {/* Skills */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Star className="size-4 text-[#166534]" /> My Skills
                </h3>
                <button onClick={() => navigate('/alumni/skills')}
                  className="text-[#166534] text-xs hover:underline flex items-center gap-1" style={{ fontWeight: 500 }}>
                  Edit <ArrowRight className="size-3" />
                </button>
              </div>
              {alumni.skills && alumni.skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {alumni.skills.slice(0, 6).map((skill: string) => (
                    <span key={skill} className="bg-[#166534]/10 text-[#166534] text-xs px-2.5 py-1 rounded-full border border-[#166534]/15"
                      style={{ fontWeight: 500 }}>
                      {skill}
                    </span>
                  ))}
                  {alumni.skills.length > 6 && (
                    <span className="text-gray-400 text-xs px-2 py-1">+{alumni.skills.length - 6} more</span>
                  )}
                </div>
              ) : (
                <div className="text-center py-3">
                  <p className="text-gray-400 text-xs">No skills added yet</p>
                  <button onClick={() => navigate('/alumni/skills')}
                    className="mt-2 text-[#166534] text-xs hover:underline" style={{ fontWeight: 500 }}>
                    Add Skills →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </PortalLayout>
  );
}