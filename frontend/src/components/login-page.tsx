import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import NextImage from "next/image";
import {
  GraduationCap, ArrowRight, ArrowLeft, Eye, EyeOff,
  AlertCircle, Mail, Camera, Video,
  CheckCircle2,
} from "lucide-react";
import {
  ADMIN_ACCESS_TOKEN_KEY,
  ALUMNI_ACCESS_TOKEN_KEY,
  API_BASE_URL,
  adminLogin,
  alumniLogin,
  ApiClientError,
  type AlumniLoginLivenessSignal,
} from "../app/api-client";
import ForgotPasswordModal from "./auth/forgot-password";
import {
  ensureModernFaceModelsLoaded,
  extractFaceDescriptorFromDataUrl,
  extractFaceLandmarksFromVideo,
  computeMouthAspectRatio,
  estimateHeadYawDegrees,
  createBlinkDetector,
  HEAD_TURN_YAW_THRESHOLD_DEG,
  FRONTAL_YAW_TOLERANCE_DEG,
  FACE_SAMPLE_INTERVAL_MS,
} from "../app/modern-face-descriptor";

// The open-mouth challenge was removed per the 2026 panel revision and replaced
// with a blink, which is both less awkward in public and a stronger signal — a
// still photo cannot produce the open→closed→open transition a blink requires.
type LoginChallenge = 'blink' | 'head_turn';

const LOGIN_CHALLENGES: LoginChallenge[] = ['blink', 'head_turn'];

function pickRandomLoginChallenge(): LoginChallenge {
  return LOGIN_CHALLENGES[Math.floor(Math.random() * LOGIN_CHALLENGES.length)];
}

function describeChallenge(challenge: LoginChallenge): { title: string; hint: string } {
  switch (challenge) {
    case 'blink':
      return { title: 'Blink once', hint: 'A single natural blink is enough' };
    case 'head_turn':
      // Direction-agnostic: the selfie preview is mirrored, so we accept a turn
      // to either side instead of guessing left/right.
      return { title: 'Turn your head', hint: 'Turn slightly to either side' };
  }
}

const LIVENESS_TIMEOUT_MS = 10000;
const schoolLogo = "/CHMSULogo.png";

type Phase = "login" | "facescan";

/**
 * Best-effort GPS capture for the login audit. Resolves to null on denial,
 * unavailability, or timeout - callers must tolerate nulls.
 */
async function captureLoginGps(timeoutMs = 4000): Promise<{ lat: number; lng: number; acc: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: timeoutMs },
    );
  });
}

/**
 * Capture a video frame clipped to the oval face guide.
 * The oval matches the CSS guide: 55% of video width, 3:4 aspect ratio, centred.
 * Pixels outside the oval are filled with a neutral grey so the model ignores background.
 */
function captureOvalFrame(video: HTMLVideoElement, quality = 0.85): string {
  const W = video.videoWidth;
  const H = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rx = W * 0.275;          // 55 % / 2
  const ry = rx * (4 / 3);       // 3 : 4 portrait oval
  const cx = W / 2;
  const cy = H / 2;
  ctx.fillStyle = "#d0d0d0";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();
  // Crop to oval bounding box so the model receives a tight face image
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.round(rx * 2);
  cropCanvas.height = Math.round(ry * 2);
  cropCanvas.getContext("2d")!.drawImage(
    canvas,
    Math.round(cx - rx), Math.round(cy - ry),
    Math.round(rx * 2), Math.round(ry * 2),
    0, 0,
    cropCanvas.width, cropCanvas.height,
  );
  return cropCanvas.toDataURL("image/jpeg", quality);
}

export function LoginPage() {
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("login");
  const [credential, setCredential] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [scanStage, setScanStage] = useState<"idle" | "aligning" | "challenge" | "detecting" | "matched" | "failed">("idle");
  const [cameraError, setCameraError] = useState("");
  const [faceAuthBusy, setFaceAuthBusy] = useState(false);
  const scanTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const autoDetectInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const alignIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alignTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livenessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The frontal frame + descriptor captured BEFORE the liveness challenge, used
  // for the actual face match so the match never sees a mid-gesture pose.
  const frontalCaptureRef = useRef<{ blob: Blob; descriptor: number[] } | null>(null);
  const [challenge, setChallenge] = useState<LoginChallenge>(() => pickRandomLoginChallenge());
  const [livenessPassed, setLivenessPassed] = useState(false);
  const livenessSignalRef = useRef<AlumniLoginLivenessSignal | null>(null);
  const [livenessCountdown, setLivenessCountdown] = useState<number | null>(null);
  const countdownValRef = useRef<number | null>(null);


  useEffect(() => {
    const timers = scanTimers.current;
    return () => {
      stopCamera();
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (phase === "facescan") {
      void ensureModernFaceModelsLoaded();
    }
  }, [phase]);

  // Alignment step (runs FIRST): wait for a clear, frontal face, then capture
  // the frame + descriptor used for the actual identity match. Doing this
  // before the liveness gesture guarantees the match never sees a turned head
  // or open mouth, which was causing "passed liveness but face not recognized".
  useEffect(() => {
    if (!cameraOn || scanStage !== "aligning" || faceAuthBusy) {
      if (alignIntervalRef.current) {
        clearInterval(alignIntervalRef.current);
        alignIntervalRef.current = null;
      }
      return;
    }

    alignTimeoutRef.current = setTimeout(() => {
      if (alignIntervalRef.current) {
        clearInterval(alignIntervalRef.current);
        alignIntervalRef.current = null;
      }
      setScanStage("failed");
      setCameraError("Couldn't get a clear, front-facing shot. Face the camera in good light and try again.");
      stopCamera();
    }, 15000);

    alignIntervalRef.current = setInterval(async () => {
      if (faceAuthBusy) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      try {
        // Require a roughly frontal face before capturing the match frame.
        const landmarks = await extractFaceLandmarksFromVideo(video);
        if (!landmarks) return;
        const yaw = estimateHeadYawDegrees(landmarks);
        if (Math.abs(yaw) > FRONTAL_YAW_TOLERANCE_DEG) return;

        const captured = await captureFaceScanBlob();
        frontalCaptureRef.current = captured;

        if (alignTimeoutRef.current) {
          clearTimeout(alignTimeoutRef.current);
          alignTimeoutRef.current = null;
        }
        if (alignIntervalRef.current) {
          clearInterval(alignIntervalRef.current);
          alignIntervalRef.current = null;
        }
        // Frontal face locked — move on to the liveness challenge.
        setScanStage("challenge");
      } catch {
        /* no face / not ready yet — keep polling */
      }
    }, 600);

    return () => {
      if (alignIntervalRef.current) {
        clearInterval(alignIntervalRef.current);
        alignIntervalRef.current = null;
      }
      if (alignTimeoutRef.current) {
        clearTimeout(alignTimeoutRef.current);
        alignTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, scanStage, faceAuthBusy]);

  // Liveness challenge loop: runs AFTER a frontal frame is captured. Samples
  // landmarks every FACE_SAMPLE_INTERVAL_MS and checks the prompted action
  // (blink / head turn), then submits the already-captured frontal frame.
  // On timeout, fall back to the retry button.
  useEffect(() => {
    if (!cameraOn || scanStage !== "challenge" || faceAuthBusy) {
      if (autoDetectInterval.current) {
        clearInterval(autoDetectInterval.current);
        autoDetectInterval.current = null;
      }
      return;
    }

    livenessTimeoutRef.current = setTimeout(() => {
      if (autoDetectInterval.current) {
        clearInterval(autoDetectInterval.current);
        autoDetectInterval.current = null;
      }
      setScanStage("failed");
      setCameraError(
        `Liveness challenge timed out. Please ${describeChallenge(challenge).title.toLowerCase()} and try again.`,
      );
      stopCamera();
    }, LIVENESS_TIMEOUT_MS);

    const blinkDetector = createBlinkDetector();

    autoDetectInterval.current = setInterval(async () => {
      if (faceAuthBusy) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      try {
        const landmarks = await extractFaceLandmarksFromVideo(video);

        // Blink is a transition over time, so it must see every frame —
        // including the ones with no face, which reset a half-finished blink.
        let passed = false;
        if (challenge === 'blink') {
          passed = blinkDetector.push(landmarks);
        }

        if (!landmarks) {
          // Lost the face - reset any running countdown.
          countdownValRef.current = null;
          setLivenessCountdown(null);
          return;
        }
        const mar = computeMouthAspectRatio(landmarks);
        const yaw = estimateHeadYawDegrees(landmarks);

        if (challenge === 'head_turn') {
          // Either direction counts (mirror-proof).
          passed = Math.abs(yaw) >= HEAD_TURN_YAW_THRESHOLD_DEG;
        }

        if (!passed) return; // keep polling until the action is performed

        // Action satisfied -> record the signal, mark Approved, and go straight
        // to the face match (no countdown).
        livenessSignalRef.current = {
          challenge,
          mouthAspectRatio: mar,
          yawDegrees: yaw,
          completedAt: new Date().toISOString(),
        };
        if (livenessTimeoutRef.current) {
          clearTimeout(livenessTimeoutRef.current);
          livenessTimeoutRef.current = null;
        }
        if (autoDetectInterval.current) {
          clearInterval(autoDetectInterval.current);
          autoDetectInterval.current = null;
        }
        setLivenessPassed(true);
        void runGraduateFaceAuthentication();
      } catch { /* silent - keep polling */ }
    }, FACE_SAMPLE_INTERVAL_MS);

    return () => {
      if (autoDetectInterval.current) {
        clearInterval(autoDetectInterval.current);
        autoDetectInterval.current = null;
      }
      if (livenessTimeoutRef.current) {
        clearTimeout(livenessTimeoutRef.current);
        livenessTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, scanStage, faceAuthBusy, challenge]);

  // Tick the lockout countdown each second so the button text refreshes.
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const id = window.setInterval(() => {
      setLockoutSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockoutSeconds]);

  const handlePasswordNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setEmailError(""); setPasswordError("");
    if (lockoutSeconds > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutSeconds}s.`);
      return;
    }
    if (!credential.trim() || !credential.includes("@")) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (!password.trim()) {
      setPasswordError("Please enter your password.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await adminLogin(credential.trim(), password);
      sessionStorage.setItem("admin_authenticated", "true");
      sessionStorage.setItem("admin_user", JSON.stringify(response.user));
      if (response.accessToken) {
        sessionStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, response.accessToken);
      }
      setIsLoading(false);
      navigate("/admin/dashboard");
      return;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        setIsLoading(false);
        setCameraError("");
        setScanStage("idle");
        setPhase("facescan");
        return;
      }

      if (err instanceof ApiClientError && err.status === 429) {
        const payload = err.payload as Record<string, unknown> | undefined;
        const secs = Number(payload?.lockout_seconds ?? 0);
        if (secs > 0) setLockoutSeconds(secs);
        setError(`Too many failed attempts. Try again in ${secs || "a few"}s.`);
        setIsLoading(false);
        return;
      }

      if (err instanceof ApiClientError && err.status === 401) {
        const msg = err.message ?? "";
        const payload = err.payload as Record<string, unknown> | undefined;
        const secs = Number(payload?.lockout_seconds ?? 0);
        if (secs > 0) {
          setLockoutSeconds(secs);
          setError(`Too many failed attempts. Try again in ${secs}s.`);
          setIsLoading(false);
          return;
        }
        if (/not recognized/i.test(msg)) {
          setEmailError(msg);
        } else {
          setPasswordError(msg);
        }
        setIsLoading(false);
        return;
      }

      if (err instanceof TypeError || (err instanceof Error && /fetch|network/i.test(err.message))) {
        setError(
          `Cannot reach backend API (${API_BASE_URL}). Start Django server from backend: ${"..\\venv\\Scripts\\python.exe manage.py runserver 8000"}`,
        );
        setIsLoading(false);
        return;
      }

      const message = err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(message);
      setIsLoading(false);
    }
  };

  const captureFaceScanBlob = async (): Promise<{ blob: Blob; descriptor: number[] }> => {
    const video = videoRef.current;
    if (!video) {
      throw new Error("Camera is not ready.");
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    const dataUrl = captureOvalFrame(video, 0.9);
    const descriptor = await extractFaceDescriptorFromDataUrl(dataUrl);
    if (!descriptor) {
      throw new Error("No face detected. Center your face in the oval and try again.");
    }

    return new Promise<{ blob: Blob; descriptor: number[] }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d")!.drawImage(img, 0, 0);
        c.toBlob((blob) => {
          if (!blob) { reject(new Error("Failed to capture face scan image.")); return; }
          resolve({ blob, descriptor });
        }, "image/jpeg", 0.9);
      };
      img.src = dataUrl;
    });
  };

  const runGraduateFaceAuthentication = async () => {
    setFaceAuthBusy(true);
    setCameraError("");
    setScanStage("detecting");

    try {
      // Prefer the frontal frame captured during the alignment step; fall back
      // to a fresh capture only if it's somehow missing.
      const { blob: faceBlob, descriptor } =
        frontalCaptureRef.current ?? (await captureFaceScanBlob());
      const gps = await captureLoginGps();
      const response = await alumniLogin(
        credential.trim(),
        password,
        faceBlob,
        descriptor,
        undefined,
        gps ? { gpsLat: gps.lat, gpsLng: gps.lng, gpsAccuracyM: gps.acc } : undefined,
        livenessSignalRef.current ?? undefined,
      );
      sessionStorage.setItem("alumni_user", JSON.stringify(response.alumni));
      if (response.accessToken) {
        sessionStorage.setItem(ALUMNI_ACCESS_TOKEN_KEY, response.accessToken);
      }
      setScanStage("matched");
      stopCamera();
      // Gate: verified graduates reach the dashboard; pending accounts (awaiting
      // BSIS admin approval) go to the pending page.
      const isVerified =
        (response.alumni as { verificationStatus?: string } | undefined)?.verificationStatus === "verified";
      const redirectTimer = setTimeout(
        () => navigate(isVerified ? "/alumni/dashboard" : "/alumni/pending"),
        1100,
      );
      scanTimers.current.push(redirectTimer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Face authentication failed. Please try again.";
      setScanStage("failed");
      setCameraError(message);
      stopCamera();
    } finally {
      setFaceAuthBusy(false);
    }
  };

  const startCamera = async () => {
    setCameraError("");
    // Fresh randomized challenge every camera start - prevents replay attacks
    // with a pre-recorded video of the alumnus.
    setChallenge(pickRandomLoginChallenge());
    setLivenessPassed(false);
    livenessSignalRef.current = null;
    frontalCaptureRef.current = null;
    countdownValRef.current = null;
    setLivenessCountdown(null);
    // Frontal capture happens first, then the liveness challenge.
    setScanStage("aligning");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError("Camera access was denied. Please allow camera permission and try again.");
      setScanStage("idle");
    }
  };

  const stopCamera = () => {
    if (autoDetectInterval.current) {
      clearInterval(autoDetectInterval.current);
      autoDetectInterval.current = null;
    }
    if (alignIntervalRef.current) {
      clearInterval(alignIntervalRef.current);
      alignIntervalRef.current = null;
    }
    if (alignTimeoutRef.current) {
      clearTimeout(alignTimeoutRef.current);
      alignTimeoutRef.current = null;
    }
    if (livenessTimeoutRef.current) {
      clearTimeout(livenessTimeoutRef.current);
      livenessTimeoutRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    countdownValRef.current = null;
    setLivenessCountdown(null);
    setCameraOn(false);
  };

  const inputBase =
    "w-full rounded-xl border border-gray-200 bg-gray-50 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white";

  const featureItems = [
    {
      icon: GraduationCap,
      title: "Graduate",
      desc: "Track your career progress and connect with your batch.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── Mobile Hero (visible on mobile only) ── */}
      <div className="lg:hidden relative bg-gradient-to-br from-[#052e16] via-[#166534] to-[#14532d] px-6 pt-12 pb-10 overflow-hidden">
        {/* Pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "repeating-linear-gradient(45deg, white 0px, white 1px, transparent 1px, transparent 16px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Glow blobs */}
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-6 -left-10 w-40 h-40 rounded-full bg-white/5 blur-3xl" />

        {/* Logo + name */}
        <div className="relative flex items-center gap-3 mb-6">
          <NextImage src={schoolLogo} alt="CHMSU Logo" width={56} height={56} className="size-14 object-contain shrink-0" />
          <div>
            <h1 className="text-white" style={{ fontWeight: 800, fontSize: "1.05rem", lineHeight: 1.15 }}>Carlos Hilado Memorial State University</h1>
            <p className="text-white/60 text-xs mt-0.5">BSIS Graduate Tracer System</p>
          </div>
        </div>

        {/* Curved bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gray-50" style={{ borderRadius: "50% 50% 0 0 / 100% 100% 0 0" }} />
      </div>

      {/* ── Left Panel (desktop only) ── */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 bg-gradient-to-b from-[#052e16] via-[#166534] to-[#14532d] p-10 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "repeating-linear-gradient(45deg, white 0px, white 1px, transparent 1px, transparent 16px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute top-0 left-0 w-48 h-48 rounded-full bg-white/5 blur-3xl" />

        <div className="relative">
          <NextImage src={schoolLogo} alt="CHMSU Logo" width={88} height={88} className="size-22 object-contain mb-5" />
          <h1 className="text-white mb-1" style={{ fontWeight: 800, fontSize: "1.5rem", lineHeight: 1.2 }}>
            Carlos Hilado Memorial State University
          </h1>
          <p className="text-white/70 text-sm">BSIS Graduate Tracer System</p>
        </div>

        <div className="relative space-y-5">
          {featureItems.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-white/10 shrink-0">
                <item.icon className="size-4 text-white/80" />
              </div>
              <div>
                <p className="text-white text-sm" style={{ fontWeight: 600 }}>{item.title}</p>
                <p className="text-white/50 text-xs leading-relaxed mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="relative text-white/25 text-xs">© 2026 Carlos Hilado Memorial State University</p>
      </div>

      {/* ── Right / Form Panel ── */}
      <div className="flex-1 flex items-start lg:items-center justify-center px-4 pt-6 pb-10 lg:py-12 bg-gray-50">
        <div className="w-full max-w-[400px]">

          {/* Form card - elevated on mobile */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:p-0 lg:bg-transparent lg:shadow-none lg:border-0">
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <NextImage src={schoolLogo} alt="CHMSU Logo" width={44} height={44} className="size-11 object-contain shrink-0" />
              <div>
                <p className="text-gray-900 text-sm leading-tight" style={{ fontWeight: 700 }}>Carlos Hilado Memorial State University</p>
                <p className="text-gray-500 text-xs">BSIS Graduate Tracer</p>
              </div>
            </div>

            {/* ── Phase: LOGIN ── */}
            {phase === "login" && (
              <div>
                <h2 className="text-gray-900 mb-1" style={{ fontWeight: 700, fontSize: "1.35rem" }}>
                  Sign in
                </h2>
                <p className="text-gray-500 text-sm mb-6">Enter your credentials to continue.</p>

                {error && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs">{error}</p>
                  </div>
                )}

                <form onSubmit={handlePasswordNext} className="space-y-4">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                      <input
                        type="email"
                        placeholder="Enter your email address"
                        value={credential}
                        onChange={(e) => { setCredential(e.target.value); setError(""); setEmailError(""); }}
                        className={`${inputBase} pl-10 pr-4 ${emailError ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""}`}
                        autoFocus
                      />
                    </div>
                    {emailError && <p className="text-red-500 text-xs mt-1.5">{emailError}</p>}
                  </div>

                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Password</label>
                    <div className="relative">
                      <input
                        type={showPass ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(""); setPasswordError(""); }}
                        className={`${inputBase} pl-4 pr-10 ${passwordError ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""}`}
                      />
                      <button type="button" onClick={() => setShowPass(!showPass)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    {passwordError && <p className="text-red-500 text-xs mt-1.5">{passwordError}</p>}
                    <div className="mt-2 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setForgotOpen(true)}
                        className="text-xs text-[#166534] hover:underline"
                        style={{ fontWeight: 600 }}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || lockoutSeconds > 0 || !credential.trim() || !password.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-60"
                    style={{ fontWeight: 600 }}
                  >
                    {lockoutSeconds > 0 ? (
                      <>Locked. Try again in {lockoutSeconds}s</>
                    ) : isLoading ? (
                      <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying…</>
                    ) : (
                      <>Sign In <ArrowRight className="size-4" /></>
                    )}
                  </button>
                </form>

                <ForgotPasswordModal
                  open={forgotOpen}
                  initialEmail={credential}
                  onClose={() => setForgotOpen(false)}
                />

                <p className="text-center text-gray-400 text-xs mt-5">
                  Employer?{" "}
                  <button onClick={() => navigate("/employer")} className="text-[#166534] hover:underline" style={{ fontWeight: 600 }}>
                    Go to Employer Portal →
                  </button>
                </p>
                <p className="text-center text-gray-400 text-xs mt-2">
                  New Graduate?{" "}
                  <button onClick={() => navigate("/register/alumni")} className="text-[#166534] hover:underline" style={{ fontWeight: 600 }}>
                    Create account →
                  </button>
                </p>
              </div>
            )}

            {/* ── Phase: FACE SCAN ── */}
            {phase === "facescan" && (
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]/10">
                    <Camera className="size-5 text-[#166534]" />
                  </div>
                  <div>
                    <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: "1.1rem" }}>Face & Liveness Verification</h2>
                    <p className="text-gray-500 text-xs">Perform the on-screen liveness action, then we&apos;ll match your face.</p>
                  </div>
                </div>

                {/* Steps indicator */}
                <div className="flex items-center gap-2 mb-3">
                  {[
                    { label: "Sign In", done: true },
                    { label: "Face Scan", done: scanStage === "matched", active: scanStage !== "matched" },
                  ].map((s, i) => (
                    <div key={s.label} className="flex items-center gap-2">
                      <div
                        className={`flex size-5 items-center justify-center rounded-full text-xs ${s.done ? "bg-emerald-500 text-white" : s.active ? "bg-[#166534] text-white" : "bg-gray-200 text-gray-400"}`}
                        style={{ fontWeight: 700 }}
                      >
                        {s.done ? <CheckCircle2 className="size-3" /> : i + 1}
                      </div>
                      <span className={`text-xs ${s.done || s.active ? "text-gray-700" : "text-gray-400"}`} style={{ fontWeight: s.active ? 600 : 400 }}>
                        {s.label}
                      </span>
                      {i < 1 && <div className="w-4 h-px bg-gray-200" />}
                    </div>
                  ))}
                </div>

                {/* GPS-capture notice (RA 10173 transparency) */}
                <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
                  <CheckCircle2 className="size-3.5 text-[#166534] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-emerald-800 leading-snug">
                    For audit purposes, your device's approximate GPS location is recorded with this login. If you decline the browser permission, sign-in still proceeds without location data.
                  </p>
                </div>

                {/* Obstruction-removal reminder */}
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
                  <AlertCircle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Before scanning, please remove anything that hides your face - eyeglasses, sunglasses, hats, or face masks - and make sure your face is well-lit.
                  </p>
                </div>

                {/* Camera area */}
                <div className="relative bg-gray-900 rounded-2xl overflow-hidden mb-4 flex items-center justify-center w-full max-w-[400px] mx-auto" style={{ aspectRatio: "4/3" }}>
                  <video
                    ref={videoRef}
                    className={`absolute inset-0 w-full h-full object-cover object-center ${!cameraOn ? "hidden" : ""}`}
                    playsInline muted autoPlay
                  />

                  {!cameraOn && scanStage === "idle" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="flex size-16 items-center justify-center rounded-full bg-white/10 mb-3">
                        <Camera className="size-8 text-gray-400" />
                      </div>
                      <p className="text-gray-300 text-sm" style={{ fontWeight: 500 }}>Camera not started</p>
                      <p className="text-gray-500 text-xs mt-1">Tap "Begin Face Scan" below</p>
                    </div>
                  )}

                  {cameraOn && scanStage !== "matched" && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative" style={{ width: "55%", aspectRatio: "3/4" }}>
                          <div
                            style={{
                              position: "absolute", inset: 0, borderRadius: "50%",
                              border: `2px dashed ${scanStage === "detecting" ? "rgba(22,101,52,0.8)" : "rgba(255,255,255,0.4)"}`,
                              animation: scanStage === "detecting" ? "pulse 1s ease-in-out infinite" : "none",
                            }}
                          />
                          {scanStage === "detecting" && (
                            <div
                              style={{
                                position: "absolute", left: 0, right: 0, height: "2px",
                                background: "linear-gradient(90deg, transparent, rgba(22,101,52,0.8), transparent)",
                                animation: "scanLine 1.5s linear infinite", borderRadius: "1px",
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {(["tl", "tr", "bl", "br"] as const).map((pos) => (
                        <div
                          key={pos}
                          className="absolute"
                          style={{
                            top: pos.startsWith("t") ? "12%" : undefined,
                            bottom: pos.startsWith("b") ? "12%" : undefined,
                            left: pos.endsWith("l") ? "20%" : undefined,
                            right: pos.endsWith("r") ? "20%" : undefined,
                            width: "20px", height: "20px",
                            borderTop: pos.startsWith("t") ? "2px solid rgba(22,101,52,0.8)" : "none",
                            borderBottom: pos.startsWith("b") ? "2px solid rgba(22,101,52,0.8)" : "none",
                            borderLeft: pos.endsWith("l") ? "2px solid rgba(22,101,52,0.8)" : "none",
                            borderRight: pos.endsWith("r") ? "2px solid rgba(22,101,52,0.8)" : "none",
                          }}
                        />
                      ))}

                      {/* 3-2-1 countdown while the gesture is held */}
                      {livenessCountdown !== null && scanStage !== "detecting" && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-white drop-shadow-lg" style={{ fontWeight: 800, fontSize: "4.5rem", lineHeight: 1 }}>
                            {livenessCountdown}
                          </span>
                        </div>
                      )}

                      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-2">
                        <div className="bg-black/65 backdrop-blur-sm rounded-xl px-4 py-2 text-center">
                          <p className="text-white text-sm" style={{ fontWeight: 700 }}>
                            {scanStage === "aligning"
                              ? "Look straight at the camera"
                              : scanStage === "detecting"
                                ? (livenessPassed ? "Approved ✓ — verifying your face…" : "Verifying your face…")
                                : describeChallenge(challenge).title}
                          </p>
                          <p className="text-white/70 text-[11px] mt-0.5">
                            {scanStage === "aligning"
                              ? "Face forward, neutral expression, good lighting"
                              : scanStage === "detecting"
                                ? "Hold still"
                                : livenessCountdown !== null
                                  ? "Keep holding the action"
                                  : `Step 2: ${describeChallenge(challenge).hint}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {scanStage === "matched" && (
                    <div className="absolute inset-0 bg-emerald-900/80 flex flex-col items-center justify-center backdrop-blur-sm">
                      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500 mb-3" style={{ animation: "scaleIn 0.3s ease-out" }}>
                        <CheckCircle2 className="size-9 text-white" />
                      </div>
                      <p className="text-white" style={{ fontWeight: 700, fontSize: "1rem" }}>Face Matched ✓</p>
                      <p className="text-emerald-300 text-sm mt-1">Identity verified - redirecting…</p>
                    </div>
                  )}
                </div>

                <style>{`
                  @keyframes scanLine {
                    0% { top: 10%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 90%; opacity: 0; }
                  }
                  @keyframes scaleIn {
                    from { transform: scale(0.5); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                  }
                `}</style>

                {cameraError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs">{cameraError}</p>
                  </div>
                )}

                {!cameraOn && scanStage !== "matched" && (
                  <div className="space-y-3">
                    <button
                      onClick={startCamera}
                      className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition"
                      style={{ fontWeight: 600 }}
                    >
                      <Video className="size-4" /> {scanStage === "failed" ? "Retry Face Scan" : "Begin Face Scan"}
                    </button>
                    <button
                      onClick={() => { setPhase("login"); setScanStage("idle"); setCameraError(""); }}
                      className="w-full flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-700 text-xs transition"
                    >
                      <ArrowLeft className="size-3.5" /> Back
                    </button>
                  </div>
                )}

                {cameraOn && scanStage !== "matched" && !faceAuthBusy && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 py-1">
                      <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-gray-600 text-sm">
                        {scanStage === "aligning"
                          ? "Step 1: centering your face..."
                          : scanStage === "challenge"
                            ? `Step 2 — ${describeChallenge(challenge).title}`
                            : "Verifying face..."}
                      </span>
                    </div>
                    <button
                      onClick={stopCamera}
                      className="w-full flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-700 text-xs transition"
                    >
                      <ArrowLeft className="size-3.5" /> Stop Camera
                    </button>
                  </div>
                )}

                {cameraOn && scanStage === "detecting" && (
                  <div className="flex items-center gap-2 justify-center py-2">
                    <span className="size-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                    <span className="text-gray-600 text-sm">
                      {faceAuthBusy ? "Verifying account and face scan..." : "Analyzing face recognition scan..."}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer credit - mobile only */}
          <p className="lg:hidden text-center text-gray-400 text-xs mt-5">© 2026 Carlos Hilado Memorial State University</p>
        </div>
      </div>
    </div>
  );
}