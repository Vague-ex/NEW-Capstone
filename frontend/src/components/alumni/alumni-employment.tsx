import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI } from '../../data/app-data';
import { fetchAlumniAccountStatus, updateAlumniEmployment, createAlumniVerificationInvite } from '../../app/api-client';
import {
  useReferenceData,
  provincesApi,
  citiesApi,
  type ProvinceItem,
  type CityMunicipalityItem,
} from '../../hooks/useReferenceData';
import {
  Briefcase, CheckCircle2, Clock, Save, Building2,
  MapPin, AlertTriangle, BookOpen,
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

export function AlumniEmployment({ retrackingMode = false }: { retrackingMode?: boolean } = {}) {
  const navigate = useNavigate();
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
    academic_honors: String(sd.academic_honors ?? ''),
    prior_work_experience: String(sd.prior_work_experience ?? ''),
    ojt_relevance: String(sd.ojt_relevance ?? ''),
    has_portfolio: String(sd.has_portfolio ?? ''),

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
    currentJobProvinceId: String(sd.currentJobProvinceId ?? ''),
    currentJobCityId: String(sd.currentJobCityId ?? ''),
    province_address: String(sd.province_address ?? ''),
    zip_code: String(sd.zip_code ?? ''),
    country_address: String(sd.country_address ?? 'Philippines'),

    // Section 9: Skills
    technical_skills: Array.isArray(sd.technical_skills) ? (sd.technical_skills as string[]) : [],
    soft_skills: Array.isArray(sd.soft_skills) ? (sd.soft_skills as string[]) : [],
    professional_certifications: String(sd.professional_certifications ?? ''),
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Snapshot the work-related fields the moment the form mounts. If either
  // changes by the time the alumnus hits Save, we show a confirmation modal
  // because the change retires their current verified employment record
  // and forces their employer to re-evaluate. Anything else (work address,
  // skills, awards, ...) saves silently as before.
  const initialWorkRef = useRef<{ company: string; title: string }>({
    company: String(sd.currentJobCompany ?? sd.current_job_company ?? alumni.company ?? ''),
    title: String(sd.currentJobPosition ?? sd.current_job_title ?? alumni.jobTitle ?? ''),
  });
  const [reevalConfirmOpen, setReevalConfirmOpen] = useState(false);
  // Retracking notice: shown on entry when the dashboard routed the graduate
  // here because their record is 2+ years old.
  const [retrackNoticeOpen, setRetrackNoticeOpen] = useState(retrackingMode);
  // Share-link modal: shown AFTER a successful save when the company
  // changed (including first-time becoming employed). Replaces the older
  // inline amber banner and the small emerald sub-panel that used to live
  // permanently on the page.
  const [shareLinkModalOpen, setShareLinkModalOpen] = useState(false);

  // Region → Province → CityMunicipality cascade. Lazy-loaded from the
  // reference DB so admin reference-data CRUD changes propagate live.
  const [provincesForRegion, setProvincesForRegion] = useState<ProvinceItem[]>([]);
  const [citiesForLevel, setCitiesForLevel] = useState<CityMunicipalityItem[]>([]);

  useEffect(() => {
    if (!form.currentJobRegionId) {
      setProvincesForRegion([]);
      return;
    }
    let active = true;
    void provincesApi
      .list(form.currentJobRegionId)
      .then(({ provinces }) => { if (active) setProvincesForRegion(provinces); })
      .catch(() => { if (active) setProvincesForRegion([]); });
    return () => { active = false; };
  }, [form.currentJobRegionId]);

  useEffect(() => {
    if (!form.currentJobRegionId) {
      setCitiesForLevel([]);
      return;
    }
    let active = true;
    if (form.currentJobProvinceId) {
      void citiesApi
        .list({ provinceId: form.currentJobProvinceId })
        .then(({ cities }) => { if (active) setCitiesForLevel(cities); })
        .catch(() => { if (active) setCitiesForLevel([]); });
    } else if (provincesForRegion.length === 0) {
      // Region has no provinces (NCR-style) → load region-direct cities.
      void citiesApi
        .list({ regionId: form.currentJobRegionId })
        .then(({ cities }) => { if (active) setCitiesForLevel(cities); })
        .catch(() => { if (active) setCitiesForLevel([]); });
    } else {
      setCitiesForLevel([]);
    }
    return () => { active = false; };
  }, [form.currentJobRegionId, form.currentJobProvinceId, provincesForRegion]);
  const [saveError, setSaveError] = useState('');
  const [employerLinkStatus, setEmployerLinkStatus] = useState('');

  // Work location pin coordinates (separate from string form fields)
  const [workLat, setWorkLat] = useState<number | null>(
    sd.work_latitude != null && sd.work_latitude !== '' ? Number(sd.work_latitude) : null
  );
  const [workLng, setWorkLng] = useState<number | null>(
    sd.work_longitude != null && sd.work_longitude !== '' ? Number(sd.work_longitude) : null
  );

  // Leaflet map refs for work address pin
  const workMapContainerRef = useRef<HTMLDivElement>(null);
  const workLeafletMapRef = useRef<unknown>(null);
  const workMarkerRef = useRef<unknown>(null);

  // Empty until a token is minted: without a token there is no meaningful link
  // to share, since the token is what ties the response back to this graduate.
  const [employerPortalLink, setEmployerPortalLink] = useState('');
  // Answer to the "is your evaluator the same as before?" modal question.
  // null = not asked / not a work change; true = same evaluator; false = a
  // different evaluator at (possibly) the same company.
  const [evaluatorSame, setEvaluatorSame] = useState<boolean | null>(null);

  // Mint a one-time verification token and build the link the graduate sends
  // to their employer. The token row holds an `alumni` foreign key, so the
  // response comes back tied to this graduate automatically — the employer
  // never has to identify them, and never needs an account.
  const openShareLinkWithInvite = async () => {
    setShareLinkModalOpen(true);
    setEmployerLinkStatus('');
    if (!alumniId) return;
    try {
      const res = await createAlumniVerificationInvite(alumniId);
      const tokenId = res?.token?.id;
      if (tokenId) {
        const base = typeof window === 'undefined' ? '' : window.location.origin;
        setEmployerPortalLink(`${base}/verify/${tokenId}`);
      } else {
        setEmployerLinkStatus('Could not create a verification link. Please try again.');
      }
    } catch {
      setEmployerLinkStatus('Could not create a verification link. Please try again.');
    }
  };

  const setF = (key: string, value: string) => {
    setSaved(false); setSaveError('');
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleShareLink = async () => {
    try {
      await navigator.clipboard.writeText(employerPortalLink);
      setEmployerLinkStatus('Verification link copied. Send it to your employer or HR supervisor.');
    } catch {
      setEmployerLinkStatus('Copy not available. Share the link below manually.');
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────

  const isCurrentlyEmployed = ['employed_full_time', 'employed_part_time', 'self_employed'].includes(form.employment_status);
  const isNeverEmployed = form.employment_status === 'never_employed';

  // ── Leaflet work-location map ────────────────────────────────────────────────

  useEffect(() => {
    if (!isCurrentlyEmployed || !workMapContainerRef.current) return;
    if (workLeafletMapRef.current) return; // already initialised

    // Load Leaflet CSS once (without SRI integrity - SRI requires crossOrigin
    // and can silently fail to load the stylesheet on some setups, which is
    // what was breaking the marker rendering / drag handles before).
    if (!document.getElementById('leaflet-css-link')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-link';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    void import('leaflet').then(({ default: L }) => {
      if (!workMapContainerRef.current || workLeafletMapRef.current) return;

      // Build an explicit icon - bypasses the Default-icon URL resolution that
      // breaks under bundlers (the marker becomes a 0×0 element when broken,
      // and a 0-size element can't be dragged or clicked).
      const pinIcon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      const startLat = workLat ?? 12.8;
      const startLng = workLng ?? 121.7;
      const startZoom = workLat ? 13 : 6;

      const map = L.map(workMapContainerRef.current, {
        center: [startLat, startLng],
        zoom: startZoom,
        scrollWheelZoom: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);

      const marker = L.marker([startLat, startLng], {
        icon: pinIcon,
        draggable: true,
        autoPan: true,
      }).addTo(map);
      workMarkerRef.current = marker;
      workLeafletMapRef.current = map;

      const reverseGeocode = (lat: number, lng: number) => {
        void fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
          { headers: { 'Accept-Language': 'en' } },
        ).then(r => r.json()).then((data: { address?: Record<string, string>; country_code?: string }) => {
          const addr = data.address ?? {};
          const city = addr.city || addr.town || addr.municipality || addr.suburb || '';
          const province = addr.province || addr.state || '';
          const countryCode = (data.country_code ?? '').toLowerCase();
          const countryName = addr.country || '';

          if (city) setF('city_municipality', city);
          if (province) setForm(f => ({ ...f, province_address: province }));
          // Flip both currentJobLocation and country_address together so the
          // radio + dropdown can never desync after a pin drop.
          if (countryCode && countryCode !== 'ph' && countryName) {
            setForm(f => ({
              ...f,
              country_address: countryName,
              currentJobLocation: 'Abroad / Remote Foreign Employer',
            }));
          } else if (!countryCode || countryCode === 'ph') {
            setForm(f => ({
              ...f,
              country_address: 'Philippines',
              currentJobLocation: 'Local (Philippines)',
            }));
          }
        }).catch(() => { /* silent */ });
      };

      const updatePin = (lat: number, lng: number) => {
        setWorkLat(lat);
        setWorkLng(lng);
        reverseGeocode(lat, lng);
      };

      marker.on('dragend', () => {
        const pos = (marker as unknown as { getLatLng: () => { lat: number; lng: number } }).getLatLng();
        updatePin(pos.lat, pos.lng);
      });

      // Click-to-drop fallback: tap anywhere on the map to move the pin -
      // useful on touch devices or when the marker is off-screen.
      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        marker.setLatLng(e.latlng);
        updatePin(e.latlng.lat, e.latlng.lng);
      });

      // Force a layout recalculation once the map is in the DOM. Without this,
      // the map's internal pixel-origin can be wrong when rendered inside a
      // conditional section, which makes the drag handle land in the wrong
      // place (or appear unresponsive).
      const sizeTimer = setTimeout(() => {
        if (workLeafletMapRef.current === map) {
          (map as unknown as { invalidateSize: () => void }).invalidateSize();
        }
      }, 200);

      (map as unknown as { _sizeTimer: ReturnType<typeof setTimeout> })._sizeTimer = sizeTimer;
    });

    return () => {
      if (workLeafletMapRef.current) {
        const m = workLeafletMapRef.current as { remove: () => void; _sizeTimer?: ReturnType<typeof setTimeout> };
        if (m._sizeTimer) clearTimeout(m._sizeTimer);
        m.remove();
        workLeafletMapRef.current = null;
        workMarkerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentlyEmployed]);

  // Auto-pin the map from the chosen city. Forward-geocodes via Nominatim
  // when the city/region/province changes - only fires when the user hasn't
  // already manually placed the pin (workLat/workLng could already be set
  // from prior session data; we still rough-pin if the city changes).
  useEffect(() => {
    if (!isCurrentlyEmployed) return;
    if (!form.city_municipality) return;
    if (!workLeafletMapRef.current || !workMarkerRef.current) return;

    const isLocal = form.currentJobLocation !== 'Abroad / Remote Foreign Employer';
    const parts: string[] = [form.city_municipality];
    if (isLocal) {
      const province = provincesForRegion.find(p => p.id === form.currentJobProvinceId)?.name;
      if (province) parts.push(province);
      parts.push('Philippines');
    } else if (form.country_address) {
      parts.push(form.country_address);
    }
    const query = parts.filter(Boolean).join(', ');
    if (!query) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        { signal: controller.signal, headers: { 'Accept-Language': 'en' } },
      )
        .then(r => r.json())
        .then((results: Array<{ lat: string; lon: string }>) => {
          if (!Array.isArray(results) || results.length === 0) return;
          const lat = Number(results[0].lat);
          const lng = Number(results[0].lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          setWorkLat(lat);
          setWorkLng(lng);
          const marker = workMarkerRef.current as { setLatLng: (ll: [number, number]) => void };
          marker.setLatLng([lat, lng]);
          const map = workLeafletMapRef.current as {
            setView: (ll: [number, number], z: number) => void;
          };
          map.setView([lat, lng], 13);
        })
        .catch(() => { /* abort or network - silent */ });
    }, 500); // small debounce so fast cascade clicks don't spam Nominatim

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.city_municipality,
    form.currentJobProvinceId,
    form.currentJobLocation,
    form.country_address,
    isCurrentlyEmployed,
  ]);

  // ── Save ─────────────────────────────────────────────────────────────────────

  const performSave = async () => {
    setReevalConfirmOpen(false);
    setIsSaving(true);
    setSaveError('');
    // Captured BEFORE the success block overwrites initialWorkRef so we
    // know whether to surface the share-link modal afterwards.
    const companyChangedAtSave = (
      initialWorkRef.current.company.trim().toLowerCase()
      !== form.currentJobCompany.trim().toLowerCase()
    );

    // ZIP-code validation: PH must be exactly 4 digits when typed (the field
    // remains optional, so empty stays valid). Foreign ZIPs are unrestricted.
    if (
      isCurrentlyEmployed
      && form.currentJobLocation === 'Local (Philippines)'
      && form.zip_code
      && !/^\d{4}$/.test(form.zip_code)
    ) {
      setSaveError('Philippine ZIP code must be exactly 4 digits.');
      setIsSaving(false);
      return;
    }

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
      work_latitude: workLat ?? null,
      work_longitude: workLng ?? null,
    };

    try {
      let serverAlumni: Record<string, unknown> = {};
      if (alumniId) {
        const response = await updateAlumniEmployment(alumniId, {
          employment_status: normalizedStatus,
          survey_data: surveyDataPayload,
          job_title_id: resolvedJobTitleId,
          region_id: resolvedRegionId,
          // Only auto-email prior confirmers when this was NOT routed through
          // the "same evaluator?" modal. Same -> reuse existing (no email);
          // different -> graduate shares an invite link (old evaluator silent).
          notify_previous_evaluator: evaluatorSame === null,
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
      // Refresh the work-field baseline so saving twice in a row does not
      // re-prompt the re-evaluation modal for the same change.
      initialWorkRef.current = {
        company: form.currentJobCompany,
        title: form.currentJobPosition,
      };
      // Surface the share-link modal AFTER a successful save when the
      // company changed (covers both moving employers and first-time
      // becoming employed). Same-employer-title-only changes do not
      // trigger it because the existing employer already has the link.
      // Surface the tokenized invite link when the evaluator is a DIFFERENT
      // person (modal answered "no"), or — for a first-time/company change with
      // no prior verification — when the company changed. Same-evaluator reuse
      // shows nothing (the existing employer already has access).
      const shouldInvite =
        evaluatorSame === false
        || (evaluatorSame === null && companyChangedAtSave && isCurrentlyEmployed && !!form.currentJobCompany.trim());
      if (shouldInvite) {
        void openShareLinkWithInvite();
      }
      setEvaluatorSame(null);

      if (retrackingMode && alumniId && !shouldInvite) {
        try {
          const refreshed = await fetchAlumniAccountStatus(alumniId);
          if (refreshed && typeof refreshed === 'object') {
            const merged = { ...updated, ...(refreshed as Record<string, unknown>) };
            sessionStorage.setItem('alumni_user', JSON.stringify(merged));
          }
        } catch {
          // If session refresh fails, the dashboard will re-check on its own mount.
        }
        navigate('/alumni/dashboard');
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save employment data right now.');
    } finally {
      setIsSaving(false);
    }
  };

  // Submit gate: any change to company OR job title retires the current
  // verified employment record and forces the prior employer to re-evaluate.
  // We surface that intent with a confirmation modal so the alumnus does not
  // accidentally clear their verified status while only fixing a typo.
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const oldCompany = initialWorkRef.current.company.trim().toLowerCase();
    const newCompany = form.currentJobCompany.trim().toLowerCase();
    const oldTitle = initialWorkRef.current.title.trim().toLowerCase();
    const newTitle = form.currentJobPosition.trim().toLowerCase();
    const hadPriorJob = !!(oldCompany || oldTitle);
    const workChanged = hadPriorJob && (oldCompany !== newCompany || oldTitle !== newTitle);
    if (workChanged && isVerified) {
      setReevalConfirmOpen(true);
      return;
    }
    void performSave();
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PortalLayout role="alumni" pageTitle="Employment Details" pageSubtitle="CHED Graduate Tracer Survey - Employment Record">
      <div className="max-w-3xl lg:max-w-5xl mx-auto space-y-5 pb-28">

        {retrackingMode && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4">
            <AlertTriangle className="size-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-800 text-sm" style={{ fontWeight: 700 }}>Employment record retracking required</p>
              <p className="text-red-700 text-xs mt-0.5 leading-relaxed">
                Your employment data is over 2 years old. Please review and update every section before continuing - your dashboard and other features remain locked until this form is submitted.
              </p>
            </div>
          </div>
        )}

        {isPending && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <Clock className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-800 text-sm" style={{ fontWeight: 700 }}>Account pending verification</p>
              <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
                You can update and save your employment data at any time. Your information will{' '}
                <span style={{ fontWeight: 700 }}>not appear in analytics</span> until the BSIS Admin approves your account.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">

          {/* ── Section 4: Academic & Pre-Employment ─────────────────────────── */}
          {/* On large screens, Academic + Employment Status sit side-by-side */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-5 space-y-5 lg:space-y-0">

          {/* Academic & pre-employment is one-time history — hidden when retracking. */}
          {!retrackingMode && (
          <SectionCard icon={BookOpen} title="Part III - Academic & Pre-Employment Profile">

            <div>
              <FieldLabel>1. Academic Honors Received at Graduation</FieldLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {['Summa Cum Laude', 'Magna Cum Laude', 'Cum Laude', 'No Academic Honors'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.academic_honors} onSelect={v => setF('academic_honors', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>2. Work experience (part-time, freelance, internship beyond OJT) BEFORE graduating?</FieldLabel>
              <div className="flex gap-2">
                {['Yes', 'No'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.prior_work_experience} onSelect={v => setF('prior_work_experience', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>3. Was your required OJT/Internship related to the job you eventually got?</FieldLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {['Yes, directly related', 'Somewhat related', 'Not related', 'Have not secured a job yet / Not applicable'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.ojt_relevance} onSelect={v => setF('ojt_relevance', v)} />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>4. Online portfolio, GitHub profile, or project showcase when applying?</FieldLabel>
              <div className="flex gap-2">
                {['Yes', 'No'].map(opt => (
                  <RadioOption key={opt} label={opt} value={opt} current={form.has_portfolio} onSelect={v => setF('has_portfolio', v)} />
                ))}
              </div>
            </div>

          </SectionCard>
          )}

          {/* ── Section 5: Employment Status ─────────────────────────────────── */}
          <SectionCard icon={Briefcase} title="Part IV - Current Employment Status">
            <div>
              <FieldLabel required>Are you presently employed?</FieldLabel>
              <select
                value={form.employment_status}
                onChange={e => setF('employment_status', e.target.value)}
                className={inputCls}
              >
                <option value="">Select Employment Status</option>
                {EMPLOYMENT_STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </SectionCard>

          </div>{/* end lg:grid for Part III + IV */}

          {/* ── Section 6: First Job (one-time history; hidden when retracking) ── */}
          {!retrackingMode && !isNeverEmployed && form.employment_status && (
            <SectionCard icon={Clock} title="Part V - First Job Details">
              <div className="lg:grid lg:grid-cols-2 lg:gap-x-8 lg:items-start space-y-5 lg:space-y-0">
              <div className="space-y-5">

              <div>
                <FieldLabel>1. How long did it take to land your FIRST job after graduation?</FieldLabel>
                <div className="grid grid-cols-2 gap-1.5">
                  {['Within 1 month', '1 - 3 months', '3 - 6 months', '6 months to 1 year', '1 - 2 years', 'More than 2 years'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.timeToHire} onSelect={v => setF('timeToHire', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>2. Employment Sector of FIRST JOB</FieldLabel>
                <div className="space-y-1.5">
                  {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.firstJobSector} onSelect={v => setF('firstJobSector', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>3. Employment Status of FIRST JOB</FieldLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                <div className="space-y-1.5">
                  {['Yes, directly related (IT/IS role)', 'Somewhat related (uses some IT skills)', 'Not related (different field)'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.firstJobRelated} onSelect={v => setF('firstJobRelated', v)} />
                  ))}
                </div>
              </div>

              </div>{/* end left column */}
              <div className="space-y-5">

              {(form.firstJobRelated === 'Somewhat related (uses some IT skills)' || form.firstJobRelated === 'Not related (different field)') && (
                <div>
                  <FieldLabel>6. Primary reason for accepting unrelated/semi-related job</FieldLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                <div className="grid grid-cols-2 gap-1.5">
                  {['Less than 3 months', '3 - 6 months', '6 months to 1 year', '1 - 2 years', 'More than 2 years', 'Currently in first job'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.jobRetention} onSelect={v => setF('jobRetention', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>8. Approximately how many job applications before your FIRST job offer?</FieldLabel>
                <div className="grid grid-cols-2 gap-1.5">
                  {['1 - 5 applications', '6 - 15 applications', '16 - 30 applications', '31+ applications'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.jobApplications} onSelect={v => setF('jobApplications', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>9. Where did you find your first job opening?</FieldLabel>
                <div className="space-y-1.5">
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

              </div>{/* end right column */}
              </div>{/* end lg:grid First Job */}
            </SectionCard>
          )}

          {/* ── Section 7: Current Job ───────────────────────────────────────── */}
          {isCurrentlyEmployed && (
            <SectionCard icon={Building2} title="Part VI - Current / Most Recent Job Details">
              {/* Desktop: 2-column grid for compact layout */}
              <div className="lg:grid lg:grid-cols-2 lg:gap-x-8 space-y-5 lg:space-y-0">
              <div className="space-y-5">

              <div>
                <FieldLabel>1. Employment Sector of CURRENT/MOST RECENT JOB</FieldLabel>
                <div className="space-y-1.5">
                  {['Government', 'Private', 'Entrepreneurial / Freelance / Self-Employed'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.currentJobSector} onSelect={v => setF('currentJobSector', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>2. Current Occupation / Position</FieldLabel>
                <div className="border border-dashed border-gray-200 rounded-md p-3 space-y-2 bg-gray-50/40">
                  <select
                    value={form.currentJobTitleId}
                    onChange={e => {
                      const id = e.target.value;
                      const title = referenceData.job_titles.find(jt => jt.id === id);
                      setForm(f => ({ ...f, currentJobTitleId: id, currentJobPosition: title ? title.name : f.currentJobPosition }));
                      setSaved(false); setSaveError('');
                    }}
                    className={inputCls}
                  >
                    <option value="">Pick a suggested job title (optional)</option>
                    {referenceData.job_titles.map(jt => (
                      <option key={jt.id} value={jt.id}>{jt.name}</option>
                    ))}
                  </select>
                  <input type="text" placeholder="e.g. Systems Analyst"
                    value={form.currentJobPosition} onChange={e => setF('currentJobPosition', e.target.value)} className={inputCls} />
                  <p className="text-[11px] text-gray-500 leading-snug">
                    Use the text box if your role isn't in the dropdown above, or to refine the selected title.
                  </p>
                </div>
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

              </div>{/* end left column */}
              <div className="space-y-5">

              <div>
                <FieldLabel>4. Is your CURRENT job related to your BSIS degree?</FieldLabel>
                <div className="space-y-1.5">
                  {['Yes, directly related (IT/IS role)', 'Somewhat related (uses some IT skills)', 'Not related (different field)', 'Not applicable'].map(opt => (
                    <RadioOption key={opt} label={opt} value={opt} current={form.currentJobRelated} onSelect={v => setF('currentJobRelated', v)} />
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel>5. Location Type</FieldLabel>
                <div className="space-y-1.5">
                  {['Local (Philippines)', 'Abroad / Remote Foreign Employer'].map(opt => (
                    <RadioOption
                      key={opt}
                      label={opt}
                      value={opt}
                      current={form.currentJobLocation}
                      onSelect={v => {
                        setF('currentJobLocation', v);
                        // Keep country_address in sync with the radio.
                        if (v === 'Local (Philippines)') {
                          setF('country_address', 'Philippines');
                        } else if (form.country_address === 'Philippines') {
                          // Switching to Abroad - clear the locked PH value so
                          // the user is forced to pick a foreign country.
                          setF('country_address', '');
                        }
                      }}
                    />
                  ))}
                </div>
              </div>

              </div>{/* end right column */}
              </div>{/* end lg:grid Current Job */}
            </SectionCard>
          )}

          {/* ── Section 8: Work Address ──────────────────────────────────────── */}
          {isCurrentlyEmployed && (() => {
            const isLocal = form.currentJobLocation !== 'Abroad / Remote Foreign Employer';
            return (
            <SectionCard icon={MapPin} title="Part VII - Work Address for Mapping">
              <p className="text-gray-400 text-xs -mt-2">
                For employment distribution mapping - company name stays confidential.
                {isLocal
                  ? ' Pick the closest match; you can fine-tune the pin on the map below.'
                  : ' Type your foreign-country workplace details.'}
              </p>

              {/* Desktop: address fields left, map right. Mobile: stacked. */}
              <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-4 lg:space-y-0">

                {/* ── Left column: all address inputs ─────────────── */}
                <div className="space-y-4">

                  {/* Street + Sub-locality row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Street, Building, or Unit</FieldLabel>
                      <input
                        type="text"
                        placeholder="e.g. 123 Rizal St., Floor 4"
                        value={form.street_address}
                        onChange={e => setF('street_address', e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <FieldLabel>{isLocal ? 'Barangay / Sub-locality' : 'Neighborhood / Sub-locality'}</FieldLabel>
                      <input
                        type="text"
                        placeholder={isLocal ? 'e.g. Brgy. Zone 1, or skip if unsure' : 'e.g. Shibuya, Brooklyn, Notting Hill'}
                        value={form.barangay}
                        onChange={e => setF('barangay', e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {isLocal ? (
                    <>
                      {/* Region → Province → City cascade - only shown for PH addresses.
                          Sourced from the seeded PSGC reference tables; admin-settings
                          is the source of truth. Backend only returns regions that have
                          a valid PSGC ID, so no psgc_id filter needed here. */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <FieldLabel required>Region</FieldLabel>
                          <select
                            value={form.currentJobRegionId}
                            onChange={e =>
                              setForm(f => ({
                                ...f,
                                currentJobRegionId: e.target.value,
                                currentJobProvinceId: '',
                                currentJobCityId: '',
                                city_municipality: '',
                              }))
                            }
                            className={inputCls}
                          >
                            <option value="">Select region...</option>
                            {/* Deduplicate by name as a safety net */}
                            {Array.from(
                              new Map(referenceData.regions.map(r => [r.name, r])).values()
                            )
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map(region => (
                                <option key={region.id} value={region.id}>{region.name}</option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Province</FieldLabel>
                          <select
                            value={form.currentJobProvinceId}
                            onChange={e =>
                              setForm(f => ({
                                ...f,
                                currentJobProvinceId: e.target.value,
                                currentJobCityId: '',
                                city_municipality: '',
                              }))
                            }
                            disabled={!form.currentJobRegionId || provincesForRegion.length === 0}
                            className={inputCls}
                          >
                            <option value="">
                              {!form.currentJobRegionId
                                ? 'Pick a region first'
                                : provincesForRegion.length === 0
                                  ? 'No provinces (NCR-style)'
                                  : 'Select province...'}
                            </option>
                            {provincesForRegion.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel required>City / Municipality</FieldLabel>
                          <select
                            value={form.currentJobCityId}
                            onChange={e => {
                              const city = citiesForLevel.find(c => c.id === e.target.value);
                              setForm(f => ({
                                ...f,
                                currentJobCityId: e.target.value,
                                city_municipality: city?.name ?? '',
                              }));
                            }}
                            disabled={
                              !form.currentJobRegionId
                              || (provincesForRegion.length > 0 && !form.currentJobProvinceId)
                              || citiesForLevel.length === 0
                            }
                            className={inputCls}
                          >
                            <option value="">
                              {!form.currentJobRegionId
                                ? 'Pick a region first'
                                : provincesForRegion.length > 0 && !form.currentJobProvinceId
                                  ? 'Pick a province first'
                                  : citiesForLevel.length === 0
                                    ? 'Loading cities...'
                                    : 'Select city/municipality...'}
                            </option>
                            {citiesForLevel.map(c => (
                              <option key={c.id} value={c.id}>{c.name}{c.is_city ? ' (City)' : ''}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Abroad - flat text inputs; PSGC cascade doesn't apply. */
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <FieldLabel required>City / Locality</FieldLabel>
                        <input
                          type="text"
                          placeholder="e.g. Tokyo, San Francisco, Dubai"
                          value={form.city_municipality}
                          onChange={e => setF('city_municipality', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <FieldLabel>State / Province / Prefecture</FieldLabel>
                        <input
                          type="text"
                          placeholder="e.g. Tokyo Metropolis, California"
                          value={form.province_address ?? ''}
                          onChange={e => setForm(f => ({ ...f, province_address: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{isLocal ? 'ZIP Code' : 'Postal Code'}</FieldLabel>
                      <input
                        type="text"
                        inputMode={isLocal ? 'numeric' : 'text'}
                        placeholder={isLocal ? 'e.g. 6115' : 'e.g. 90210, M5V 3L9'}
                        value={form.zip_code}
                        onChange={e => {
                          const next = isLocal
                            ? e.target.value.replace(/\D/g, '').slice(0, 4)
                            : e.target.value.slice(0, 10);
                          setF('zip_code', next);
                        }}
                        className={inputCls}
                      />
                      {isLocal && (
                        <p className="text-gray-400 text-xs mt-1">Philippine ZIP is 4 digits.</p>
                      )}
                    </div>
                    <div>
                      <FieldLabel required>Country</FieldLabel>
                      {form.currentJobLocation === 'Local (Philippines)' ? (
                        <select
                          value="Philippines"
                          disabled
                          className={`${inputCls} bg-gray-100 text-gray-700 cursor-not-allowed`}
                        >
                          <option value="Philippines">Philippines</option>
                        </select>
                      ) : (
                        <select
                          value={form.country_address === 'Philippines' ? '' : form.country_address}
                          onChange={e => setF('country_address', e.target.value)}
                          className={inputCls}
                        >
                          <option value="" disabled>Select country</option>
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
                      )}
                      <p className="text-gray-400 text-xs mt-1">
                        {form.currentJobLocation === 'Local (Philippines)'
                          ? 'Locked to Philippines.'
                          : 'Country where your workplace is located.'}
                      </p>
                    </div>
                  </div>
                </div>{/* end left address column */}

                {/* ── Right column: interactive map pin ───────────── */}
                <div className="flex flex-col">
                  <FieldLabel>Exact Workplace Location (Pin)</FieldLabel>
                  <div
                    ref={workMapContainerRef}
                    className="flex-1 min-h-[280px] lg:min-h-[360px]"
                    style={{ borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}
                  />
                  <p className="text-gray-500 text-xs mt-2">
                    Selecting a city auto-pans the map. Drag the pin or tap anywhere to fine-tune.
                    {workLat != null && workLng != null && (
                      <span className="ml-1 text-[#166534]" style={{ fontWeight: 600 }}>
                        ✓ Pin set ({workLat.toFixed(4)}, {workLng.toFixed(4)})
                      </span>
                    )}
                  </p>
                </div>

              </div>{/* end lg:grid address+map */}
            </SectionCard>
            );
          })()}

          {/* ── Skills moved to "My Skills" page ──────────────────────────────
              Part VIII (Competency & Skills Assessment) lives on alumni-skills.tsx.
              Removed from this page so each form has a single concern. */}

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

        </form>

        {/* Sticky save bar */}
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3 sm:left-64">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <div className="flex-1 min-w-0 text-xs">
              {saveError ? (
                <span className="flex items-center gap-1.5 text-red-700" style={{ fontWeight: 600 }}>
                  <AlertTriangle className="size-4" /> {saveError}
                </span>
              ) : saved ? (
                <span className="flex items-center gap-1.5 text-emerald-700" style={{ fontWeight: 600 }}>
                  <CheckCircle2 className="size-4" />
                  {retrackingMode ? 'Retracking submitted - returning to your dashboard.' : 'Saved - your employment record is up to date.'}
                </span>
              ) : retrackingMode ? (
                <span className="text-red-700" style={{ fontWeight: 600 }}>Submit this form to unlock the dashboard.</span>
              ) : (
                <span className="text-gray-500">Confidential to you and the BSIS Program (RA 10173). Save anytime - even partial updates are kept.</span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => handleSave(e as unknown as React.FormEvent)}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-70"
              style={{ fontWeight: 600 }}>
              {isSaving
                ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : <><Save className="size-4" /> Save Changes</>}
            </button>
          </div>
        </div>
      </div>

      {/* Re-evaluation confirmation modal: fires when company OR job title
          changed on an already-verified record. Backend will retire the
          current EmploymentRecord, drop verified status, and email the
          prior confirming employer to re-evaluate. */}
      {retrackNoticeOpen && (
        <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60">
          <div className="bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-md flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 shrink-0">
                <AlertTriangle className="size-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>Time to update your record</p>
                <p className="text-gray-500 text-xs mt-0.5">It&apos;s been over 2 years since your last update.</p>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-2">
              <p>
                Please confirm your <span style={{ fontWeight: 600 }}>current</span>{' '}details — your present job,
                work location, and any personal changes. You won&apos;t need to re-enter your first-job or
                academic history.
              </p>
              <p className="text-xs text-gray-500">Skills and personal info can also be updated from their own pages.</p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setRetrackNoticeOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#166534] hover:bg-[#14532d] text-white text-sm transition"
                style={{ fontWeight: 600 }}
              >
                Update now
              </button>
            </div>
          </div>
        </div>
      )}

      {reevalConfirmOpen && (
        <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60">
          <div className="bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-md max-h-screen sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 shrink-0">
                <AlertTriangle className="size-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>This change needs a new employer evaluation</p>
                <p className="text-gray-500 text-xs mt-0.5">Your verified status will be cleared until your employer confirms the new role.</p>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-3 overflow-y-auto">
              <p>
                You are about to change your <span style={{ fontWeight: 600 }}>company</span> or <span style={{ fontWeight: 600 }}>job title</span>.
                Because your current employment record is already verified, the
                system will retire it and create a new one in <span style={{ fontWeight: 600 }}>pending</span> status.
              </p>
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs space-y-2">
                <div>
                  <span className="text-gray-400 uppercase tracking-wide" style={{ fontSize: '10px', fontWeight: 700 }}>Currently verified</span>
                  <p className="text-gray-800 mt-0.5" style={{ fontWeight: 600 }}>{initialWorkRef.current.company || '(not set)'}</p>
                  <p className="text-gray-500">{initialWorkRef.current.title || '(not set)'}</p>
                </div>
                <div>
                  <span className="text-[#166534] uppercase tracking-wide" style={{ fontSize: '10px', fontWeight: 700 }}>New (will require evaluation)</span>
                  <p className="text-gray-800 mt-0.5" style={{ fontWeight: 600 }}>{form.currentJobCompany || '(not set)'}</p>
                  <p className="text-gray-500">{form.currentJobPosition || '(not set)'}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Your previous evaluation is preserved in the system as part of
                the historical record.
              </p>
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <p className="text-xs text-gray-700" style={{ fontWeight: 600 }}>
                  Will the same person/employer evaluate you again?
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEvaluatorSame(true)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs transition ${evaluatorSame === true ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    style={{ fontWeight: 600 }}>
                    Yes, same evaluator
                  </button>
                  <button type="button" onClick={() => setEvaluatorSame(false)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs transition ${evaluatorSame === false ? 'border-[#166534] bg-[#166534]/5 text-[#166534]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    style={{ fontWeight: 600 }}>
                    No, a different person
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  {evaluatorSame === true
                    ? 'We will reuse your existing employer — no new email is sent.'
                    : evaluatorSame === false
                      ? 'You will get a link to send your new evaluator. Your previous evaluator will NOT be emailed.'
                      : 'Choose one to continue.'}
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setReevalConfirmOpen(false); setEvaluatorSame(null); }}
                className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm transition"
                style={{ fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void performSave(); }}
                disabled={isSaving || evaluatorSame === null}
                className="px-4 py-2 rounded-xl bg-[#166534] hover:bg-[#14532d] text-white text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ fontWeight: 600 }}
              >
                {isSaving ? 'Submitting…' : 'Submit Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Employer Portal Link modal: fires after a successful save
          when the company changed (including first-time employed). Replaces
          the older permanent amber banner so the page is quiet by default
          and the share prompt is timed to when the alumnus actually needs
          to forward the link to their new employer. */}
      {shareLinkModalOpen && (
        <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60">
          <div className="bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-md max-h-screen sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 shrink-0">
                <Building2 className="size-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>Share your verification link</p>
                <p className="text-gray-500 text-xs mt-0.5">Your employer needs this link to confirm your new role.</p>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 space-y-3 overflow-y-auto">
              <p>
                To verify your employment, your <span style={{ fontWeight: 600 }}>employer or HR supervisor</span> just opens the link below and answers a few questions.
                <span style={{ fontWeight: 600 }}> No account or sign-up is needed.</span> The link already identifies you, so they never have to look you up.
              </p>
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs font-mono break-all text-gray-700">
                {employerPortalLink || 'Creating your link…'}
              </div>
              <p className="text-gray-400 text-xs">
                This link works once and expires in 7 days. You can create another for a different contact.
              </p>
              {employerLinkStatus && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700" style={{ fontWeight: 600 }}>
                  <CheckCircle2 className="size-4 text-emerald-500" /> {employerLinkStatus}
                </p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShareLinkModalOpen(false); setEmployerLinkStatus(''); }}
                className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm transition"
                style={{ fontWeight: 500 }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleShareLink}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#166534] hover:bg-[#14532d] text-white text-sm transition"
                style={{ fontWeight: 600 }}
              >
                <Building2 className="size-4" /> Copy link
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
