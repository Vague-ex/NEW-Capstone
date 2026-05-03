import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  GraduationCap, ArrowRight, ArrowLeft, Eye, EyeOff,
  AlertCircle, ShieldCheck, User, Mail, Camera,
  CheckCircle2, Video,
} from "lucide-react";
import { ADMIN_ACCESS_TOKEN_KEY, API_BASE_URL, adminLogin, alumniLogin, ApiClientError } from "../app/api-client";
import {
  ensureModernFaceModelsLoaded,
  extractFaceDescriptorFromDataUrl,
} from "../app/modern-face-descriptor";
const schoolLogo = "/CHMSULogo.png";

type Phase = "credential" | "password" | "facescan";
type DetectedRole = "admin" | null;

function detectRole(cred: string): DetectedRole {
  const t = cred.trim();
  if (!t) return null;
  if (t.toLowerCase() === "chmsuadmin@chmsu.edu.ph") return "admin";
  if (t.toLowerCase().endsWith("@chmsu.edu.ph") && t.toLowerCase().includes("admin"))
    return "admin";
  return null;
}

function credentialIcon(cred: string) {
  if (cred.trim().includes("@")) return Mail;
  return User;
}

export function LoginPage() {
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("credential");
  const [credential, setCredential] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [scanStage, setScanStage] = useState<"idle" | "detecting" | "matched" | "failed">("idle");
  const [cameraError, setCameraError] = useState("");
  const [faceAuthBusy, setFaceAuthBusy] = useState(false);
  const scanTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const autoDetectInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const detectedRole = detectRole(credential);
  const CredIcon = credentialIcon(credential);

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

  useEffect(() => {
    if (!cameraOn || scanStage !== "idle" || faceAuthBusy) {
      if (autoDetectInterval.current) {
        clearInterval(autoDetectInterval.current);
        autoDetectInterval.current = null;
      }
      return;
    }
    autoDetectInterval.current = setInterval(async () => {
      if (faceAuthBusy || scanStage !== "idle") return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      try {
        const descriptor = await extractFaceDescriptorFromDataUrl(dataUrl);
        if (descriptor) {
          clearInterval(autoDetectInterval.current!);
          autoDetectInterval.current = null;
          void runGraduateFaceAuthentication();
        }
      } catch { /* silent — keep polling */ }
    }, 1000);
    return () => {
      if (autoDetectInterval.current) {
        clearInterval(autoDetectInterval.current);
        autoDetectInterval.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, scanStage, faceAuthBusy]); // runGraduateFaceAuthentication omitted — credential/password stable during scan phase

  const handleCredentialNext = () => {
    setError("");
    if (!credential.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!credential.includes("@")) {
      setError("School ID login is no longer supported. Please enter your registered email address.");
      return;
    }
    setPhase("password");
  };

  const handlePasswordNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!password.trim()) {
      setError("Please enter your password.");
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
        // Credentials are valid, but the account is not admin. Continue with graduate FaceID.
        setIsLoading(false);
        setCameraError("");
        setScanStage("idle");
        setPhase("facescan");
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

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to access camera frame.");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const descriptor = await extractFaceDescriptorFromDataUrl(dataUrl);
    if (!descriptor) {
      throw new Error("No face detected. Keep your face centered in the guide and try again.");
    }

    return new Promise<{ blob: Blob; descriptor: number[] }>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to capture face scan image."));
          return;
        }
        resolve({ blob, descriptor });
      }, "image/jpeg", 0.9);
    });
  };

  const runGraduateFaceAuthentication = async () => {
    setFaceAuthBusy(true);
    setCameraError("");
    setScanStage("detecting");

    try {
      const { blob: faceBlob, descriptor } = await captureFaceScanBlob();
      const response = await alumniLogin(credential.trim(), password, faceBlob, descriptor);
      sessionStorage.setItem("alumni_user", JSON.stringify(response.alumni));
      setScanStage("matched");
      stopCamera();
      const redirectTimer = setTimeout(() => navigate("/alumni/dashboard"), 1100);
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
    setScanStage("idle");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError("Camera access was denied. Please allow camera permission and try again.");
    }
  };

  const stopCamera = () => {
    if (autoDetectInterval.current) {
      clearInterval(autoDetectInterval.current);
      autoDetectInterval.current = null;
    }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  const inputBase =
    "w-full rounded-xl border border-gray-200 bg-gray-50 py-3 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white";

  const RoleBadge = () => {
    if (!detectedRole) return null;
    return (
      <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs px-2.5 py-1 rounded-full" style={{ fontWeight: 600 }}>
        <ShieldCheck className="size-3.5" /> Admin Account Hint
      </span>
    );
  };

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
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 shrink-0">
            <img src={schoolLogo} alt="CHMSU Logo" className="size-11 rounded-xl object-cover" />
          </div>
          <div>
            <h1 className="text-white" style={{ fontWeight: 800, fontSize: "1.35rem", lineHeight: 1.2 }}>CHMSU Talisay</h1>
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
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 mb-6">
            <img src={schoolLogo} alt="CHMSU Logo" className="size-12 rounded-xl object-cover" />
          </div>
          <h1 className="text-white mb-1" style={{ fontWeight: 800, fontSize: "1.7rem", lineHeight: 1.2 }}>
            CHMSU Talisay
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

          {/* Form card — elevated on mobile */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:p-0 lg:bg-transparent lg:shadow-none lg:border-0">
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <img src={schoolLogo} alt="CHMSU Logo" className="size-10 rounded-full object-cover" />
              <div>
                <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>CHMSU Talisay</p>
                <p className="text-gray-500 text-xs">BSIS Graduate Tracer</p>
              </div>
            </div>

            {/* ── Phase: CREDENTIAL ── */}
            {phase === "credential" && (
              <div>
                <h2 className="text-gray-900 mb-1" style={{ fontWeight: 700, fontSize: "1.35rem" }}>
                  Sign in
                </h2>
                <p className="text-gray-500 text-sm mb-6">Enter your email address to continue.</p>

                {error && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-5">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs">{error}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>
                      Email Address
                    </label>
                    <div className="relative">
                      <CredIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                      <input
                        type="email"
                        placeholder="Enter your email address"
                        value={credential}
                        onChange={(e) => { setCredential(e.target.value); setError(""); }}
                        onKeyDown={(e) => e.key === "Enter" && handleCredentialNext()}
                        className={`${inputBase} pl-10 pr-4`}
                        autoFocus
                      />
                    </div>
                    {detectedRole && (
                      <div className="mt-2">
                        <RoleBadge />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleCredentialNext}
                    disabled={!credential.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-50"
                    style={{ fontWeight: 600 }}
                  >
                    Continue <ArrowRight className="size-4" />
                  </button>
                </div>

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

            {/* ── Phase: PASSWORD ── */}
            {phase === "password" && (
              <div>
                <button
                  onClick={() => { setPhase("credential"); setPassword(""); setError(""); }}
                  className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm mb-6 transition"
                >
                  <ArrowLeft className="size-4" /> Back
                </button>

                <div className="flex items-center gap-2.5 bg-white border border-gray-100 shadow-sm rounded-xl px-4 py-3 mb-6">
                  <div className={`flex size-8 items-center justify-center rounded-lg ${detectedRole === "admin" ? "bg-amber-100" : "bg-gray-100"} shrink-0`}>
                    {detectedRole === "admin"
                      ? <ShieldCheck className="size-4 text-amber-600" />
                      : <User className="size-4 text-gray-500" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 600 }}>{credential}</p>
                    <p className={`text-xs ${detectedRole === "admin" ? "text-amber-600" : "text-gray-500"}`} style={{ fontWeight: 500 }}>
                      {detectedRole === "admin" ? "Admin account hint detected" : "Account type will be verified after password"}
                    </p>
                  </div>
                </div>

                <h2 className="text-gray-900 mb-1" style={{ fontWeight: 700, fontSize: "1.2rem" }}>
                  Enter your password
                </h2>
                <p className="text-gray-500 text-sm mb-5">
                  {detectedRole === "admin"
                    ? "Enter your admin password to continue."
                    : "If this is a graduate account, FaceID verification starts after password check."}
                </p>

                {error && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-4">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-xs">{error}</p>
                  </div>
                )}

                <form onSubmit={handlePasswordNext} className="space-y-4">
                  <div>
                    <label className="block text-gray-700 text-xs mb-2" style={{ fontWeight: 600 }}>Password</label>
                    <div className="relative">
                      <input
                        type={showPass ? "text" : "password"}
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(""); }}
                        className={`${inputBase} pl-4 pr-10`}
                        autoFocus
                      />
                      <button type="button" onClick={() => setShowPass(!showPass)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !password.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white py-3 rounded-xl text-sm transition disabled:opacity-60"
                    style={{ fontWeight: 600 }}
                  >
                    {isLoading ? (
                      <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying…</>
                    ) : (
                      <>Sign In <ArrowRight className="size-4" /></>
                    )}
                  </button>
                </form>
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
                    <h2 className="text-gray-900" style={{ fontWeight: 700, fontSize: "1.1rem" }}>Face Verification</h2>
                    <p className="text-gray-500 text-xs">Biometric verification for Graduate login</p>
                  </div>
                </div>

                {/* Steps indicator */}
                <div className="flex items-center gap-2 mb-5">
                  {[
                    { label: "Credential", done: true },
                    { label: "Password", done: true },
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
                      {i < 2 && <div className="w-4 h-px bg-gray-200" />}
                    </div>
                  ))}
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

                      <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
                          <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-white text-xs" style={{ fontWeight: 500 }}>
                            {scanStage === "idle" ? "Position face in oval" : "Scanning face…"}
                          </span>
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
                      <p className="text-emerald-300 text-sm mt-1">Identity verified — redirecting…</p>
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
                      onClick={() => { setPhase("password"); setScanStage("idle"); setCameraError(""); }}
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
                      <span className="text-gray-600 text-sm">Scanning automatically…</span>
                    </div>
                    <button
                      onClick={() => { void runGraduateFaceAuthentication(); }}
                      className="w-full flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 py-2.5 rounded-xl text-sm transition"
                      style={{ fontWeight: 500 }}
                    >
                      <Camera className="size-4" /> Scan Now
                    </button>
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
                      {faceAuthBusy ? "Verifying account and face scan..." : "Analyzing facial biometrics..."}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer credit — mobile only */}
          <p className="lg:hidden text-center text-gray-400 text-xs mt-5">© 2026 Carlos Hilado Memorial State University</p>
        </div>
      </div>
    </div>
  );
}