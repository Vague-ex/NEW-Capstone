import { useEffect, useMemo, useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import {
  ApiClientError,
  fetchEmployerCandidates,
  updateEmployerDesiredSkills,
  type EmployerCandidate,
} from '../../app/api-client';
import { useReferenceData, type SkillItem } from '../../hooks/useReferenceData';
import {
  Search, AlertTriangle, GraduationCap, Mail, Github,
  Globe, Sparkles, Star, Filter, UserSearch, ExternalLink, Facebook,
  Pencil, X, Check, Heart,
} from 'lucide-react';

const SOFT_SKILL_PATTERN = /soft|communication|interpersonal|behaviou?ral|attitude/i;

const AVATAR_COLORS = ['#166534', '#15803d', '#14532d', '#16a34a', '#052e16'];

function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return (name || 'A')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

export function EmployerCandidates() {
  const employerId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      const raw = window.sessionStorage.getItem('employer_user');
      if (!raw) return '';
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return String(parsed.id ?? '');
    } catch {
      return '';
    }
  }, []);

  const [candidates, setCandidates] = useState<EmployerCandidate[]>([]);
  const [desiredSkillCount, setDesiredSkillCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchName, setSearchName] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [editingSkills, setEditingSkills] = useState(false);

  const refreshCandidates = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchEmployerCandidates();
      setCandidates(response.results);
      setDesiredSkillCount(response.desiredSkillCount);
      // Derive the current desired-skill IDs from the candidates' matchedSkillIds union
      // (server doesn't include the raw list on this endpoint). The modal seeds itself
      // from `EmployerAccountResponse.desiredSkills` when it opens, so this is just for
      // the count badge — a separate fetch would be wasteful.
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 401) {
          setError('Your employer session expired. Please sign in again.');
        } else if (err.status === 403) {
          setError(err.message || 'Your employer account must be approved by the BSIS Admin before browsing candidates.');
        } else {
          setError(err.message || 'Unable to load candidates right now.');
        }
      } else {
        setError('Unable to load candidates right now.');
      }
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!active) return;
      await refreshCandidates();
    };

    void load();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSkillsSaved = (newDesiredSkillIds: string[]) => {
    setDesiredSkillCount(newDesiredSkillIds.length);
    setEditingSkills(false);
    // Refresh candidates so match counts/highlights reflect the new preferences.
    void refreshCandidates();
  };

  const batchOptions = useMemo(() => {
    const years = new Set<number>();
    candidates.forEach((c) => {
      if (c.graduationYear) years.add(c.graduationYear);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [candidates]);

  const visibleCandidates = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    const yearFilter = batchFilter ? Number(batchFilter) : null;
    return candidates.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (yearFilter && c.graduationYear !== yearFilter) return false;
      if (matchedOnly && c.matchCount === 0) return false;
      return true;
    });
  }, [candidates, searchName, batchFilter, matchedOnly]);

  const inputCls =
    'w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <PortalLayout
      role="employer"
      pageTitle="View Graduates"
      pageSubtitle="Unemployed BSIS graduates ranked by how well their skills match your hiring needs"
    >
      <div className="space-y-5">
        {/* Header callout */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-5 text-white">
          <div className="flex items-start gap-3">
            <UserSearch className="size-5 text-green-200 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm" style={{ fontWeight: 700 }}>
                Candidate Pool
              </p>
              <p className="text-green-200 text-xs mt-0.5 leading-relaxed">
                Showing only <span className="text-white" style={{ fontWeight: 600 }}>unemployed</span> BSIS graduates.{' '}
                {desiredSkillCount === 0 ? (
                  <>You haven't picked any desired skills yet, so candidates are listed without skill matching.</>
                ) : (
                  <>Each card shows how many of your <span className="text-white" style={{ fontWeight: 600 }}>{desiredSkillCount} desired skill{desiredSkillCount !== 1 ? 's' : ''}</span> the graduate has — matched skills are highlighted.</>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingSkills(true)}
              disabled={!employerId}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs border border-white/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontWeight: 600 }}
            >
              <Pencil className="size-3.5" /> Edit Desired Skills
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-2.5">
            <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white appearance-none"
              >
                <option value="">All batches</option>
                {batchOptions.map((y) => (
                  <option key={y} value={y}>BSIS Batch {y}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={matchedOnly}
                onChange={(e) => setMatchedOnly(e.target.checked)}
                className="accent-[#166534]"
              />
              <span>Show only matches</span>
              {desiredSkillCount === 0 && (
                <span className="text-[10px] text-gray-400">(set desired skills first)</span>
              )}
            </label>
          </div>
        </div>

        {/* Cards */}
        {loading ? (
          <div className="text-center py-10 rounded-2xl border border-dashed border-gray-200 bg-white">
            <span className="inline-block size-6 border-2 border-[#166534]/20 border-t-[#166534] rounded-full animate-spin mb-2" />
            <p className="text-gray-500 text-sm">Loading candidates…</p>
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div className="text-center py-10 rounded-2xl border border-dashed border-gray-200 bg-white">
            <UserSearch className="size-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-700 text-sm" style={{ fontWeight: 600 }}>
              {candidates.length === 0
                ? 'No unemployed graduates in the pool right now.'
                : 'No candidates match your filters.'}
            </p>
            {candidates.length === 0 && (
              <p className="text-gray-400 text-xs mt-1">
                Check back later — alumni who update their employment status will appear here.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleCandidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        )}
      </div>

      {editingSkills && employerId && (
        <EditDesiredSkillsModal
          employerId={employerId}
          onClose={() => setEditingSkills(false)}
          onSaved={handleSkillsSaved}
        />
      )}
    </PortalLayout>
  );
}

// ── Edit Desired Skills modal ─────────────────────────────────────────────

function EditDesiredSkillsModal({
  employerId,
  onClose,
  onSaved,
}: {
  employerId: string;
  onClose: () => void;
  onSaved: (newSkillIds: string[]) => void;
}) {
  const { data: referenceData, loading: loadingReference } = useReferenceData();
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [selectedSoftIds, setSelectedSoftIds] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [seedLoading, setSeedLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Group skills like register-employer does.
  const { softSkills, technicalByCategory, technicalCount } = useMemo(() => {
    const soft: SkillItem[] = [];
    const techGroups: Record<string, SkillItem[]> = {};
    let total = 0;
    for (const skill of referenceData.skills) {
      if (!skill.is_active) continue;
      const cat = skill.category_name ?? '';
      if (SOFT_SKILL_PATTERN.test(cat) || SOFT_SKILL_PATTERN.test(skill.name)) {
        soft.push(skill);
      } else {
        const key = cat || 'Other';
        if (!techGroups[key]) techGroups[key] = [];
        techGroups[key].push(skill);
        total += 1;
      }
    }
    return { softSkills: soft, technicalByCategory: techGroups, technicalCount: total };
  }, [referenceData.skills]);

  // Seed selections from the employer's current desired-skills list.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(
          `${(typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || 'http://localhost:8000'}/api/auth/employer/account/${employerId}/`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!active) return;
        const desired = Array.isArray(data?.employer?.desiredSkills) ? data.employer.desiredSkills : [];
        const techIds: string[] = [];
        const softIds: string[] = [];
        for (const s of desired as Array<{ id: string; category: string | null; name: string }>) {
          const cat = s.category ?? '';
          if (SOFT_SKILL_PATTERN.test(cat) || SOFT_SKILL_PATTERN.test(s.name)) {
            softIds.push(s.id);
          } else {
            techIds.push(s.id);
          }
        }
        setSelectedTechIds(techIds);
        setSelectedSoftIds(softIds);
      } catch {
        // Defaults to empty selections — admin can re-pick from scratch.
      } finally {
        if (active) setSeedLoading(false);
      }
    })();
    return () => { active = false; };
  }, [employerId]);

  const toggleSkill = (id: string, group: 'tech' | 'soft') => {
    const setter = group === 'tech' ? setSelectedTechIds : setSelectedSoftIds;
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const merged = [...selectedTechIds, ...selectedSoftIds];
      await updateEmployerDesiredSkills(employerId, merged);
      onSaved(merged);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to save your desired skills right now.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] text-white px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-green-100 text-xs uppercase tracking-wide" style={{ fontWeight: 600 }}>
              Edit Preferences
            </p>
            <h2 className="text-base mt-0.5" style={{ fontWeight: 700 }}>Skills You're Hiring For</h2>
            <p className="text-green-100 text-xs mt-0.5">
              Updates take effect immediately on the candidate pool.
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {(loadingReference || seedLoading) ? (
            <p className="text-gray-400 text-sm text-center py-8">Loading skills…</p>
          ) : (
            <>
              {/* Technical */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-700 text-xs" style={{ fontWeight: 600 }}>
                    Technical skills
                  </p>
                  {selectedTechIds.length > 0 && (
                    <span className="text-[11px] text-[#166534]" style={{ fontWeight: 600 }}>
                      {selectedTechIds.length} selected
                    </span>
                  )}
                </div>
                {technicalCount === 0 ? (
                  <p className="text-gray-400 text-xs italic">No technical skills in the reference list yet.</p>
                ) : (
                  <div>
                    {/* Category tabs */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {Object.keys(technicalByCategory).sort().map((catName) => {
                        const inCategory = technicalByCategory[catName].filter((s) =>
                          selectedTechIds.includes(s.id),
                        ).length;
                        const isActive = activeCategory === catName;
                        return (
                          <button
                            key={catName}
                            type="button"
                            onClick={() => setActiveCategory(isActive ? null : catName)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition ${
                              isActive
                                ? 'bg-[#166534] border-[#166534] text-white'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                            style={{ fontWeight: isActive ? 600 : 400 }}
                          >
                            {catName}
                            {inCategory > 0 && (
                              <span
                                className={`text-[10px] px-1.5 rounded-full ${
                                  isActive ? 'bg-white/20' : 'bg-[#166534]/10 text-[#166534]'
                                }`}
                                style={{ fontWeight: 600 }}
                              >
                                {inCategory}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {activeCategory && technicalByCategory[activeCategory] ? (
                      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                        <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2" style={{ fontWeight: 600 }}>
                          {activeCategory}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {technicalByCategory[activeCategory].map((skill) => {
                            const selected = selectedTechIds.includes(skill.id);
                            return (
                              <button
                                key={skill.id}
                                type="button"
                                onClick={() => toggleSkill(skill.id, 'tech')}
                                className={`px-3 py-1.5 rounded-full text-xs border transition ${
                                  selected
                                    ? 'border-[#166534] bg-[#166534] text-white'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534] hover:text-[#166534]'
                                }`}
                                style={{ fontWeight: 500 }}
                              >
                                {skill.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-xs text-center py-3">Click a category above to browse skills</p>
                    )}
                  </div>
                )}
              </div>

              {/* Soft */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-700 text-xs flex items-center gap-1.5" style={{ fontWeight: 600 }}>
                    <Heart className="size-3.5 text-[#166534]" />
                    Soft skills
                  </p>
                  {selectedSoftIds.length > 0 && (
                    <span className="text-[11px] text-[#166534]" style={{ fontWeight: 600 }}>
                      {selectedSoftIds.length} selected
                    </span>
                  )}
                </div>
                {softSkills.length === 0 ? (
                  <p className="text-gray-400 text-xs italic">No soft skills in the reference list yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {softSkills.map((skill) => {
                      const selected = selectedSoftIds.includes(skill.id);
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => toggleSkill(skill.id, 'soft')}
                          className={`px-3 py-1.5 rounded-full text-xs border transition ${
                            selected
                              ? 'border-[#166534] bg-[#166534] text-white'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-[#166534] hover:text-[#166534]'
                          }`}
                          style={{ fontWeight: 500 }}
                        >
                          {skill.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            {selectedTechIds.length + selectedSoftIds.length} total skill{selectedTechIds.length + selectedSoftIds.length !== 1 ? 's' : ''} selected
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-60"
              style={{ fontWeight: 500 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loadingReference || seedLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#166534] hover:bg-[#14532d] text-white text-sm transition disabled:opacity-60"
              style={{ fontWeight: 600 }}
            >
              {saving ? (
                <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: EmployerCandidate }) {
  const matchedSet = new Set(candidate.matchedSkillIds);
  const techSkills = candidate.skills.filter((s) =>
    !/soft|communication|interpersonal|behaviou?ral|attitude/i.test(s.category ?? ''),
  );
  const softSkills = candidate.skills.filter((s) =>
    /soft|communication|interpersonal|behaviou?ral|attitude/i.test(s.category ?? ''),
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="size-12 rounded-xl flex items-center justify-center shrink-0 text-white"
            style={{ backgroundColor: avatarColor(candidate.name), fontWeight: 800, fontSize: '0.95rem', letterSpacing: '0.05em' }}
          >
            {initials(candidate.name)}
          </div>
          <div>
            <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>
              {candidate.name}
            </p>
            <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1">
              <GraduationCap className="size-3.5 text-gray-400" />
              {candidate.graduationYear ? `BSIS Batch ${candidate.graduationYear}` : 'Batch —'}
            </p>
          </div>
        </div>
        {candidate.matchCount > 0 ? (
          <span
            className="shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200"
            style={{ fontWeight: 700 }}
          >
            <Star className="size-3" /> {candidate.matchCount} match{candidate.matchCount !== 1 ? 'es' : ''}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500" style={{ fontWeight: 500 }}>
            No match
          </span>
        )}
      </div>

      {/* Skills */}
      <div className="space-y-2">
        {techSkills.length > 0 && (
          <SkillRow label="Technical" skills={techSkills} matchedSet={matchedSet} />
        )}
        {softSkills.length > 0 && (
          <SkillRow label="Soft" skills={softSkills} matchedSet={matchedSet} />
        )}
        {techSkills.length === 0 && softSkills.length === 0 && (
          <p className="text-gray-400 text-xs italic">Graduate hasn't listed any skills yet.</p>
        )}
      </div>

      {/* Contact / links */}
      <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-2">
        {candidate.email && (
          <a
            href={`mailto:${candidate.email}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 hover:border-[#166534] hover:text-[#166534] transition"
            style={{ fontWeight: 500 }}
          >
            <Mail className="size-3.5" /> Email
          </a>
        )}
        {candidate.facebookUrl && (
          <a
            href={candidate.facebookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 hover:border-[#166534] hover:text-[#166534] transition"
            style={{ fontWeight: 500 }}
          >
            <Facebook className="size-3.5" /> Facebook <ExternalLink className="size-3 text-gray-300" />
          </a>
        )}
        {candidate.githubUrl && (
          <a
            href={candidate.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 hover:border-[#166534] hover:text-[#166534] transition"
            style={{ fontWeight: 500 }}
          >
            <Github className="size-3.5" /> GitHub <ExternalLink className="size-3 text-gray-300" />
          </a>
        )}
        {candidate.portfolioUrl && (
          <a
            href={candidate.portfolioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 hover:border-[#166534] hover:text-[#166534] transition"
            style={{ fontWeight: 500 }}
          >
            <Globe className="size-3.5" /> Portfolio <ExternalLink className="size-3 text-gray-300" />
          </a>
        )}
        {!candidate.email
          && !candidate.facebookUrl
          && !candidate.githubUrl
          && !candidate.portfolioUrl && (
          <p className="text-gray-400 text-xs italic">No contact links shared yet.</p>
        )}
      </div>
    </div>
  );
}

function SkillRow({
  label,
  skills,
  matchedSet,
}: {
  label: string;
  skills: { id: string; name: string; category: string | null }[];
  matchedSet: Set<string>;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5 flex items-center gap-1" style={{ fontWeight: 600 }}>
        <Sparkles className="size-3 text-gray-400" /> {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {skills.map((s) => {
          const isMatch = matchedSet.has(s.id);
          return (
            <span
              key={s.id}
              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                isMatch
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-gray-50 text-gray-700 border-gray-200'
              }`}
              style={{ fontWeight: isMatch ? 700 : 500 }}
            >
              {isMatch && '★ '}
              {s.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
