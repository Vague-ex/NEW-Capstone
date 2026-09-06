/**
 * Alumni Registration - Personal Information Component
 * Handles: Account Setup, Personal Info, Education Background, Biometric Verification
 * Steps: 1-4 + Biometrics
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  GraduationCap, ArrowLeft, CheckCircle2, AlertCircle, AlertTriangle,
  User, Mail, Phone, Lock, Eye, EyeOff, Camera, VideoOff, Video, RefreshCw,
  ChevronRight, ChevronLeft, Circle,
  BookOpen,
} from 'lucide-react';
import isImageBlurry from 'is-image-blurry';
import {
  averageFaceDescriptors,
  extractFaceDescriptorFromDataUrl,
  extractFaceLandmarksFromDataUrl,
  extractFaceLandmarksFromVideo,
  ensureModernFaceModelsLoaded,
  computeMouthAspectRatio,
  estimateHeadYawDegrees,
  MOUTH_OPEN_MAR_THRESHOLD,
  HEAD_TURN_YAW_THRESHOLD_DEG,
  FRONTAL_YAW_TOLERANCE_DEG,
  createBlinkDetector,
  FACE_SAMPLE_INTERVAL_MS,
  type BlinkDetector,
  type HeadTurnDirection,
  type LivenessSignal,
} from '../app/modern-face-descriptor';
import { API_BASE_URL } from '../app/api-client';
import { captureGps, type GpsFix } from '../app/geolocation';
import {
  useReferenceData,
  provincesApi,
  citiesApi,
  type RegionItem,
  type ProvinceItem,
  type CityMunicipalityItem,
} from '../hooks/useReferenceData';

//  Types

type PersonalStep = 1 | 2 | 3 | 4;

export interface PersonalFormData {
  // Step 1: Account
  email: string;
  password: string;
  confirmPassword: string;

  // Step 2: Personal Information
  familyName: string;
  firstName: string;
  middleName: string;
  gender: string;
  birthDate: string;
  civilStatus: string;
  mobile: string;
  mobileCountryCode: string;
  facebook: string;
  homeIsAbroad: boolean;
  homeCountry: string;
  region: string;
  province: string;
  city: string;
  barangay: string;

  // Step 3: Education Information
  graduationDate: string;
  graduationYear: number | null;
  hasGraduated: boolean;
  scholarship: string;
  // Further-studies (post-baccalaureate) - replaces the legacy "highestAttainment" question.
  furtherStudies: 'none' | 'enrolled' | 'completed';
  postgradProgram: string;
  postgradField: string;
  postgradSchool: string;
  postgradYearStarted: string;
  postgradYearCompleted: string;
  profEligibility: string[];
  profEligibilityOther: string;
}

export interface BiometricData {
  // A single frontal photo. Identity is established from this frame alone; the
  // liveness gestures that follow prove presence but are never used to build
  // the face template, because face-api's recogniser is only reliable on
  // near-frontal faces and folding turned frames in degraded the match.
  image: Blob;
  descriptor: number[] | null;
  descriptorSamples: number[][];
  livenessSignals: LivenessSignal[];
  headTurnDirection: HeadTurnDirection;
  /**
   * Where the identity photo was taken. PRD Module A requires the capture to
   * carry date, time and GPS for the audit trail; null when the browser denies
   * or cannot provide a fix, which must never block registration.
   */
  gps: GpsFix | null;
}

//  Constants

const PERSONAL_STEP_CONFIG = [
  { n: 1 as PersonalStep, label: 'Account' },
  { n: 2 as PersonalStep, label: 'Personal' },
  { n: 3 as PersonalStep, label: 'Education' },
  { n: 4 as PersonalStep, label: 'Verify Identity' },
];

type LivenessChallengeKind = 'neutral' | 'blink' | 'head_turn_left' | 'head_turn_right';

interface ShotInstruction {
  label: string;
  desc: string;
  kind: LivenessChallengeKind;
}

// Stage 1 is the only one that saves a photo — it captures the frontal frame
// the face template is built from. Stages 2 and 3 are pure liveness gates: a
// blink (which a still photo cannot fake) followed by one randomised head turn
// (which a pre-recorded video cannot anticipate).
function buildShotInstructions(turnDirection: HeadTurnDirection): ShotInstruction[] {
  return [
    { label: 'Look Forward', desc: 'Face the camera, keep your mouth closed', kind: 'neutral' },
    { label: 'Blink', desc: 'Blink once, naturally', kind: 'blink' },
    turnDirection === 'left'
      ? { label: 'Turn Left', desc: 'Turn your head slightly to your left', kind: 'head_turn_left' }
      : { label: 'Turn Right', desc: 'Turn your head slightly to your right', kind: 'head_turn_right' },
  ];
}

// How long a gesture must be held before it counts, and how often we sample.
// The old loop polled once per second, so a turn had to be held for two to
// three seconds and any wobble reset it — that was the main reason the turn
// felt impossible. Blinks last only 100–400 ms, so they cannot be detected at
// 1 Hz at all.
/** Stages in the capture flow: frontal photo, blink, head turn. */
const CAPTURE_STAGE_COUNT = 3;
const FRONTAL_HOLD_MS = 720;
const TURN_HOLD_MS = 360;
// Frames in the identity burst, and the gap between them. All three are
// frontal, so averaging them is a genuine noise reduction rather than the
// pose-mixing the previous implementation did.
const IDENTITY_BURST_FRAMES = 3;
const IDENTITY_BURST_GAP_MS = 200;

// Laplacian-variance blur gate: a frame is rejected when variance < threshold.
// Kept deliberately lenient — angled head-turn shots have fewer edges and were
// tripping false "too blurry" rejections at higher values.
const FACE_BLUR_THRESHOLD = 150;

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'l.facebook.com',
  'fb.com',
  'www.fb.com',
  'fb.me',
]);

/**
 * Validate that a URL points to Facebook. Empty input is treated as valid here
 * (the field is optional); call sites enforce required-ness separately.
 */
export function isValidFacebookUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  let url: URL;
  try {
    // Tolerate users pasting "facebook.com/foo" without a scheme.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return false;
  }
  return FACEBOOK_HOSTS.has(url.hostname.toLowerCase());
}

type PhCity = { name: string; zip: string; barangays: string[] };
type PhProvince = { name: string; cities: PhCity[] };
type PhRegion = { name: string; provinces: PhProvince[] };
type PhLocations = { regions: PhRegion[] };

const INITIAL_PERSONAL_FORM: PersonalFormData = {
  email: '',
  password: '',
  confirmPassword: '',
  familyName: '',
  firstName: '',
  middleName: '',
  gender: '',
  birthDate: '',
  civilStatus: '',
  mobile: '',
  mobileCountryCode: '+63',
  facebook: '',
  homeIsAbroad: false,
  homeCountry: 'Philippines',
  region: '',
  province: '',
  city: '',
  barangay: '',
  graduationDate: '',
  graduationYear: null,
  hasGraduated: true,
  scholarship: '',
  furtherStudies: 'none',
  postgradProgram: '',
  postgradField: '',
  postgradSchool: '',
  postgradYearStarted: '',
  postgradYearCompleted: '',
  profEligibility: [],
  profEligibilityOther: '',
};

//  Reusable Components

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100">
          <Icon className="size-4 text-emerald-600" />
        </div>
        <h2 className="text-gray-900 text-lg" style={{ fontWeight: 700 }}>{title}</h2>
      </div>
      {subtitle && <p className="text-gray-500 text-sm">{subtitle}</p>}
    </div>
  );
}

function RadioOption({ label, value, current, onSelect }: { label: string; value: string | boolean; current: string | boolean; onSelect: (v: string | boolean) => void }) {
  const isSelected = current === value;
  return (
    <button type="button" onClick={() => onSelect(value)}
      className={`px-4 py-2.5 rounded-lg border-2 transition text-sm ${
        isSelected ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
      }`} style={{ fontWeight: isSelected ? 600 : 500 }}>
      {label}
    </button>
  );
}

function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 rounded border-gray-300" />
      <span className="text-gray-700 text-sm">{label}</span>
    </label>
  );
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled = false, navigationUrl }: { onBack: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean; navigationUrl?: string }) {
  return (
    <div className="flex gap-3 mt-6">
      {navigationUrl ? (
        <Link to={navigationUrl}
          className="flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
          style={{ fontWeight: 600 }}>
          <ChevronLeft className="size-4" /> Back
        </Link>
      ) : (
        <button onClick={onBack}
          className="flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
          style={{ fontWeight: 600 }}>
          <ChevronLeft className="size-4" /> Back
        </button>
      )}
      <button onClick={onNext} disabled={nextDisabled}
        className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-white transition text-sm ${
          nextDisabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-[#166534] hover:bg-[#14532d]'
        }`}
        style={{ fontWeight: 600 }}>
        {nextLabel} <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

//  Main Component

export type MasterlistMatchStatus = 'idle' | 'checking' | 'matched' | 'unmatched';

export default function RegisterAlumniPersonal({
  onComplete,
  initialForm,
  initialBiometric,
  fieldErrors,
}: {
  onComplete: (formData: PersonalFormData, biometricData?: BiometricData, matchStatus?: MasterlistMatchStatus) => void | Promise<void>;
  /** Seeded when the graduate is sent back to fix a rejected field, so nothing
   *  they already typed is lost. */
  initialForm?: PersonalFormData | null;
  /** An existing face capture. Present on a correction pass so the camera step
   *  is not repeated — re-scanning is the most costly thing to lose. */
  initialBiometric?: BiometricData | null;
  /** Server-reported problems, keyed by field name. */
  fieldErrors?: Record<string, string> | null;
}) {
  const navigate = useNavigate();

  // Form state
  const [form, setForm] = useState<PersonalFormData>(initialForm ?? INITIAL_PERSONAL_FORM);
  const [step, setStep] = useState<PersonalStep>(1);
  const [stepError, setStepError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  // Smooth-scroll the active step's error banner into view whenever a new
  // error fires. Each step's banner gets `ref={errorRef}` - only one is
  // mounted at a time, so the ref always points at the visible banner.
  useEffect(() => {
    if (stepError && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [stepError]);
  const [showPass, setShowPass] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  // Biometric capture state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  // Seeded from an earlier capture when the graduate is sent back to fix a
  // rejected field. Starting past the last stage marks the scan complete, so
  // they are never made to face the camera twice for one registration.
  const [shotIndex, setShotIndex] = useState(initialBiometric ? CAPTURE_STAGE_COUNT : 0);
  const [previews, setPreviews] = useState<string[]>([]);
  // The one frontal photo kept from the identity burst.
  const [identityShot, setIdentityShot] = useState<Blob | null>(initialBiometric?.image ?? null);
  const [identityGps, setIdentityGps] = useState<GpsFix | null>(initialBiometric?.gps ?? null);
  const [descriptorSamples, setDescriptorSamples] = useState<number[][]>(
    initialBiometric?.descriptorSamples ?? [],
  );
  const [livenessSignals, setLivenessSignals] = useState<LivenessSignal[]>(
    initialBiometric?.livenessSignals ?? [],
  );
  const [checkingBlur, setCheckingBlur] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [captureTime, setCaptureTime] = useState<string | null>(null);
  // Auto-capture: detect the slot's gesture in real time, then count down and
  // capture automatically. Manual capture stays available.
  const [faceDetected, setFaceDetected] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);
  const detectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturingRef = useRef(false);
  // Timestamp the current gesture was first satisfied, so "hold" is measured in
  // real milliseconds rather than in detector ticks.
  const holdStartRef = useRef<number | null>(null);
  const blinkDetectorRef = useRef<BlinkDetector>(createBlinkDetector());
  // Randomized head-turn direction (per session) prevents replay with a fixed
  // pre-recorded video.
  const [headTurnDirection] = useState<HeadTurnDirection>(
    () => (Math.random() < 0.5 ? 'left' : 'right'),
  );
  const shotInstructions = useMemo(
    () => buildShotInstructions(headTurnDirection),
    [headTurnDirection],
  );

  useEffect(() => { return () => stopCamera(); }, []);

  // Rebuild the thumbnail from a carried-over capture so the verification step
  // shows the existing photo rather than an empty frame on a correction pass.
  useEffect(() => {
    if (!initialBiometric?.image) return;
    const url = URL.createObjectURL(initialBiometric.image);
    setPreviews([url]);
    return () => URL.revokeObjectURL(url);
  }, [initialBiometric]);

  // Warm up the face models as soon as the user reaches the verification step
  // so the first detection isn't delayed by a cold model load.
  useEffect(() => {
    if (step === 4) void ensureModernFaceModelsLoaded();
  }, [step]);

  // Returns true when the live frame satisfies the current stage's pose. Blink
  // is deliberately absent here: it is a transition over time, not a property
  // of one frame, so it is handled by the blink detector in the loop below.
  const isSlotConditionMet = (positions: { x: number; y: number }[]): boolean => {
    const challenge = shotInstructions[shotIndex];
    if (!challenge) return false;
    const mar = computeMouthAspectRatio(positions);
    const yaw = estimateHeadYawDegrees(positions);
    if (challenge.kind === 'neutral') {
      return Math.abs(yaw) <= FRONTAL_YAW_TOLERANCE_DEG && mar <= MOUTH_OPEN_MAR_THRESHOLD;
    }
    // Non-mirrored feed: turning to your LEFT produces a positive yaw, turning to
    // your RIGHT a negative yaw.
    if (challenge.kind === 'head_turn_left') {
      return yaw >= HEAD_TURN_YAW_THRESHOLD_DEG;
    }
    if (challenge.kind === 'head_turn_right') {
      return yaw <= -HEAD_TURN_YAW_THRESHOLD_DEG;
    }
    return false;
  };

  // Real-time liveness loop, sampled every FACE_SAMPLE_INTERVAL_MS.
  //
  // Stage 1 (neutral) holds a frontal pose briefly, then fires the identity
  // burst — the only stage that saves a photo. Stage 2 (blink) waits for a full
  // open→closed→open transition. Stage 3 (turn) holds a gentle yaw. Neither
  // liveness stage captures an image, so neither can pollute the face template.
  useEffect(() => {
    const clearDetect = () => {
      if (detectIntervalRef.current) {
        clearInterval(detectIntervalRef.current);
        detectIntervalRef.current = null;
      }
      holdStartRef.current = null;
    };

    if (!cameraOn || shotIndex >= shotInstructions.length) {
      clearDetect();
      setAutoCountdown(null);
      setFaceDetected(false);
      return;
    }

    const challenge = shotInstructions[shotIndex];
    if (challenge.kind === 'blink') {
      blinkDetectorRef.current.reset();
    }

    detectIntervalRef.current = setInterval(async () => {
      if (capturingRef.current) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      try {
        const landmarks = await extractFaceLandmarksFromVideo(video);
        setFaceDetected(!!landmarks);

        if (challenge.kind === 'blink') {
          const blinked = blinkDetectorRef.current.push(landmarks);
          if (blinked) {
            capturingRef.current = true;
            void completeLivenessStage(landmarks);
          }
          return;
        }

        const met = landmarks ? isSlotConditionMet(landmarks) : false;
        if (!met) {
          holdStartRef.current = null;
          setAutoCountdown(null);
          return;
        }

        const now = Date.now();
        if (holdStartRef.current === null) holdStartRef.current = now;
        const heldFor = now - holdStartRef.current;
        const required = challenge.kind === 'neutral' ? FRONTAL_HOLD_MS : TURN_HOLD_MS;

        if (heldFor >= required) {
          holdStartRef.current = null;
          setAutoCountdown(null);
          capturingRef.current = true;
          if (challenge.kind === 'neutral') {
            void captureIdentityBurst();
          } else {
            void completeLivenessStage(landmarks);
          }
          return;
        }

        // Show the remaining hold as a coarse 1-second-ish countdown so the
        // existing on-screen counter still reads naturally.
        setAutoCountdown(Math.max(1, Math.ceil((required - heldFor) / 1000)));
      } catch {
        /* transient detection error - keep polling */
      }
    }, FACE_SAMPLE_INTERVAL_MS);

    return clearDetect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, shotIndex, headTurnDirection]);

  // Live cascading location data sourced from the reference API (same source
  // of truth used by the employment form / admin reference-data CRUD).
  const { data: referenceData } = useReferenceData();
  const apiRegions: RegionItem[] = useMemo(() => {
    const list = referenceData?.regions ?? [];
    // Safety-net dedup by display name in case legacy seed rows remain.
    return Array.from(new Map(list.map(r => [r.name, r])).values());
  }, [referenceData]);
  const [apiProvinces, setApiProvinces] = useState<ProvinceItem[]>([]);
  const [apiCities, setApiCities] = useState<CityMunicipalityItem[]>([]);

  // Legacy ph-locations.json kept only as a barangay fallback; barangays are
  // not yet exposed in the reference API.
  const [phLocations, setPhLocations] = useState<PhLocations | null>(null);
  useEffect(() => {
    fetch('/ph-locations.json').then(r => r.json()).then(setPhLocations).catch(() => {});
  }, []);

  // Real-time masterlist check (fires in Step 2 when name fields have values)
  const [matchStatus, setMatchStatus] = useState<'idle' | 'checking' | 'matched' | 'unmatched'>('idle');
  useEffect(() => {
    if (!form.firstName.trim() || !form.familyName.trim()) {
      setMatchStatus('idle');
      return;
    }
    setMatchStatus('checking');
    const params = new URLSearchParams({
      first_name: form.firstName.trim(),
      last_name: form.familyName.trim(),
    });
    if (form.graduationYear) {
      params.set('graduation_year', String(form.graduationYear));
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/alumni/masterlist-check/?${params}`);
        const data = await res.json();
        setMatchStatus(data.matched ? 'matched' : 'unmatched');
      } catch {
        setMatchStatus('idle');
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.firstName, form.familyName, form.graduationYear]);

  // PH path: load provinces when region changes; load cities when province (or
  // region with no provinces, e.g. NCR) changes. Mirrors register-alumni-employment.tsx.
  useEffect(() => {
    if (form.homeIsAbroad || !form.region) { setApiProvinces([]); return; }
    const region = apiRegions.find(r => r.name === form.region);
    if (!region) { setApiProvinces([]); return; }
    let active = true;
    void provincesApi
      .list(region.id)
      .then(({ provinces }) => { if (active) setApiProvinces(provinces); })
      .catch(() => { if (active) setApiProvinces([]); });
    return () => { active = false; };
  }, [form.homeIsAbroad, form.region, apiRegions]);

  useEffect(() => {
    if (form.homeIsAbroad || !form.region) { setApiCities([]); return; }
    const region = apiRegions.find(r => r.name === form.region);
    if (!region) { setApiCities([]); return; }
    let active = true;
    if (form.province) {
      const province = apiProvinces.find(p => p.name === form.province);
      if (!province) { setApiCities([]); return; }
      void citiesApi
        .list({ provinceId: province.id })
        .then(({ cities }) => { if (active) setApiCities(cities); })
        .catch(() => { if (active) setApiCities([]); });
    } else if (apiProvinces.length === 0) {
      void citiesApi
        .list({ regionId: region.id })
        .then(({ cities }) => { if (active) setApiCities(cities); })
        .catch(() => { if (active) setApiCities([]); });
    } else {
      setApiCities([]);
    }
    return () => { active = false; };
  }, [form.homeIsAbroad, form.region, form.province, apiRegions, apiProvinces]);

  // Barangay fallback uses the legacy JSON (not yet in reference API).
  const phLegacyRegions = phLocations?.regions ?? [];
  const phLegacyProvinces = phLegacyRegions.find(r => r.name === form.region)?.provinces ?? [];
  const phLegacyCities = phLegacyProvinces.find(p => p.name === form.province)?.cities ?? [];
  const phBarangays = phLegacyCities.find(c => c.name === form.city)?.barangays ?? [];

  const inputCls = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

  // Live password-strength criteria. Length is the primary driver (per NIST
  // 800-63B), with a small composition checklist the user watches turn green.
  const passwordChecks = useMemo(() => {
    const p = form.password;
    return {
      length: p.length >= 8,
      upper: /[A-Z]/.test(p),
      lower: /[a-z]/.test(p),
      number: /[0-9]/.test(p),
      special: /[^A-Za-z0-9]/.test(p),
    };
  }, [form.password]);
  const passwordStrong = Object.values(passwordChecks).every(Boolean);

  //  Input handlers
  const setF = (field: keyof PersonalFormData, value: PersonalFormData[keyof PersonalFormData]) => {
    setForm(f => ({ ...f, [field]: value }));
  };

  const toggleArr = (field: keyof PersonalFormData, value: string) => {
    setForm(f => {
      const arr = f[field] as string[];
      return { ...f, [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] };
    });
  };

  //  Validation
  const validatePersonalStep = (): boolean => {
    setStepError('');
    if (step === 1) {
      if (!form.email.trim() || !form.email.includes('@')) {
        setStepError('Please enter a valid email address.');
        return false;
      }
      if (!passwordStrong) {
        setStepError('Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.');
        return false;
      }
      if (form.password !== form.confirmPassword) {
        setStepError('Passwords do not match.');
        return false;
      }
    }
    if (step === 2) {
      if (!form.familyName.trim()) {
        setStepError('Family name is required.');
        return false;
      }
      if (!form.firstName.trim()) {
        setStepError('First name is required.');
        return false;
      }
      if (!form.gender) {
        setStepError('Gender is required.');
        return false;
      }
      if (!form.birthDate) {
        setStepError('Date of birth is required.');
        return false;
      }
      if (!form.mobile.trim()) {
        setStepError('Mobile number is required.');
        return false;
      }
      const mobileDigits = form.mobile.replace(/\D/g, '');
      if (form.mobileCountryCode === '+63') {
        // Philippine mobile must be 9XXXXXXXXX (10 digits) or 09XXXXXXXXX (11 digits).
        const normalizedPh = mobileDigits.startsWith('0') ? mobileDigits.slice(1) : mobileDigits;
        if (normalizedPh.length !== 10 || !normalizedPh.startsWith('9')) {
          setStepError('Philippine mobile numbers must start with 9 or 09 (e.g. 9171234567 or 09171234567).');
          return false;
        }
      } else if (mobileDigits.length < 6 || mobileDigits.length > 15) {
        setStepError('Please enter a valid mobile number (6–15 digits).');
        return false;
      }
      if (form.facebook.trim() && !isValidFacebookUrl(form.facebook)) {
        setStepError('Facebook URL must be a facebook.com, fb.com, or fb.me link.');
        return false;
      }
      if (form.homeIsAbroad) {
        if (!form.homeCountry.trim()) {
          setStepError('Country is required.');
          return false;
        }
        if (!form.region.trim()) {
          setStepError('State / Region is required.');
          return false;
        }
        if (!form.city.trim()) {
          setStepError('City is required.');
          return false;
        }
      } else {
        if (!form.region) {
          setStepError('Region is required.');
          return false;
        }
        if (apiProvinces.length > 0 && !form.province) {
          setStepError('Province is required.');
          return false;
        }
        if (!form.city) {
          setStepError('City / Municipality is required.');
          return false;
        }
      }
    }
    if (step === 3) {
      if (!form.graduationDate.trim()) {
        setStepError('Graduation date is required.');
        return false;
      }
      if (form.furtherStudies === 'enrolled' || form.furtherStudies === 'completed') {
        if (!form.postgradProgram.trim()) {
          setStepError('Program / Degree is required for further studies.');
          return false;
        }
        if (!form.postgradSchool.trim()) {
          setStepError('School / University is required for further studies.');
          return false;
        }
        const startYear = Number(form.postgradYearStarted);
        if (!startYear || startYear < 1980 || startYear > new Date().getFullYear()) {
          setStepError('Please enter a valid Year Started (1980–present).');
          return false;
        }
        if (form.furtherStudies === 'completed') {
          const endYear = Number(form.postgradYearCompleted);
          if (!endYear || endYear < 1980 || endYear > new Date().getFullYear()) {
            setStepError('Please enter a valid Year Completed (1980–present).');
            return false;
          }
          if (endYear < startYear) {
            setStepError('Year Completed cannot be earlier than Year Started.');
            return false;
          }
        }
      }
    }
    return true;
  };

  const nextPersonalStep = () => {
    if (!validatePersonalStep()) return;

    if (step === 3) {
      // Always collect biometrics - backend requires face images for all alumni
      setStep(4 as PersonalStep);
    } else {
      setStep((s) => (s + 1) as PersonalStep);
    }
  };

  const prevPersonalStep = () => {
    setStepError('');
    setStep((s) => (s - 1) as PersonalStep);
  };

  //  Camera handlers
  const startCamera = async () => {
    setCameraError('');
    setStepError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError('Camera access denied. Please allow camera permission and try again.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  // Grab one frame off the live video as a JPEG data URL.
  const grabFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return null;
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);
    return canvasRef.current.toDataURL('image/jpeg', 0.9);
  };

  const advanceStage = () => {
    const isLastStage = shotIndex >= shotInstructions.length - 1;
    setShotIndex((i) => i + 1);
    if (isLastStage) stopCamera();
  };

  /**
   * Stage 1 only. Captures IDENTITY_BURST_FRAMES frontal frames a short gap
   * apart and averages their descriptors into the face template. Every frame is
   * frontal, so averaging genuinely cancels per-frame noise — unlike the old
   * flow, which averaged a frontal frame with two turned ones and produced a
   * template that matched none of them well. Only the first frame is kept as
   * the stored photo.
   */
  const captureIdentityBurst = async () => {
    setAutoCountdown(null);
    setStepError('');
    setCheckingBlur(true);

    try {
      const firstDataUrl = grabFrame();
      if (!firstDataUrl) {
        setStepError('Unable to capture image. Please try again.');
        return;
      }

      if (await isImageBlurry({ dataUrl: firstDataUrl, threshold: FACE_BLUR_THRESHOLD })) {
        setStepError('Image too blurry — hold still and make sure the lighting is good.');
        return;
      }

      const landmarks = await extractFaceLandmarksFromDataUrl(firstDataUrl);
      if (!landmarks) {
        setStepError('Could not read facial landmarks. Please try again.');
        return;
      }
      const yaw = estimateHeadYawDegrees(landmarks);
      if (Math.abs(yaw) > FRONTAL_YAW_TOLERANCE_DEG) {
        setStepError('Please face the camera directly.');
        return;
      }
      if (computeMouthAspectRatio(landmarks) > MOUTH_OPEN_MAR_THRESHOLD) {
        setStepError('Please close your mouth for the identity photo.');
        return;
      }

      const samples: number[][] = [];
      const first = await extractFaceDescriptorFromDataUrl(firstDataUrl);
      if (!first) {
        setStepError('Could not detect your face. Please try again.');
        return;
      }
      samples.push(first);

      // Remaining burst frames are best-effort: a dropped frame just means a
      // slightly noisier template, never a failed registration.
      for (let i = 1; i < IDENTITY_BURST_FRAMES; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, IDENTITY_BURST_GAP_MS));
        const extraUrl = grabFrame();
        if (!extraUrl) continue;
        const extraLandmarks = await extractFaceLandmarksFromDataUrl(extraUrl);
        if (!extraLandmarks) continue;
        if (Math.abs(estimateHeadYawDegrees(extraLandmarks)) > FRONTAL_YAW_TOLERANCE_DEG) continue;
        const extra = await extractFaceDescriptorFromDataUrl(extraUrl);
        if (extra) samples.push(extra);
      }

      const blob = await (await fetch(firstDataUrl)).blob();

      // Stamp the capture with its location for the audit trail (PRD Module A).
      // Requested here rather than on page load so the browser prompt appears
      // in context, and awaited only after the photo is secured so a slow or
      // denied fix cannot cost the user their capture.
      setIdentityGps(await captureGps());

      setCaptureTime(new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }));
      setPreviews([firstDataUrl]);
      setIdentityShot(blob);
      setDescriptorSamples(samples);
      setLivenessSignals((l) => [
        ...l,
        { mouthAspectRatio: computeMouthAspectRatio(landmarks), yawDegrees: yaw, detected: true },
      ]);
      advanceStage();
    } catch (err) {
      console.error(err);
      setStepError('Error capturing image. Please try again.');
    } finally {
      setCheckingBlur(false);
      capturingRef.current = false;
    }
  };

  /**
   * Stages 2 and 3 (blink, head turn). Records the measured signal for the
   * audit trail and advances. Deliberately saves no photo and no descriptor.
   */
  const completeLivenessStage = async (landmarks: { x: number; y: number }[] | null) => {
    try {
      setStepError('');
      setAutoCountdown(null);
      setLivenessSignals((l) => [
        ...l,
        {
          mouthAspectRatio: landmarks ? computeMouthAspectRatio(landmarks) : 0,
          yawDegrees: landmarks ? estimateHeadYawDegrees(landmarks) : 0,
          detected: !!landmarks,
        },
      ]);
      advanceStage();
    } finally {
      capturingRef.current = false;
    }
  };

  const retakeAll = () => {
    setPreviews([]);
    setIdentityShot(null);
    setDescriptorSamples([]);
    setLivenessSignals([]);
    setShotIndex(0);
    setCaptureTime(null);
    setStepError('');
    setCheckingBlur(false);
    capturingRef.current = false;
    holdStartRef.current = null;
    blinkDetectorRef.current.reset();
    setAutoCountdown(null);
    setFaceDetected(false);
    void startCamera();
  };

  const handleBiometricSubmit = async () => {
    if (!identityShot || shotIndex < shotInstructions.length) {
      setStepError('Please complete all liveness challenges.');
      return;
    }

    setIsSaving(true);
    try {
      // Averaged across the frontal burst only — see captureIdentityBurst.
      const averagedDescriptor = averageFaceDescriptors(descriptorSamples);
      const biometricData: BiometricData = {
        image: identityShot,
        descriptor: averagedDescriptor,
        descriptorSamples,
        livenessSignals,
        headTurnDirection,
        gps: identityGps,
      };
      await onComplete(form, biometricData, matchStatus);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSaving(false);
    }
  };

  //  Main render
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => (step === 1 ? navigate('/') : prevPersonalStep())}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition"
        >
          <ArrowLeft className="size-4 text-gray-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#166534]">
            <GraduationCap className="size-4 text-white" />
          </div>
          <div>
            <p className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>
              Alumni Registration
            </p>
            <p className="text-gray-400 text-xs">Personal Information & Verification</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-lg">
          {/* Answers the server refused, shown on a correction pass. Everything
              else the graduate entered — including their face capture — is
              still held, so only these need fixing. */}
          {fieldErrors && Object.keys(fieldErrors).length > 0 && (
            <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5">
              <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="text-red-800" style={{ fontWeight: 700 }}>
                  Please correct {Object.keys(fieldErrors).length === 1 ? 'this answer' : 'these answers'}
                </p>
                <ul className="mt-1 list-disc list-inside text-red-700 space-y-0.5">
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
                </ul>
                <p className="text-red-600/80 mt-1.5">Your other details and face scan have been kept.</p>
              </div>
            </div>
          )}

          {/* Stepper */}
          <div className="flex items-center mb-8">
            {PERSONAL_STEP_CONFIG.map((s, i) => (
              <div key={s.n} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={`flex size-7 items-center justify-center rounded-full text-xs transition-all ${
                      step > s.n
                        ? 'bg-emerald-500 text-white'
                        : step === s.n
                          ? 'bg-[#166534] text-white'
                          : 'bg-gray-200 text-gray-400'
                    }`}
                    style={{ fontWeight: 700 }}
                  >
                    {step > s.n ? <CheckCircle2 className="size-3.5" /> : s.n}
                  </div>
                  <p
                    className={`mt-1 whitespace-nowrap text-center ${step >= s.n ? 'text-gray-700' : 'text-gray-400'}`}
                    style={{ fontWeight: step === s.n ? 600 : 400, fontSize: '0.62rem' }}
                  >
                    {s.label}
                  </p>
                </div>
                {i < 3 && <div className={`flex-1 h-px mx-1 mb-5 ${step > s.n ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          {/* STEP 1: Account Setup */}
          {step === 1 && (
            <div className="gt-rise bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={Lock} title="Create Your Account" subtitle="Set up your login credentials for the Graduate Portal." />

              {stepError && (
                <div ref={errorRef} className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5 scroll-mt-24">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                    <input
                      type="email"
                      placeholder="your.email@example.com"
                      value={form.email}
                      onChange={(e) => setF('email', e.target.value)}
                      className={`${inputCls} pl-10`}
                    />
                  </div>
                  <p className="text-gray-400 text-xs mt-1.5">This will be your login email address.</p>
                </div>

                {/* Live password-strength checklist - turns green as each
                    requirement is satisfied. Shown once the user focuses or
                    starts typing a password. */}
                {(pwFocused || form.password.length > 0) && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-gray-600 text-[11px] mb-2" style={{ fontWeight: 600 }}>
                      Your password must include:
                    </p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {[
                        { ok: passwordChecks.length, label: 'At least 8 characters' },
                        { ok: passwordChecks.upper, label: 'An uppercase letter (A–Z)' },
                        { ok: passwordChecks.lower, label: 'A lowercase letter (a–z)' },
                        { ok: passwordChecks.number, label: 'A number (0–9)' },
                        { ok: passwordChecks.special, label: 'A special character (!@#$…)' },
                      ].map((req) => (
                        <li key={req.label} className="flex items-center gap-1.5">
                          {req.ok
                            ? <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                            : <Circle className="size-3.5 text-gray-300 shrink-0" />}
                          <span className={`text-[11px] ${req.ok ? 'text-emerald-700' : 'text-gray-500'}`} style={{ fontWeight: req.ok ? 600 : 400 }}>
                            {req.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showPass ? 'text' : 'password'}
                        placeholder="Min. 8 characters"
                        value={form.password}
                        onChange={(e) => setF('password', e.target.value)}
                        onFocus={() => setPwFocused(true)}
                        onBlur={() => setPwFocused(false)}
                        className={`${inputCls} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      placeholder="Repeat password"
                      value={form.confirmPassword}
                      onChange={(e) => setF('confirmPassword', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} navigationUrl="/" />
              <p className="text-center text-gray-400 text-xs mt-4">
                Already have an account?{' '}
                <button onClick={() => navigate('/')} className="text-[#166534] hover:underline" style={{ fontWeight: 500 }}>
                  Sign in
                </button>
              </p>
            </div>
          )}

          {/* STEP 2: Personal Information */}
          {step === 2 && (
            <div className="gt-rise bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={User} title="Personal Information" subtitle="Your basic details and contact information." />

              {stepError && (
                <div ref={errorRef} className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5 scroll-mt-24">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Family Name *
                    </label>
                    <input
                      type="text"
                      placeholder="Surname"
                      value={form.familyName}
                      onChange={(e) => setF('familyName', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      First Name *
                    </label>
                    <input
                      type="text"
                      placeholder="Given name"
                      value={form.firstName}
                      onChange={(e) => setF('firstName', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Middle Name
                    </label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={form.middleName}
                      onChange={(e) => setF('middleName', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Masterlist match indicator */}
                {matchStatus === 'checking' && (
                  <div className="flex items-center gap-2 text-gray-400 text-xs">
                    <span className="size-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    Checking graduate list…
                  </div>
                )}
                {matchStatus === 'matched' && (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-700 text-xs">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span><strong>Found in BSIS graduate list.</strong> Your account will be automatically verified once submitted.</span>
                  </div>
                )}
                {matchStatus === 'unmatched' && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700 text-xs">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>Not found in the masterlist. Your account will go through manual admin verification.</span>
                  </div>
                )}

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Gender *
                  </label>
                  <div className="flex gap-2">
                    {['Male', 'Female'].map((g) => (
                      <RadioOption key={g} label={g} value={g} current={form.gender} onSelect={(v) => setF('gender', v as string)} />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Birth Date * <span className="text-gray-400 font-normal">(month &amp; year)</span>
                    </label>
                    <input
                      type="month"
                      value={form.birthDate}
                      onChange={(e) => setF('birthDate', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                      Civil Status
                    </label>
                    <select value={form.civilStatus} onChange={(e) => setF('civilStatus', e.target.value)} className={inputCls}>
                      <option value="">Select</option>
                      <option>Single</option>
                      <option>Married</option>
                      <option>Widowed</option>
                      <option>Separated</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Mobile Number *
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={form.mobileCountryCode}
                      onChange={(e) => setF('mobileCountryCode', e.target.value)}
                      className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                    >
                      <option value="+63">+63 Philippines</option>
                      <option value="+1">+1 United States</option>
                      <option value="+44">+44 United Kingdom</option>
                      <option value="+61">+61 Australia</option>
                      <option value="+65">+65 Singapore</option>
                      <option value="+60">+60 Malaysia</option>
                      <option value="+81">+81 Japan</option>
                      <option value="+82">+82 Korea</option>
                      <option value="+86">+86 China</option>
                      <option value="+971">+971 UAE</option>
                    </select>
                    <div className="relative flex-1 flex items-stretch">
                      {form.mobileCountryCode === '+63' && (
                        <span className="inline-flex items-center px-2.5 border border-r-0 border-gray-200 rounded-l-lg bg-gray-50 text-gray-600 text-sm font-medium select-none">
                          +63
                        </span>
                      )}
                      <div className="relative flex-1">
                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input
                          type="tel"
                          placeholder={form.mobileCountryCode === '+63' ? '9XX XXX XXXX' : 'Mobile number'}
                          value={form.mobile}
                          maxLength={form.mobileCountryCode === '+63' ? 10 : 15}
                          onChange={(e) => {
                            let digits = e.target.value.replace(/\D/g, '');
                            if (form.mobileCountryCode === '+63' && digits.startsWith('0')) {
                              digits = digits.replace(/^0+/, '');
                            }
                            setF('mobile', digits);
                          }}
                          className={`${inputCls} pl-10 ${form.mobileCountryCode === '+63' ? 'rounded-l-none' : ''}`}
                        />
                      </div>
                    </div>
                  </div>
                  {form.mobileCountryCode === '+63' && (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      Enter a 10-digit Philippine mobile number; we&apos;ll prefix +63 automatically.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Facebook URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://facebook.com/yourprofile"
                    value={form.facebook}
                    onChange={(e) => setF('facebook', e.target.value)}
                    className={inputCls}
                  />
                  {form.facebook.trim().length > 0 && !isValidFacebookUrl(form.facebook) && (
                    <p className="mt-1.5 text-[11px] text-red-600">
                      Please paste a Facebook profile link (facebook.com, fb.com, or fb.me).
                    </p>
                  )}
                </div>

                {/* Home address - toggle between Philippines (cascading dropdowns) and Outside Philippines (free-text) */}
                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Home Address Location
                  </label>
                  <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="tablist">
                    <button
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, homeIsAbroad: false, homeCountry: 'Philippines' }));
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition ${!form.homeIsAbroad ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      Philippines
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, homeIsAbroad: true, region: '', province: '', city: '', barangay: '', homeCountry: f.homeCountry === 'Philippines' ? '' : f.homeCountry }));
                      }}
                      className={`px-3 py-1.5 text-xs rounded-md transition ${form.homeIsAbroad ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      Outside Philippines
                    </button>
                  </div>
                </div>

                {!form.homeIsAbroad && (
                  <>
                    {/* Cascading PH location: Region → Province → City → Barangay */}
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Region *
                      </label>
                      <select
                        value={form.region}
                        onChange={(e) => { setF('region', e.target.value); setF('province', ''); setF('city', ''); setF('barangay', ''); }}
                        className={inputCls}
                      >
                        <option value="">Select Region</option>
                        {apiRegions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          Province *
                        </label>
                        <select
                          value={form.province}
                          onChange={(e) => { setF('province', e.target.value); setF('city', ''); setF('barangay', ''); }}
                          disabled={!form.region || apiProvinces.length === 0}
                          className={inputCls}
                        >
                          <option value="">{apiProvinces.length === 0 && form.region ? 'No provinces (pick city below)' : 'Select Province'}</option>
                          {apiProvinces.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          City / Municipality *
                        </label>
                        <select
                          value={form.city}
                          onChange={(e) => { setF('city', e.target.value); setF('barangay', ''); }}
                          disabled={!form.region || apiCities.length === 0}
                          className={inputCls}
                        >
                          <option value="">Select City</option>
                          {apiCities.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Barangay <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      {phBarangays.length > 0 ? (
                        <select
                          value={form.barangay}
                          onChange={(e) => setF('barangay', e.target.value)}
                          disabled={!form.city}
                          className={inputCls}
                        >
                          <option value="">Select Barangay</option>
                          {phBarangays.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder={form.city ? 'Enter barangay' : 'Select a city first'}
                          value={form.barangay}
                          onChange={(e) => setF('barangay', e.target.value)}
                          disabled={!form.city}
                          className={inputCls}
                        />
                      )}
                    </div>
                  </>
                )}

                {form.homeIsAbroad && (
                  <>
                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Country *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. United Arab Emirates"
                        value={form.homeCountry}
                        onChange={(e) => setF('homeCountry', e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          State / Region *
                        </label>
                        <input
                          type="text"
                          placeholder="State or region"
                          value={form.region}
                          onChange={(e) => setF('region', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          Province / County
                        </label>
                        <input
                          type="text"
                          placeholder="Province or county (optional)"
                          value={form.province}
                          onChange={(e) => setF('province', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          City *
                        </label>
                        <input
                          type="text"
                          placeholder="City"
                          value={form.city}
                          onChange={(e) => setF('city', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          Street / Postal Code
                        </label>
                        <input
                          type="text"
                          placeholder="Street, ZIP / postal code"
                          value={form.barangay}
                          onChange={(e) => setF('barangay', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} />
            </div>
          )}

          {/* STEP 3: Education Background */}
          {step === 3 && (
            <div className="gt-rise bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <SectionHeader icon={BookOpen} title="Educational Background" subtitle="Your graduation and academic details." />

              {stepError && (
                <div ref={errorRef} className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5 scroll-mt-24">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-sm">{stepError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
                  Every CHMSU Talisay BSIS alumnus already holds a Bachelor's degree, so we only ask about graduation date and any post-baccalaureate studies you've taken.
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Date of Graduation (BSIS) * <span className="text-gray-400 font-normal">(month &amp; year)</span>
                  </label>
                  <input
                    type="month"
                    value={form.graduationDate}
                    onChange={(e) => {
                      const v = e.target.value;  // "YYYY-MM" from <input type="month">
                      setF('graduationDate', v);
                      // Year-only parse, timezone-safe. Empty string clears the year.
                      const yearStr = v.slice(0, 4);
                      const year = /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
                      setF('graduationYear', year);
                    }}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                    Scholarship Availed
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. CHED, SUC Scholar, None"
                    value={form.scholarship}
                    onChange={(e) => setF('scholarship', e.target.value)}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Are you currently pursuing or have you completed further studies? *
                  </label>
                  <select
                    value={form.furtherStudies}
                    onChange={(e) => setF('furtherStudies', e.target.value as PersonalFormData['furtherStudies'])}
                    className={inputCls}
                  >
                    <option value="none">No - only my BSIS Bachelor&apos;s degree</option>
                    <option value="enrolled">Yes, currently enrolled</option>
                    <option value="completed">Yes, already completed</option>
                  </select>
                </div>

                {(form.furtherStudies === 'enrolled' || form.furtherStudies === 'completed') && (
                  <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-gray-700 text-xs" style={{ fontWeight: 600 }}>
                      {form.furtherStudies === 'enrolled' ? 'Tell us about your current program' : 'Tell us about the completed program'}
                    </p>

                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Program / Degree *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Master of Information Technology, MBA, PhD in Computer Science"
                        value={form.postgradProgram}
                        onChange={(e) => setF('postgradProgram', e.target.value)}
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        Field / Specialization
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Data Science, Information Security"
                        value={form.postgradField}
                        onChange={(e) => setF('postgradField', e.target.value)}
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                        School / University *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. University of the Philippines"
                        value={form.postgradSchool}
                        onChange={(e) => setF('postgradSchool', e.target.value)}
                        className={inputCls}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                          Year Started *
                        </label>
                        <input
                          type="number"
                          min={1980}
                          max={new Date().getFullYear()}
                          placeholder="e.g. 2023"
                          value={form.postgradYearStarted}
                          onChange={(e) => setF('postgradYearStarted', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      {form.furtherStudies === 'completed' && (
                        <div>
                          <label className="block text-gray-700 text-xs mb-1.5" style={{ fontWeight: 600 }}>
                            Year Completed *
                          </label>
                          <input
                            type="number"
                            min={1980}
                            max={new Date().getFullYear()}
                            placeholder="e.g. 2025"
                            value={form.postgradYearCompleted}
                            onChange={(e) => setF('postgradYearCompleted', e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                    Professional Eligibility / Certifications
                  </label>
                  <div className="space-y-1.5">
                    {['Civil Service Exam', 'TESDA', 'Board Exam', 'Others'].map((opt) => (
                      <CheckOption
                        key={opt}
                        label={opt}
                        checked={form.profEligibility.includes(opt)}
                        onChange={() => toggleArr('profEligibility', opt)}
                      />
                    ))}
                  </div>
                  {form.profEligibility.includes('Others') && (
                    <input
                      type="text"
                      placeholder="Please specify certification"
                      value={form.profEligibilityOther}
                      onChange={(e) => setF('profEligibilityOther', e.target.value)}
                      className={`${inputCls} mt-2`}
                    />
                  )}
                </div>
              </div>

              <NavButtons onBack={prevPersonalStep} onNext={nextPersonalStep} nextLabel="Verify Identity" />
            </div>
          )}

          {/* STEP 4: Biometric Verification (all alumni) */}
          {step === 4 && (() => {
            const allCaptured = shotIndex >= shotInstructions.length;
            return (
              <div className="gt-rise space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 shrink-0">
                      <Camera className="size-5 text-emerald-600" />
                    </div>
                    <div>
                      <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Face Recognition</h2>
                      <p className="text-gray-500 text-xs mt-0.5">
                        We take one photo, then two quick checks to confirm you are present in real time: blink, then a small head turn.
                      </p>
                    </div>
                  </div>

                  {/* Accessory removal warning - persistent (not dismissible) */}
                  <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-3">
                    <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 leading-relaxed">
                      <p style={{ fontWeight: 700 }}>Before you begin</p>
                      <p className="mt-0.5">
                        Please remove anything that hides your face - sunglasses, hats, face masks, or thick reflective glasses.
                        Make sure your face is well-lit. You will be asked to face the camera for one photo, then to blink
                        and turn your head slightly. Only the first photo is saved.
                      </p>
                    </div>
                  </div>

                  {stepError && (
                    <div ref={errorRef} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3 scroll-mt-24">
                      <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-700 text-xs">{stepError}</p>
                    </div>
                  )}
                  {cameraError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                      <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-red-700 text-xs">{cameraError}</p>
                    </div>
                  )}

                  {/* Shot progress tiles */}
                  <div className="flex gap-2 mb-4">
                    {shotInstructions.map((s, i) => {
                      // The open-mouth liveness step saves no preview, so derive
                      // completion from shotIndex rather than previews[i].
                      const done = shotIndex > i;
                      return (
                      <div key={i} className={`flex-1 rounded-xl border p-2.5 text-center transition ${
                        done ? 'border-emerald-200 bg-emerald-50' :
                        shotIndex === i && cameraOn ? 'border-[#166534] bg-[#166534]/5' :
                        'border-gray-200 bg-gray-50'
                      }`}>
                        <div className={`flex size-6 items-center justify-center rounded-full mx-auto mb-1 ${
                          done ? 'bg-emerald-500' :
                          shotIndex === i && cameraOn ? 'bg-[#166534]' : 'bg-gray-200'
                        }`}>
                          {done
                            ? <CheckCircle2 className="size-3.5 text-white" />
                            : <span className="text-white" style={{ fontWeight: 700, fontSize: '0.6rem' }}>{i + 1}</span>}
                        </div>
                        <p className={`whitespace-nowrap text-center ${
                          done ? 'text-emerald-700' :
                          shotIndex === i && cameraOn ? 'text-[#166534]' : 'text-gray-400'
                        }`} style={{ fontWeight: 600, fontSize: '0.6rem' }}>
                          {s.label}
                        </p>
                      </div>
                      );
                    })}
                  </div>

                  {/* Camera viewport */}
                  <div className="relative bg-gray-900 rounded-2xl overflow-hidden mb-4 flex items-center justify-center w-full max-w-[400px] mx-auto" style={{ aspectRatio: '4/3', maxHeight: '300px' }}>
                    {!cameraOn && !allCaptured && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <Camera className="size-12 text-gray-600 mb-2" />
                        <p className="text-gray-400 text-sm">Camera not started</p>
                        <p className="text-gray-600 text-xs mt-1">Tap "Start Camera" below</p>
                      </div>
                    )}

                    {/* Mirror the live preview so it reads like a mirror (turn
                        left -> on-screen face turns left). Capture still draws the
                        raw, un-mirrored frame, so the yaw-based left/right
                        detection and the saved photos are unaffected. */}
                    <video
                      ref={videoRef}
                      className={`absolute inset-0 w-full h-full object-cover object-center -scale-x-100 ${(!cameraOn || allCaptured) ? 'hidden' : ''}`}
                      playsInline muted autoPlay
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Verification complete - the single stored identity photo */}
                    {allCaptured && previews[0] && (
                      <div className="absolute inset-0">
                        <img src={previews[0]} alt="Identity photo" className="w-full h-full object-cover object-center" />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
                          <p className="text-white text-center" style={{ fontWeight: 600, fontSize: '0.65rem' }}>
                            Identity photo · liveness verified
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Face guide overlay when camera is live */}
                    {cameraOn && !allCaptured && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        {/* Guide ring: solid emerald while counting down, soft
                            emerald when a face is detected, dashed white idle. */}
                        <div className={`size-48 rounded-full border-2 transition-colors ${
                          autoCountdown !== null
                            ? 'border-solid border-emerald-400'
                            : faceDetected
                              ? 'border-dashed border-emerald-300'
                              : 'border-dashed border-white/50'
                        }`} />

                        {/* Big countdown number */}
                        {autoCountdown !== null && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-white drop-shadow-lg" style={{ fontWeight: 800, fontSize: '4rem', lineHeight: 1 }}>
                              {autoCountdown}
                            </span>
                          </div>
                        )}

                        {/* Detection status chip */}
                        <div className="absolute top-3 left-0 right-0 flex justify-center">
                          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${faceDetected ? 'bg-emerald-500/90' : 'bg-black/60'}`}>
                            <span className={`size-2 rounded-full ${faceDetected ? 'bg-white animate-pulse' : 'bg-gray-300'}`} />
                            <span className="text-white text-[11px]" style={{ fontWeight: 600 }}>
                              {faceDetected ? 'Face detected' : 'No face detected'}
                            </span>
                          </div>
                        </div>

                        {/* Instruction / countdown caption */}
                        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                          <div className="bg-black/65 rounded-full px-4 py-1.5">
                            <p className="text-white text-xs text-center" style={{ fontWeight: 600 }}>
                              {autoCountdown !== null
                                ? `Hold still — capturing in ${autoCountdown}…`
                                : `Shot ${shotIndex + 1}/${shotInstructions.length} - ${shotInstructions[shotIndex]?.label}: ${shotInstructions[shotIndex]?.desc}`}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Timestamp badge when all captured */}
                    {captureTime && allCaptured && (
                      <div className="absolute top-2 right-2 bg-black/60 rounded-lg px-2 py-1">
                        <span className="text-white text-xs">{captureTime}</span>
                      </div>
                    )}
                  </div>

                  {/* Camera controls */}
                  <div className="flex gap-2">
                    {!cameraOn && !allCaptured && (
                      <button onClick={startCamera}
                        className="flex-1 flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-2.5 rounded-xl text-sm transition"
                        style={{ fontWeight: 600 }}>
                        <Video className="size-4" /> Start Camera
                      </button>
                    )}
                    {cameraOn && !allCaptured && (
                      <>
                        <button onClick={stopCamera}
                          className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition"
                          title="Stop camera">
                          <VideoOff className="size-4" />
                        </button>
                        {/* Manual capture applies only to the identity photo.
                            The blink and head-turn stages are liveness gates —
                            they save nothing, so there is nothing to trigger by
                            hand; they simply detect and advance. */}
                        {shotInstructions[shotIndex]?.kind === 'neutral' ? (
                          <button onClick={() => { capturingRef.current = true; void captureIdentityBurst(); }}
                            disabled={checkingBlur}
                            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm transition"
                            style={{ fontWeight: 600 }}>
                            {checkingBlur
                              ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking clarity</>
                              : <><Camera className="size-4" /> Capture photo</>
                            }
                          </button>
                        ) : (
                          <div className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm"
                            style={{ fontWeight: 600 }}>
                            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                            {shotInstructions[shotIndex]?.desc}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Auto-capture hint */}
                  {cameraOn && !allCaptured && (
                    <p className="mt-2 text-center text-gray-400 text-[11px]">
                      Auto-captures when your face and the requested action are detected — or press <span className="text-gray-600" style={{ fontWeight: 600 }}>Capture now</span>.
                    </p>
                  )}

                  {allCaptured && (
                    <div className="flex">
                      <button onClick={retakeAll}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition"
                        style={{ fontWeight: 500 }}>
                        <RefreshCw className="size-4" /> Retake All
                      </button>
                    </div>
                  )}

                  {/* Success banner */}
                  {allCaptured && (
                    <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                      <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
                      <div>
                        <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>All liveness challenges passed!</p>
                        {captureTime && <p className="text-emerald-600 text-xs">{captureTime}</p>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Submit / back row */}
                <div className="flex gap-3">
                  <button onClick={prevPersonalStep}
                    className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 py-3 rounded-xl text-sm transition"
                    style={{ fontWeight: 500 }}>
                    <ChevronLeft className="size-4" /> Back
                  </button>
                  <button onClick={handleBiometricSubmit} disabled={isSaving || !allCaptured}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm transition ${
                      allCaptured && !isSaving ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                    style={{ fontWeight: 600 }}>
                    {isSaving
                      ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting...</>
                      : 'Continue to Employment Survey →'
                    }
                  </button>
                </div>
                {!allCaptured && (
                  <p className="text-center text-gray-400 text-xs">
                    All 3 liveness challenges (look forward, turn left, turn right) are required to continue.
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
