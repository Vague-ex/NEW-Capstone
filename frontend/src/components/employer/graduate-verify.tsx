import { useEffect, useMemo, useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { GRADUATION_YEARS } from '../../data/app-data';
import {
  ApiClientError,
  fetchEmployerAccountStatus,
  fetchEmployerVerifiableGraduates,
  type EmployerVerifiableGraduateResponse,
  issueVerificationToken,
  submitVerificationDecision,
} from '../../app/api-client';
import { useReferenceData } from '../../hooks/useReferenceData';
import {
  Search, User, Calendar, CheckCircle2, XCircle, AlertTriangle,
  Briefcase, MapPin, Building2, Shield, Clock, Star,
  MessageSquare, ThumbsUp, Send, ChevronRight, X,
} from 'lucide-react';

type Graduate = EmployerVerifiableGraduateResponse;

// ── Helpers ────────────────────────────────────────────────────────────────────

function companiesMatch(empCompany: string, gradCompany: string): boolean {
  if (!empCompany || !gradCompany) return false;
  const e = empCompany.toLowerCase().trim();
  const g = gradCompany.toLowerCase().trim();
  if (e.includes(g) || g.includes(e)) return true;
  const stopWords = new Set(['philippines', 'corp', 'corporation', 'inc', 'ltd', 'co', 'company', 'ph', 'the', 'and', 'of']);
  const eWords = e.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
  const gWords = g.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
  return eWords.some(ew => gWords.some(gw => ew.includes(gw) || gw.includes(ew)));
}

const AVATAR_COLORS = ['#166534', '#15803d', '#14532d', '#16a34a', '#052e16'];
function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function GraduateAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'size-14' : size === 'sm' ? 'size-9' : 'size-11';
  const txt = size === 'lg' ? '1.1rem' : size === 'sm' ? '0.7rem' : '0.9rem';
  return (
    <div
      className={`${sz} rounded-xl flex items-center justify-center shrink-0 text-white`}
      style={{ backgroundColor: avatarColor(name), fontWeight: 800, fontSize: txt, letterSpacing: '0.05em' }}
    >
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }: { status: Graduate['employmentStatus'] }) {
  const cfgMap: Record<string, { cls: string; dot: string; label: string }> = {
    employed: { cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', label: 'Employed' },
    'self-employed': { cls: 'bg-green-100 text-green-700', dot: 'bg-green-500', label: 'Self-Employed' },
    unemployed: { cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', label: 'Not Employed' },
  };
  const cfg = cfgMap[status ?? ''] ?? { cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', label: 'Unknown' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${cfg.cls}`} style={{ fontWeight: 600 }}>
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function GraduateCard({ graduate, onSelect, isSelected }: { graduate: Graduate; onSelect: (g: Graduate) => void; isSelected: boolean }) {
  return (
    <div
      onClick={() => onSelect(graduate)}
      className={`group cursor-pointer rounded-2xl border transition p-4 ${isSelected
        ? 'border-[#166534] bg-[#166534]/5 shadow-md'
        : 'border-gray-200 bg-white hover:border-[#166534]/40 hover:shadow-sm'
        }`}
    >
      <div className="flex items-start gap-3">
        <GraduateAvatar name={graduate.name ?? ''} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-gray-900 truncate" style={{ fontWeight: 700 }}>{graduate.name}</p>
              <p className="text-gray-500 text-xs mt-0.5">BSIS Batch {graduate.graduationYear}</p>
            </div>
            <ChevronRight className={`size-4 shrink-0 mt-0.5 transition ${isSelected ? 'text-[#166534]' : 'text-gray-300 group-hover:text-[#166534]'}`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusBadge status={graduate.employmentStatus} />
            {graduate.verificationStatus === 'verified' && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700" style={{ fontWeight: 600 }}>
                <CheckCircle2 className="size-3" /> Verified
              </span>
            )}
          </div>
          {graduate.jobTitle && graduate.company && (
            <p className="text-gray-500 text-xs mt-2 flex items-center gap-1">
              <Briefcase className="size-3 shrink-0" />
              <span className="truncate">{graduate.jobTitle} · {graduate.company}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function GraduateVerify() {
  const [employer, setEmployer] = useState<Record<string, unknown>>(() => {
    const rawUser = sessionStorage.getItem('employer_user');
    return rawUser ? JSON.parse(rawUser) : { company: 'Accenture Philippines' };
  });
  const { data: referenceData } = useReferenceData();

  const employerId = String(employer?.id ?? '').trim();
  const employerCompany = String(employer?.company ?? employer?.companyName ?? 'Accenture Philippines');
  const isPendingEmployer = String(employer?.status ?? '').toLowerCase() === 'pending';

  useEffect(() => {
    if (!employerId) {
      return;
    }

    let active = true;

    const syncEmployerStatus = async () => {
      try {
        const latest = await fetchEmployerAccountStatus(employerId);
        if (!active || !latest || Object.keys(latest).length === 0) {
          return;
        }

        setEmployer((current) => {
          const normalizedStatus = String(
            latest.status
            ?? latest.accountStatus
            ?? current.status
            ?? '',
          ).toLowerCase();

          const normalizedCompany = String(
            latest.company
            ?? latest.companyName
            ?? current.company
            ?? current.companyName
            ?? 'Accenture Philippines',
          );

          const merged = {
            ...current,
            ...latest,
            company: normalizedCompany,
            status: normalizedStatus,
          };

          sessionStorage.setItem('employer_user', JSON.stringify(merged));
          return merged;
        });
      } catch {
        // Keep session state when live account-status sync is temporarily unavailable.
      }
    };

    const handleFocus = () => {
      void syncEmployerStatus();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncEmployerStatus();
      }
    };

    void syncEmployerStatus();
    const intervalId = window.setInterval(() => {
      void syncEmployerStatus();
    }, 30000);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [employerId]);

  const [companyGraduates, setCompanyGraduates] = useState<Graduate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [loadError, setLoadError] = useState('');

  const yearOptions = useMemo(() => {
    const years = Array.from(
      new Set(
        companyGraduates
          .map((graduate) => Number(graduate.graduationYear))
          .filter((year) => Number.isInteger(year) && year > 0),
      ),
    )
      .sort((a, b) => b - a);

    return years.length > 0 ? years : GRADUATION_YEARS;
  }, [companyGraduates]);

  useEffect(() => {
    let active = true;

    const loadCandidates = async () => {
      setLoadingCandidates(true);
      setLoadError('');
      try {
        const records = await fetchEmployerVerifiableGraduates();
        if (!active) return;
        setCompanyGraduates(
          records.filter((graduate) =>
            companiesMatch(
              employerCompany,
              String(graduate.company ?? ''),
            ),
          ),
        );
      } catch (err) {
        if (!active) return;

        if (err instanceof ApiClientError) {
          if (err.status === 401) {
            setLoadError('Your employer session expired. Please sign in again.');
          } else if (err.status === 403) {
            setLoadError(err.message || 'Your account cannot access graduate verification at this time.');
          } else {
            setLoadError(err.message || 'Unable to load graduates right now.');
          }
        } else {
          setLoadError('Unable to load graduates right now.');
        }

        setCompanyGraduates([]);
      } finally {
        if (active) {
          setLoadingCandidates(false);
        }
      }
    };

    void loadCandidates();
    return () => {
      active = false;
    };
  }, [employerCompany]);

  // Name search
  const [searchName, setSearchName] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<Graduate[]>([]);

  // Selected graduate for endorsement
  const [selectedGraduate, setSelectedGraduate] = useState<Graduate | null>(null);

  // Endorsement state
  const [endorsement, setEndorsement] = useState('');
  const [confirmEmployment, setConfirmEmployment] = useState(false);
  const [endorsementSent, setEndorsementSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSubmitWasHeld, setLastSubmitWasHeld] = useState(false);
  const [lastSubmitMessage, setLastSubmitMessage] = useState('');
  const [verifiedJobTitleId, setVerifiedJobTitleId] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchName.trim()) return;
    setIsSearching(true);
    setSearched(false);
    setSearchResults([]);

    const normalizedQuery = searchName.toLowerCase().trim();
    const selectedYear = searchYear ? Number(searchYear) : null;
    const results = companyGraduates.filter((graduate) =>
      String(graduate.name ?? '').toLowerCase().includes(normalizedQuery) &&
      (selectedYear ? Number(graduate.graduationYear) === selectedYear : true)
    );

    setSearchResults(results);
    setSearched(true);
    setIsSearching(false);
  };

  const handleSelectGraduate = (grad: Graduate) => {
    const nextGraduate = selectedGraduate?.id === grad.id ? null : grad;
    setSelectedGraduate(nextGraduate);
    setVerifiedJobTitleId(nextGraduate ? String(nextGraduate.jobTitleId ?? '') : '');
    setEndorsement('');
    setConfirmEmployment(false);
    setEndorsementSent(false);
    setSaveError('');
    setLastSubmitWasHeld(false);
    setLastSubmitMessage('');
  };

  const handleSendEndorsement = async () => {
    if (!selectedGraduate) return;
    if (!confirmEmployment) {
      setSaveError('Please confirm employment before submitting verification.');
      return;
    }

    const alumniId = String(selectedGraduate.id ?? '').trim();
    if (!alumniId) {
      setSaveError('This graduate record is missing an ID required for verification.');
      return;
    }

    setSaveError('');
    setIsSending(true);

    try {
      const issued = await issueVerificationToken({ alumni_id: alumniId });
      const tokenId = String(issued.token?.id ?? '').trim();

      if (!tokenId) {
        throw new Error('Verification token was not returned by the server.');
      }

      const decisionResult = await submitVerificationDecision(tokenId, {
        decision: 'confirm',
        comment: endorsement.trim() || undefined,
        verified_employer_name: employerCompany.trim() || undefined,
        verified_job_title_id: verifiedJobTitleId.trim() || undefined,
      });

      const held = Boolean(decisionResult.decision?.isHeld);
      setLastSubmitWasHeld(held);
      setLastSubmitMessage(String(decisionResult.message ?? '').trim());
      setEndorsementSent(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 401) {
          setSaveError('Your employer session expired. Please sign in again.');
        } else if (err.status === 403) {
          setSaveError(err.message || 'Your account cannot submit verification at this time.');
        } else if (err.status === 404) {
          setSaveError('Graduate employment record was not found for verification.');
        } else {
          setSaveError(err.message || 'Unable to submit verification right now.');
        }
      } else {
        setSaveError(err instanceof Error ? err.message : 'Unable to submit verification right now.');
      }
      setEndorsementSent(false);
    } finally {
      setIsSending(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <PortalLayout role="employer" pageTitle="Graduate Verification" pageSubtitle="Find and endorse BSIS graduates at your company">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Info banner */}
        <div className="bg-gradient-to-r from-[#166534] to-[#15803d] rounded-2xl p-5 text-white">
          <div className="flex items-start gap-3">
            <Shield className="size-5 text-green-200 shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-sm" style={{ fontWeight: 700 }}>Secure Graduate Verification</p>
              <p className="text-green-200 text-xs mt-0.5 leading-relaxed">
                Search by name to verify a CHMSU Talisay BSIS graduate. Graduates who listed
                <span className="text-white" style={{ fontWeight: 600 }}> {employerCompany} </span>
                in their employment survey are shown automatically below.
              </p>
            </div>
          </div>
        </div>

        {isPendingEmployer && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-800 text-sm" style={{ fontWeight: 700 }}>
                  Pending account hold mode
                </p>
                <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
                  Verification submissions made from this account are saved on hold and will only take effect
                  after the admin verifies your employer account.
                </p>
              </div>
            </div>
          </div>
        )}

        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs leading-relaxed">{saveError}</p>
            </div>
          </div>
        )}

        {/* ── Graduates at Your Company ─────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="size-4 text-[#166534]" />
            <h3 className="text-gray-800" style={{ fontWeight: 700 }}>
              Graduates at {employerCompany}
            </h3>
          </div>
          <p className="text-gray-500 text-xs mb-4">
            These graduates listed your company in their employment survey responses.
          </p>

          {loadingCandidates ? (
            <div className="text-center py-8 rounded-xl border border-dashed border-gray-200">
              <span className="inline-block size-6 border-2 border-[#166534]/20 border-t-[#166534] rounded-full animate-spin mb-2" />
              <p className="text-gray-500 text-sm">Loading graduates…</p>
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-red-700 text-sm" style={{ fontWeight: 600 }}>Unable to load company-matched graduates.</p>
              <p className="text-red-600 text-xs mt-1">{loadError}</p>
            </div>
          ) : companyGraduates.length === 0 ? (
            <div className="text-center py-8 rounded-xl border border-dashed border-gray-200">
              <Building2 className="size-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">No graduates have listed your company yet.</p>
              <p className="text-gray-300 text-xs mt-1">Use the search below to find and verify individual graduates.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {companyGraduates.map(grad => (
                <GraduateCard
                  key={grad.id}
                  graduate={grad}
                  onSelect={handleSelectGraduate}
                  isSelected={selectedGraduate?.id === grad.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Search by Name ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Search className="size-4 text-[#166534]" /> Search Graduate by Name
          </h3>

          <form onSubmit={handleSearch} className="space-y-3">
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="e.g. Maria Santos"
                  value={searchName}
                  onChange={e => setSearchName(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                Graduation Year <span className="text-gray-400" style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <select value={searchYear} onChange={e => setSearchYear(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white appearance-none">
                  <option value="">Any graduation year</option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" disabled={isSearching || !searchName.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition disabled:opacity-60"
              style={{ fontWeight: 600 }}>
              {isSearching
                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Searching…</>
                : <><Search className="size-4" /> Search Graduate</>
              }
            </button>
          </form>

          {/* Search Results */}
          {searched && (
            <div className="mt-4">
              {searchResults.length === 0 ? (
                <div className="rounded-xl border border-gray-100 p-6 text-center">
                  <XCircle className="size-8 text-red-300 mx-auto mb-2" />
                  <p className="text-gray-700 text-sm" style={{ fontWeight: 600 }}>No graduate found</p>
                  <p className="text-gray-400 text-xs mt-1">
                    No BSIS graduate matches "{searchName}". Check the spelling or contact the CHMSU BSIS Admin.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs" style={{ fontWeight: 600 }}>
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                  </p>
                  {searchResults.map(grad => (
                    <GraduateCard
                      key={grad.id}
                      graduate={grad}
                      onSelect={handleSelectGraduate}
                      isSelected={selectedGraduate?.id === grad.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Selected Graduate Detail + Endorsement ───────────────────── */}
        {selectedGraduate && (
          <div className="space-y-4">
            {/* Graduate detail card */}
            <div className="bg-white rounded-2xl border border-[#166534]/30 shadow-sm overflow-hidden">
              <div className="bg-[#166534]/5 border-b border-[#166534]/10 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <GraduateAvatar name={selectedGraduate.name ?? ''} size="lg" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                          {selectedGraduate.name}
                        </p>
                        <StatusBadge status={selectedGraduate.employmentStatus} />
                      </div>
                      <p className="text-gray-500 text-xs">BSIS Batch {selectedGraduate.graduationYear} · CHMSU Talisay</p>
                      {selectedGraduate.verificationStatus === 'verified' && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 mt-1" style={{ fontWeight: 500 }}>
                          <CheckCircle2 className="size-3.5" /> Identity Verified by BSIS Admin
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => { setSelectedGraduate(null); setVerifiedJobTitleId(''); }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-400">
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-gray-400 shrink-0" />
                  <p className="text-gray-700 text-sm">
                    <span style={{ fontWeight: 600 }}>BSIS Graduate — Verified</span> on CHMSU Talisay official records
                  </p>
                </div>
                {selectedGraduate.jobTitle && selectedGraduate.company && (
                  <div className="flex items-center gap-2">
                    <Briefcase className="size-4 text-gray-400 shrink-0" />
                    <p className="text-gray-700 text-sm">
                      {selectedGraduate.jobTitle} at <span style={{ fontWeight: 600 }}>{selectedGraduate.company}</span>
                    </p>
                  </div>
                )}
                {selectedGraduate.industry && (
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-gray-400 shrink-0" />
                    <p className="text-gray-700 text-sm">Industry: <span style={{ fontWeight: 600 }}>{selectedGraduate.industry}</span></p>
                  </div>
                )}
                {selectedGraduate.workLocation && (
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-gray-400 shrink-0" />
                    <p className="text-gray-700 text-sm">{selectedGraduate.workLocation}</p>
                  </div>
                )}
                {selectedGraduate.jobAlignment && (
                  <div className="flex items-center gap-2">
                    <Star className="size-4 text-gray-400 shrink-0" />
                    <p className="text-gray-700 text-sm flex items-center gap-1.5">
                      {selectedGraduate.jobAlignment === 'related'
                        ? <><CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" /> Role is directly related to BSIS degree</>
                        : <><AlertTriangle className="size-3.5 text-amber-500 shrink-0" /> Role is not directly related to BSIS degree</>
                      }
                    </p>
                  </div>
                )}
                {selectedGraduate.skills && selectedGraduate.skills.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Star className="size-4 text-gray-400 shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {selectedGraduate.skills.map(s => (
                        <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-gray-400 shrink-0" />
                  <p className="text-gray-400 text-xs">
                    Last updated: {selectedGraduate.dateUpdated ? new Date(selectedGraduate.dateUpdated).toLocaleDateString('en-PH', { dateStyle: 'long' }) : '—'}
                  </p>
                </div>
                {selectedGraduate.biometricCaptured && (
                  <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2">
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                    <p className="text-emerald-700 text-xs" style={{ fontWeight: 500 }}>Biometric identity verified with GPS timestamp</p>
                  </div>
                )}
                <p className="text-gray-400 text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 text-gray-400 shrink-0 mt-0.5" />
                  Disclosure limited to employment status. Full records protected under RA 10173. Contact CHMSU BSIS BSIS Admin for official documentation.
                </p>
              </div>
            </div>

            {/* Employment Confirmation & Endorsement */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-1 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <MessageSquare className="size-4 text-[#166534]" /> Employment Confirmation & Endorsement
              </h3>
              <p className="text-gray-500 text-xs mb-5">
                As <span style={{ fontWeight: 600 }}>{employerCompany}</span>, confirm this graduate's employment and leave an endorsement visible on their profile.
              </p>

              {endorsementSent ? (
                <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>
                      {lastSubmitWasHeld ? 'Submission saved on hold!' : 'Endorsement submitted!'}
                    </p>
                    <p className="text-emerald-600 text-xs mt-0.5">
                      {lastSubmitWasHeld ? (
                        <>
                          Your verification for <span style={{ fontWeight: 600 }}>{selectedGraduate.name}</span> is recorded and
                          will be applied once the admin approves your employer account.
                        </>
                      ) : (
                        <>
                          Your confirmation and endorsement for <span style={{ fontWeight: 600 }}>{selectedGraduate.name}</span> has been recorded on their profile.
                        </>
                      )}
                    </p>
                    {lastSubmitMessage && (
                      <p className="text-emerald-700 text-xs mt-1" style={{ fontWeight: 600 }}>{lastSubmitMessage}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition">
                    <input
                      type="checkbox"
                      checked={confirmEmployment}
                      onChange={e => setConfirmEmployment(e.target.checked)}
                      className="mt-0.5 accent-[#166534]"
                    />
                    <div>
                      <p className="text-gray-800 text-sm" style={{ fontWeight: 600 }}>
                        <ThumbsUp className="size-3.5 inline mr-1 text-[#166534]" />
                        Confirm {selectedGraduate.name} is / was employed at {employerCompany}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        This officially confirms their employment record on the CHMSU Graduate Tracer system.
                      </p>
                    </div>
                  </label>

                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Verified Job Title <span className="text-gray-400" style={{ fontWeight: 400 }}>(optional)</span>
                    </label>
                    <select
                      value={verifiedJobTitleId}
                      onChange={(e) => setVerifiedJobTitleId(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                    >
                      <option value="">Use current record title ({selectedGraduate.jobTitle || 'Not specified'})</option>
                      {referenceData.job_titles.map((jobTitle) => (
                        <option key={jobTitle.id} value={jobTitle.id}>{jobTitle.name}</option>
                      ))}
                    </select>
                    <p className="text-gray-400 text-xs mt-1">
                      Choose a standardized title to store on the verified employment record.
                    </p>
                  </div>

                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Employer Endorsement <span className="text-gray-400" style={{ fontWeight: 400 }}>(optional)</span>
                    </label>
                    <textarea
                      value={endorsement}
                      onChange={e => setEndorsement(e.target.value)}
                      rows={3}
                      placeholder={`e.g. "${(selectedGraduate.name ?? '').split(' ')[0]} demonstrated excellent technical skills and professionalism during their time at ${employerCompany}. Highly recommended."`}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white resize-none"
                    />
                    <p className="text-gray-400 text-xs mt-1">This will be visible on the graduate's profile as an employer endorsement.</p>
                  </div>

                  <button
                    onClick={handleSendEndorsement}
                    disabled={isSending || !confirmEmployment}
                    className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-60"
                    style={{ fontWeight: 600 }}>
                    {isSending
                      ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting…</>
                      : <><Send className="size-4" /> Submit Endorsement</>
                    }
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </PortalLayout>
  );
}