import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI } from '../../data/app-data';
import { updateAlumniEmployment } from '../../app/api-client';
import { useReferenceData } from '../../hooks/useReferenceData';
import {
  Briefcase, CheckCircle2, Clock, Save, Building2,
  MapPin, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Shared Components ─────────────────────────────────────────────────────────

function RadioOption({ label, value, current, onSelect }: {
  label: string; value: string; current: string; onSelect: (v: string) => void;
}) {
  const active = current === value;
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition select-none ${active ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
      }`}>
      <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-[#166534]' : 'border-gray-300'}`}>
        {active && <div className="size-2 rounded-full bg-[#166534]" />}
      </div>
      <input type="radio" className="hidden" value={value} checked={active} onChange={() => onSelect(value)} />
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

const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

// ── Component ─────────────────────────────────────────────────────────────────

export function AlumniEmployment() {
  const { data: referenceData } = useReferenceData();
  const rawUser = sessionStorage.getItem('alumni_user');
  const alumni = rawUser ? JSON.parse(rawUser) : VALID_ALUMNI[0];
  const alumniId = String(alumni?.id ?? '');
  const isVerified = (alumni.verificationStatus ?? 'pending') === 'verified';
  const isPending = !isVerified;

  const sd = alumni.surveyData ?? {};

  const [form, setForm] = useState({
    employmentStatus: sd.employmentStatus
      || ((alumni.employmentStatus === 'employed' || alumni.employmentStatus === 'self-employed') ? 'Yes' : alumni.employmentStatus === 'unemployed' ? 'No' : ''),
    timeToHire: sd.timeToHire || (alumni.monthsToHire
      ? alumni.monthsToHire <= 1 ? 'Within 1 month'
        : alumni.monthsToHire <= 3 ? '1-3 months'
          : alumni.monthsToHire <= 6 ? '3-6 months'
            : '6 months to 1 year'
      : ''),
    firstJobSector: sd.firstJobSector || '',
    firstJobStatus: sd.firstJobStatus || '',
    firstJobTitle: sd.firstJobTitle || alumni.jobTitle || '',
    firstJobRelated: sd.firstJobRelated || (alumni.jobAlignment === 'related' ? 'Yes' : alumni.jobAlignment === 'not-related' ? 'No' : ''),
    firstJobUnrelatedReason: sd.firstJobUnrelatedReason || '',
    firstJobUnrelatedOther: sd.firstJobUnrelatedOther || '',
    currentJobSector: sd.currentJobSector || '',
    currentJobTitleId: sd.currentJobTitleId || alumni.jobTitleId || '',
    currentJobPosition: sd.currentJobPosition || alumni.jobTitle || '',
    currentJobCompany: sd.currentJobCompany || alumni.company || '',
    currentJobLocation: sd.currentJobLocation || (alumni.workLocation?.toLowerCase().includes('abroad') ? 'Abroad / Remote Foreign Employer' : 'Local (Philippines)'),
    currentJobRegionId: sd.currentJobRegionId || alumni.regionId || '',
    currentJobRelated: sd.currentJobRelated || (alumni.jobAlignment === 'related' ? 'Yes' : alumni.jobAlignment === 'not-related' ? 'No' : ''),
    jobRetention: sd.jobRetention || '',
    jobSource: sd.jobSource || '',
    jobSourceOther: sd.jobSourceOther || '',
    unemploymentReason: sd.unemploymentReason || '',
    unemploymentReasonOther: sd.unemploymentReasonOther || '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [employerLinkStatus, setEmployerLinkStatus] = useState('');
  const [showFirstJob, setShowFirstJob] = useState(true);

  const employerPortalLink = typeof window === 'undefined'
    ? '/employer'
    : `${window.location.origin}/employer`;

  const setF = (key: string, value: string) => {
    setSaved(false);
    setSaveError('');
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleShareEmployerPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(employerPortalLink);
      setEmployerLinkStatus('Employer Portal link copied. You may now share it with your employer.');
    } catch {
      setEmployerLinkStatus('Copy not available in this browser. Please share the link shown below manually.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError('');

    const sectorText = `${form.currentJobSector} ${form.firstJobSector}`.toLowerCase();
    const selfEmploymentDetected = form.employmentStatus === 'Yes' && (
      sectorText.includes('self-employed') ||
      sectorText.includes('self employed') ||
      sectorText.includes('freelance') ||
      sectorText.includes('entrepreneurial')
    );

    const normalizedEmploymentStatus = form.employmentStatus === 'Yes'
      ? (selfEmploymentDetected ? 'self-employed' : 'employed')
      : 'unemployed';

    const resolvedUnemploymentReason = form.unemploymentReason === 'Others'
      ? (form.unemploymentReasonOther || 'Others')
      : form.unemploymentReason;

    const matchedJobTitleById = referenceData.job_titles.find(
      jt => jt.id === form.currentJobTitleId,
    );
    const matchedJobTitleByName = referenceData.job_titles.find(
      jt => jt.name.toLowerCase() === form.currentJobPosition.trim().toLowerCase(),
    );
    const resolvedJobTitleId = (
      matchedJobTitleById?.id
      || matchedJobTitleByName?.id
      || String(form.currentJobTitleId || '').trim()
      || String(alumni.jobTitleId || '').trim()
      || undefined
    );
    const resolvedRegionId = (
      String(form.currentJobRegionId || '').trim()
      || String(alumni.regionId || '').trim()
      || undefined
    );

    const surveyDataPayload = {
      ...(alumni.surveyData ?? {}),
      ...form,
      unemploymentReason: resolvedUnemploymentReason,
      currentJobTitleId: resolvedJobTitleId || '',
      currentJobRegionId: resolvedRegionId || '',
    };

    try {
      let serverAlumni: Record<string, unknown> = {};
      if (alumniId) {
        const response = await updateAlumniEmployment(alumniId, {
          employment_status: normalizedEmploymentStatus,
          survey_data: surveyDataPayload,
          job_title_id: resolvedJobTitleId,
          region_id: resolvedRegionId,
        });
        if (response.alumni && typeof response.alumni === 'object') {
          serverAlumni = response.alumni as Record<string, unknown>;
        }
      }

      const updated = {
        ...alumni,
        ...serverAlumni,
        employmentStatus: normalizedEmploymentStatus,
        jobTitle: form.currentJobPosition || form.firstJobTitle || alumni.jobTitle,
        company: form.currentJobCompany || alumni.company,
        jobAlignment: form.currentJobRelated === 'Yes' ? 'related' : form.currentJobRelated === 'No' ? 'not-related' : alumni.jobAlignment,
        workLocation: form.currentJobLocation === 'Abroad / Remote Foreign Employer' ? 'Abroad' : 'Local (Philippines)',
        jobTitleId: resolvedJobTitleId || alumni.jobTitleId,
        regionId: resolvedRegionId || alumni.regionId,
        unemploymentReason: resolvedUnemploymentReason,
        surveyData: surveyDataPayload,
        dateUpdated: new Date().toISOString().split('T')[0],
      };

      sessionStorage.setItem('alumni_user', JSON.stringify(updated));
      setSaved(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save employment data right now.';
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  // ── CHED Employment Form — open to ALL graduates (pending + verified) ───────
  const isEmployed = form.employmentStatus === 'Yes';
  const hasEmployed = form.employmentStatus && form.employmentStatus !== 'Never Employed';

  return (
    <PortalLayout role="alumni" pageTitle="Employment Details" pageSubtitle="Part III — CHED Graduate Tracer Survey Employment Data">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Pending notice — visible only while awaiting verification */}
        {isPending && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <Clock className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-800 text-sm" style={{ fontWeight: 700 }}>Account pending verification</p>
              <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
                You can update and save your employment data at any time.
                Your information will <span style={{ fontWeight: 700 }}>not appear in analytics or reports</span> until
                the Program Chair approves your account.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">

          {/* Q1: Employment Status */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Briefcase className="size-4 text-[#166534]" /> 1. Employment Status
            </h3>
            <FieldLabel>Are you presently employed?</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {['Yes', 'No', 'Never Employed'].map(opt => (
                <RadioOption key={opt} label={opt} value={opt}
                  current={form.employmentStatus} onSelect={v => setF('employmentStatus', v)} />
              ))}
            </div>
          </div>

          {/* Q2: Time to Hire */}
          {hasEmployed && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Clock className="size-4 text-[#166534]" /> 2. Job Acquisition Speed
              </h3>
              <FieldLabel>How long did it take to land your first job after graduation?</FieldLabel>
              <div className="space-y-2">
                {['Within 1 month', '1-3 months', '3-6 months', '6 months to 1 year', 'Within 2 years', 'After 2 years'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt}
                    current={form.timeToHire} onSelect={v => setF('timeToHire', v)} />
                ))}
              </div>
            </div>
          )}

          {/* Q3: First Job */}
          {hasEmployed && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button type="button" onClick={() => setShowFirstJob(v => !v)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition">
                <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
                  <Building2 className="size-4 text-[#166534]" /> 3. First Job Details
                </h3>
                {showFirstJob ? <ChevronUp className="size-4 text-gray-400" /> : <ChevronDown className="size-4 text-gray-400" />}
              </button>

              {showFirstJob && (
                <div className="px-6 pb-6 space-y-5 border-t border-gray-100">
                  <div className="pt-4">
                    <FieldLabel>Employment Sector</FieldLabel>
                    <div className="space-y-2">
                      {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt}
                          current={form.firstJobSector} onSelect={v => setF('firstJobSector', v)} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Employment Status (First Job)</FieldLabel>
                    <div className="space-y-2">
                      {['Regular/Permanent', 'Probationary', 'Contractual/Casual/Job Order'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt}
                          current={form.firstJobStatus} onSelect={v => setF('firstJobStatus', v)} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Job Title / Position</FieldLabel>
                    <input type="text" placeholder="e.g. Junior Software Developer"
                      value={form.firstJobTitle} onChange={e => setF('firstJobTitle', e.target.value)}
                      className={inputCls} />
                  </div>

                  <div>
                    <FieldLabel>Is/Was this first job related to your BSIS degree?</FieldLabel>
                    <div className="flex gap-2">
                      {['Yes', 'No'].map(opt => (
                        <RadioOption key={opt} label={opt} value={opt}
                          current={form.firstJobRelated} onSelect={v => setF('firstJobRelated', v)} />
                      ))}
                    </div>
                  </div>

                  {form.firstJobRelated === 'No' && (
                    <div>
                      <FieldLabel>Primary reason for accepting unrelated job</FieldLabel>
                      <div className="space-y-2">
                        {['Salary & Benefits', 'Career Challenge/Advancement', 'Proximity to Residence',
                          'Lack of related job openings at the time', 'Others'].map(opt => (
                            <RadioOption key={opt} label={opt} value={opt}
                              current={form.firstJobUnrelatedReason} onSelect={v => setF('firstJobUnrelatedReason', v)} />
                          ))}
                      </div>
                      {form.firstJobUnrelatedReason === 'Others' && (
                        <input type="text" placeholder="Please specify…"
                          value={form.firstJobUnrelatedOther} onChange={e => setF('firstJobUnrelatedOther', e.target.value)}
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
                  <FieldLabel>Employment Sector</FieldLabel>
                  <div className="space-y-2">
                    {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                      <RadioOption key={opt} label={opt} value={opt}
                        current={form.currentJobSector} onSelect={v => setF('currentJobSector', v)} />
                    ))}
                  </div>
                </div>

                <div>
                  <FieldLabel>Current Occupation / Position</FieldLabel>
                  <select
                    value={form.currentJobTitleId}
                    onChange={e => {
                      const selectedId = e.target.value;
                      const selectedTitle = referenceData.job_titles.find(jt => jt.id === selectedId);
                      setForm(f => ({
                        ...f,
                        currentJobTitleId: selectedId,
                        currentJobPosition: selectedTitle ? selectedTitle.name : f.currentJobPosition,
                      }));
                      setSaved(false);
                      setSaveError('');
                    }}
                    className={`${inputCls} mb-2`}
                  >
                    <option value="">Select suggested job title (optional)</option>
                    {referenceData.job_titles.map(jt => (
                      <option key={jt.id} value={jt.id}>{jt.name}</option>
                    ))}
                  </select>
                  <input type="text" placeholder="e.g. Systems Analyst"
                    value={form.currentJobPosition} onChange={e => setF('currentJobPosition', e.target.value)}
                    className={inputCls} />
                </div>

                <div>
                  <FieldLabel>Name of Company / Organization</FieldLabel>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input type="text" placeholder="Company or organization name"
                      value={form.currentJobCompany} onChange={e => setF('currentJobCompany', e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white" />
                  </div>
                </div>

                <div>
                  <FieldLabel>Location of Employment</FieldLabel>
                  <div className="space-y-2">
                    {['Local (Philippines)', 'Abroad / Remote Foreign Employer'].map(opt => (
                      <RadioOption key={opt} label={opt} value={opt}
                        current={form.currentJobLocation} onSelect={v => setF('currentJobLocation', v)} />
                    ))}
                  </div>
                </div>

                <div>
                  <FieldLabel>Region (Optional, for local employment mapping)</FieldLabel>
                  <select
                    value={form.currentJobRegionId}
                    onChange={e => setF('currentJobRegionId', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select region...</option>
                    {referenceData.regions.map(region => (
                      <option key={region.id} value={region.id}>
                        {region.code} - {region.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <FieldLabel>Is your current job related to your BSIS degree?</FieldLabel>
                  <div className="flex gap-2">
                    {['Yes', 'No'].map(opt => (
                      <RadioOption key={opt} label={opt} value={opt}
                        current={form.currentJobRelated} onSelect={v => setF('currentJobRelated', v)} />
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-emerald-900 text-xs leading-relaxed" style={{ fontWeight: 600 }}>
                    To verify your workplace and employment details, please share this Employer Portal link with your supervisor or authorized HR representative.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={handleShareEmployerPortalLink}
                      className="inline-flex items-center justify-center rounded-lg bg-[#166534] px-3.5 py-2 text-xs text-white transition hover:bg-[#14532d]"
                      style={{ fontWeight: 600 }}
                    >
                      Give Employer Portal Link
                    </button>
                    {employerLinkStatus && (
                      <p className="text-[11px] text-emerald-700">{employerLinkStatus}</p>
                    )}
                  </div>
                  <p className="mt-2 break-all text-[11px] text-emerald-700">{employerPortalLink}</p>
                </div>
              </div>
            </div>
          )}

          {/* Q5: Job Retention */}
          {hasEmployed && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Clock className="size-4 text-[#166534]" /> 5. Job Retention
              </h3>
              <FieldLabel>How long did you stay in your first job (or current role)?</FieldLabel>
              <div className="space-y-2">
                {['Less than 6 months', '6 months to 1 year', '1 to 2 years', '2 years and above'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt}
                    current={form.jobRetention} onSelect={v => setF('jobRetention', v)} />
                ))}
              </div>
            </div>
          )}

          {/* Q6: Source of Job */}
          {hasEmployed && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Briefcase className="size-4 text-[#166534]" /> 6. Source of Job Opportunity
              </h3>
              <FieldLabel>Where did you find your first job opening?</FieldLabel>
              <div className="space-y-2">
                {[
                  'CHMSU Career Orientation / Job Fair',
                  'Online Job Portal (JobStreet, LinkedIn, etc.)',
                  'Personal Network / Referral',
                  'Company Walk-in / Direct Hire',
                  'Others',
                ].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt}
                    current={form.jobSource} onSelect={v => setF('jobSource', v)} />
                ))}
              </div>
              {form.jobSource === 'Others' && (
                <input type="text" placeholder="Please specify…"
                  value={form.jobSourceOther} onChange={e => setF('jobSourceOther', e.target.value)}
                  className={`${inputCls} mt-3`} />
              )}
            </div>
          )}

          {/* Unemployment reason */}
          {form.employmentStatus === 'No' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <AlertTriangle className="size-4 text-amber-500" /> Unemployment Details
              </h3>
              <FieldLabel>Reason for not being employed</FieldLabel>
              <div className="space-y-2">
                {[
                  'Currently pursuing further studies',
                  'Unable to find related job',
                  'Family concern / Personal reasons',
                  'Health reasons',
                  'Awaiting job opportunity',
                  'Others',
                ].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt}
                    current={form.unemploymentReason} onSelect={v => setF('unemploymentReason', v)} />
                ))}
              </div>
              {form.unemploymentReason === 'Others' && (
                <input type="text" placeholder="Please specify…"
                  value={form.unemploymentReasonOther} onChange={e => setF('unemploymentReasonOther', e.target.value)}
                  className={`${inputCls} mt-3`} />
              )}
            </div>
          )}

          {/* Save */}
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
