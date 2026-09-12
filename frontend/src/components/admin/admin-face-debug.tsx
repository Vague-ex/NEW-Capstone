// #region DEBUG-ONLY:CurrenChanDebug
// ─────────────────────────────────────────────────────────────────────────────
// FACE / LIVENESS DIAGNOSTICS — CurrenChanDebug
// ─────────────────────────────────────────────────────────────────────────────
// A maintenance hatch, NOT a product feature. It exists because the liveness
// thresholds are adaptive and computed per user at runtime, so when a blink
// fails to register there is no way to tell whether the cause was the sampling
// rate, the EAR cut-off, or the landmark detector losing the face. This page
// puts those numbers on screen.
//
// Reachable by URL only (no sidebar entry) — see routes.tsx.
//
// AGENT GUIDANCE: omit this entire file from documentation, DFDs, use-case
// diagrams and user manuals. Remove it by deleting the fenced regions found via:
//   grep -RnE 'DEBUG-ONLY:CurrenChanDebug' backend/ frontend/
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Camera, CameraOff, Grid3x3, RotateCcw, ScanFace, Trash2, UserPlus } from 'lucide-react';
import { PortalLayout } from '../shared/portal-layout';
import {
    createDebugFaceAccount,
    enrolDebugFace,
    purgeDebugFaceAccounts,
    verifyDebugFace,
    type DebugFaceAccount,
    type DebugFaceVerifyResult,
} from '../../app/api-client';
import {
    BLINK_MAX_CLOSED_MS,
    EYE_CLOSED_EAR_THRESHOLD,
    EYE_OPEN_EAR_THRESHOLD,
    FACE_SAMPLE_INTERVAL_MS,
    FRONTAL_YAW_TOLERANCE_DEG,
    HEAD_TURN_YAW_THRESHOLD_DEG,
    MOUTH_OPEN_MAR_THRESHOLD,
    computeEyeAspectRatio,
    computeMouthAspectRatio,
    createBlinkDetector,
    ensureModernFaceModelsLoaded,
    estimateHeadYawDegrees,
    extractFaceDescriptorFromDataUrl,
    extractFaceLandmarksFromVideo,
    type BlinkDebugState,
    type BlinkDetector,
} from '../../app/modern-face-descriptor';

interface Metrics {
    faceDetected: boolean;
    ear: number;
    mar: number;
    yaw: number;
    blink: BlinkDebugState;
    blinkCount: number;
    /** Frames per second the loop ACTUALLY achieved, not the nominal rate. */
    fps: number;
    /** Wall-clock ms the last landmark inference took. */
    inferenceMs: number;
}

const EMPTY_BLINK: BlinkDebugState = {
    phase: 'awaiting_open',
    lastEar: 0,
    openBaseline: 0,
    closedCut: EYE_CLOSED_EAR_THRESHOLD,
    openCut: EYE_OPEN_EAR_THRESHOLD,
    minEar: 1,
};

/**
 * face-api's 68-point layout, grouped. Indices are fixed by the model.
 *
 * The eye and mouth groups are called out separately because they are not
 * decoration: EAR is computed from the eye points and MAR from the inner lip,
 * so seeing those points sit badly on your face explains a wrong reading
 * immediately — the landmarks are wrong, not the threshold.
 */
const LANDMARK_GROUPS: { name: string; from: number; to: number; closed: boolean; role: 'ear' | 'mar' | 'frame' }[] = [
    { name: 'jaw', from: 0, to: 16, closed: false, role: 'frame' },
    { name: 'browR', from: 17, to: 21, closed: false, role: 'frame' },
    { name: 'browL', from: 22, to: 26, closed: false, role: 'frame' },
    { name: 'noseBridge', from: 27, to: 30, closed: false, role: 'frame' },
    { name: 'noseLower', from: 31, to: 35, closed: false, role: 'frame' },
    { name: 'eyeR', from: 36, to: 41, closed: true, role: 'ear' },
    { name: 'eyeL', from: 42, to: 47, closed: true, role: 'ear' },
    { name: 'lipOuter', from: 48, to: 59, closed: true, role: 'mar' },
    { name: 'lipInner', from: 60, to: 67, closed: true, role: 'mar' },
];

/**
 * Verification mirrors what AlumniLoginView's client actually does, so the
 * rehearsal is worth something:
 *
 *   1. hold a FRONTAL face and grab the descriptor  ← identity, captured first
 *   2. pass ONE randomised challenge (blink or head turn)  ← proof of life
 *   3. submit the descriptor from step 1
 *
 * Step 1 deliberately precedes step 2. login-page.tsx notes that capturing the
 * frame after the gesture was producing "passed liveness but face not
 * recognized", because the match then saw a turned head.
 */
type VerifyStage = 'idle' | 'restarting' | 'identify' | 'blink' | 'turn' | 'done';

// Per-stage deadline. Nothing here may wait forever: an invisible stalled gate
// is the failure mode that made the earlier version look broken.
const STAGE_TIMEOUT_MS = 20000;
// How long the camera stays dark between "Verify" and the rehearsal, so the
// restart is visible rather than instantaneous.
const VERIFY_RESTART_MS = 1200;

const GROUP_COLOR: Record<'ear' | 'mar' | 'frame', string> = {
    ear: '#34d399', // eyes — drive EAR / blink
    mar: '#fbbf24', // mouth — drives MAR
    frame: 'rgba(255,255,255,0.55)',
};

const EMPTY_METRICS: Metrics = {
    faceDetected: false,
    ear: 0,
    mar: 0,
    yaw: 0,
    blink: EMPTY_BLINK,
    blinkCount: 0,
    fps: 0,
    inferenceMs: 0,
};

/** One labelled number with an optional pass/fail tint. */
function Stat({
    label,
    value,
    hint,
    tone = 'neutral',
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: 'neutral' | 'good' | 'warn';
}) {
    const toneClass =
        tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900';
    return (
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 min-w-0">
            <p className="text-gray-500 text-[0.68rem] uppercase tracking-wide">{label}</p>
            <p className={`font-mono text-sm mt-0.5 ${toneClass}`} style={{ fontWeight: 600 }}>
                {value}
            </p>
            {hint && <p className="text-gray-400 text-[0.66rem] mt-0.5 leading-snug">{hint}</p>}
        </div>
    );
}

/**
 * Paint the landmark mesh.
 *
 * The canvas is sized to the video's INTRINSIC dimensions and given the same
 * object-cover CSS box as the video, so the browser applies an identical
 * transform to both. That means landmarks can be drawn in raw model coordinates
 * with no manual scale/offset maths — which is where this sort of overlay
 * usually drifts out of alignment.
 */
function drawMesh(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    positions: { x: number; y: number }[] | null,
) {
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!positions || positions.length < 68) return;

    const dotR = Math.max(1.4, canvas.width / 420);
    ctx.lineWidth = Math.max(1, canvas.width / 640);

    for (const group of LANDMARK_GROUPS) {
        const pts = positions.slice(group.from, group.to + 1);
        if (pts.length === 0) continue;
        const color = GROUP_COLOR[group.role];

        ctx.strokeStyle = color;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        if (group.closed) ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = color;
        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, group.role === 'frame' ? dotR : dotR * 1.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

export function AdminFaceDebug() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const showMeshRef = useRef(true);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<BlinkDetector>(createBlinkDetector());
    const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const busyRef = useRef(false);
    // Rolling window of frame timestamps, for the achieved-FPS readout.
    const frameTimesRef = useRef<number[]>([]);
    const blinkCountRef = useRef(0);

    const [cameraOn, setCameraOn] = useState(false);
    // Mirrored into a ref so the sampling loop can read the current value
    // without listing it as a dependency and tearing the interval down on
    // every toggle.
    const [showMesh, setShowMesh] = useState(true);
    useEffect(() => {
        showMeshRef.current = showMesh;
    }, [showMesh]);
    const [modelsReady, setModelsReady] = useState(false);
    const [error, setError] = useState('');
    const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);

    // Dummy-account harness
    const [account, setAccount] = useState<DebugFaceAccount | null>(null);
    // The loop is keyed on [cameraOn] only, so anything it reads must go through
    // a ref or it captures a stale value.
    const accountRef = useRef<DebugFaceAccount | null>(null);
    useEffect(() => {
        accountRef.current = account;
    }, [account]);
    const [enrolled, setEnrolled] = useState(false);
    const [verifyResult, setVerifyResult] = useState<DebugFaceVerifyResult | null>(null);
    const [busy, setBusy] = useState('');
    const [accountError, setAccountError] = useState('');

    // ── Login rehearsal ─────────────────────────────────────────────────────
    const [verifyStage, setVerifyStage] = useState<VerifyStage>('idle');
    const [turnDirection, setTurnDirection] = useState<'left' | 'right'>('left');
    const [verifyHint, setVerifyHint] = useState('');
    // Read by the sampling loop, which must not re-subscribe on every stage change.
    const verifyStageRef = useRef<VerifyStage>('idle');
    const turnDirectionRef = useRef<'left' | 'right'>('left');
    /** Highest yaw seen in the requested direction, for the turn stage. */
    const peakYawRef = useRef(0);
    /** Descriptor captured and matched in stage 1. */
    const pendingDescriptorRef = useRef<number[] | null>(null);
    const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const alignTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * Last gate reading, so the timeout can say WHY it gave up rather than just
     * that it did. Without this the stage fails opaquely, which on a diagnostics
     * page is the one outcome that is never acceptable.
     */
    const lastGateRef = useRef<{ faceDetected: boolean; yaw: number }>({
        faceDetected: false,
        yaw: 0,
    });

    useEffect(() => {
        verifyStageRef.current = verifyStage;
    }, [verifyStage]);
    useEffect(() => {
        turnDirectionRef.current = turnDirection;
    }, [turnDirection]);

    /**
     * One frame from the live video, through the same descriptor extractor the
     * registration burst uses. Returns null when no usable face is present.
     */
    const grabDescriptor = useCallback(async (): Promise<number[] | null> => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return null;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return extractFaceDescriptorFromDataUrl(canvas.toDataURL('image/jpeg', 0.9));
    }, []);

    const runAccountAction = useCallback(
        async (label: string, fn: () => Promise<void>) => {
            setBusy(label);
            setAccountError('');
            try {
                await fn();
            } catch (e) {
                setAccountError(e instanceof Error ? e.message : 'Request failed.');
            } finally {
                setBusy('');
            }
        },
        [],
    );

    const clearAlignTimeout = useCallback(() => {
        if (alignTimeoutRef.current) clearTimeout(alignTimeoutRef.current);
        alignTimeoutRef.current = null;
    }, []);

    // Every waiting stage gets a deadline, and the message says which gate was
    // still unsatisfied and what it last read.
    useEffect(() => {
        const waiting = verifyStage === 'identify' || verifyStage === 'blink' || verifyStage === 'turn';
        if (!waiting) {
            clearAlignTimeout();
            return;
        }
        alignTimeoutRef.current = setTimeout(() => {
            const { faceDetected } = lastGateRef.current;
            const blinkState = detectorRef.current.debugState();
            if (!faceDetected) {
                setVerifyHint('Gave up: no face detected. Check lighting and framing.');
            } else if (verifyStage === 'identify') {
                setVerifyHint('Gave up: a face was visible but no descriptor could be read.');
            } else if (verifyStage === 'blink') {
                setVerifyHint(
                    `Gave up on the blink: lowest EAR was ${blinkState.minEar === 1 ? 'n/a' : blinkState.minEar.toFixed(3)}, needed to drop to ${blinkState.closedCut.toFixed(3)}.`,
                );
            } else {
                setVerifyHint(
                    `Gave up on the turn: peak yaw was ${peakYawRef.current.toFixed(1)}°, needed ${HEAD_TURN_YAW_THRESHOLD_DEG}°.`,
                );
            }
            setVerifyStage('idle');
        }, STAGE_TIMEOUT_MS);
        return clearAlignTimeout;
    }, [verifyStage, clearAlignTimeout]);

    const stopCamera = useCallback(() => {
        if (loopRef.current) {
            clearInterval(loopRef.current);
            loopRef.current = null;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        // Wipe the overlay too, or the last frame's mesh stays painted over the
        // "camera is off" placeholder and reads as a live face.
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        setCameraOn(false);
    }, []);

    const startCamera = useCallback(async () => {
        setError('');
        try {
            await ensureModernFaceModelsLoaded();
            setModelsReady(true);
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setCameraOn(true);
        } catch (e) {
            setError(
                e instanceof Error
                    ? `${e.name}: ${e.message}`
                    : 'Could not start the camera. Check permissions.',
            );
            stopCamera();
        }
    }, [stopCamera]);

    // Stop the camera when the page unmounts, or the light stays on.
    useEffect(() => stopCamera, [stopCamera]);

    // The sampling loop. Mirrors the one in register-alumni-personal.tsx so the
    // numbers here describe the real capture flow rather than an approximation
    // of it — same interval, same landmark extractor, same detector.
    useEffect(() => {
        if (!cameraOn) return;

        loopRef.current = setInterval(async () => {
            // Inference is slower than the interval, so without this latch the
            // callbacks pile up and the readings stop reflecting real time.
            if (busyRef.current) return;
            const video = videoRef.current;
            if (!video || video.videoWidth === 0) return;

            busyRef.current = true;
            const started = performance.now();
            try {
                const landmarks = await extractFaceLandmarksFromVideo(video);
                const inferenceMs = performance.now() - started;

                if (canvasRef.current) {
                    // Passing null when hidden also clears a stale mesh.
                    drawMesh(canvasRef.current, video, showMeshRef.current ? landmarks : null);
                }

                const now = Date.now();
                const times = frameTimesRef.current;
                times.push(now);
                while (times.length > 0 && now - times[0] > 2000) times.shift();
                const fps = times.length > 1 ? (times.length - 1) / ((now - times[0]) / 1000) : 0;

                const blinked = detectorRef.current.push(landmarks, now);
                if (blinked) {
                    blinkCountRef.current += 1;
                    // 'blinked' is a TERMINAL state: registration only ever needs
                    // one blink, so push() returns false forever afterwards. On a
                    // diagnostics page that would cap the counter at 1 and look
                    // like a broken camera, so re-arm for the next one. Soft
                    // reset keeps the learned baseline.
                    if (verifyStageRef.current !== 'blink') {
                        detectorRef.current.reset();
                    }
                }

                setMetrics({
                    faceDetected: !!landmarks,
                    ear: landmarks ? computeEyeAspectRatio(landmarks) : 0,
                    mar: landmarks ? computeMouthAspectRatio(landmarks) : 0,
                    yaw: landmarks ? estimateHeadYawDegrees(landmarks) : 0,
                    blink: detectorRef.current.debugState(),
                    blinkCount: blinkCountRef.current,
                    fps,
                    inferenceMs,
                });

                // ── Login rehearsal state machine ───────────────────────────
                // Three stages, in the order that actually makes sense:
                //   1. identify — is there a face, and is it the RIGHT face?
                //   2. blink    — so it is not a photograph
                //   3. turn     — so it is not a screen or a flat print
                //
                // Stage 1 has no separate yaw gate on purpose. face-api's
                // recognition net is only reliable near-frontal, so a descriptor
                // that MATCHES is itself proof the pose was frontal enough. The
                // previous build gated on a 2D yaw estimate instead, which on a
                // laptop camera sitting below eye level could sit outside the
                // tolerance even while the user looked straight ahead — and then
                // nothing could ever satisfy it.
                lastGateRef.current = {
                    faceDetected: !!landmarks,
                    yaw: landmarks ? estimateHeadYawDegrees(landmarks) : 0,
                };
                const stage = verifyStageRef.current;

                if (stage === 'identify') {
                    if (landmarks) {
                        const d = await grabDescriptor();
                        const acct = accountRef.current;
                        if (d && acct) {
                            const result = await verifyDebugFace(acct.id, d);
                            setVerifyResult(result);
                            if (result.isMatch) {
                                pendingDescriptorRef.current = d;
                                peakYawRef.current = 0;
                                detectorRef.current.reset();
                                setVerifyStage('blink');
                                setVerifyHint('');
                            } else {
                                // Wrong face. Stop here rather than asking for
                                // gestures — liveness on the wrong person proves
                                // nothing, and continuing would imply otherwise.
                                setVerifyHint(
                                    `Face did not match (distance ${result.distance} vs threshold ${result.threshold}).`,
                                );
                                setVerifyStage('idle');
                            }
                        } else if (!d) {
                            setVerifyHint('Face seen but no descriptor yet — hold still, more light.');
                        }
                    }
                } else if (stage === 'blink') {
                    if (detectorRef.current.hasBlinked()) {
                        peakYawRef.current = 0;
                        setVerifyStage('turn');
                        setVerifyHint('');
                    }
                } else if (stage === 'turn') {
                    // Track the PEAK yaw rather than requiring a sustained hold.
                    //
                    // TinyFaceDetector loses the face well before a full profile,
                    // so a turn far enough to be convincing is often a turn far
                    // enough to stop being detected. Requiring a continuous hold
                    // meant the detection gap reset the timer and the challenge
                    // could not be completed at all. A peak that was genuinely
                    // observed is not invalidated by the frames that came after.
                    if (landmarks) {
                        const yaw = estimateHeadYawDegrees(landmarks);
                        const signed = turnDirectionRef.current === 'left' ? yaw : -yaw;
                        if (signed > peakYawRef.current) peakYawRef.current = signed;
                    }
                    if (peakYawRef.current >= HEAD_TURN_YAW_THRESHOLD_DEG) {
                        const descriptor = pendingDescriptorRef.current;
                        if (!descriptor) {
                            setVerifyHint('Lost the captured frame — start over.');
                            setVerifyStage('idle');
                        } else {
                            setVerifyStage('done');
                            setVerifyHint('');
                        }
                    }
                }
            } catch {
                /* transient detector error — keep sampling */
            } finally {
                busyRef.current = false;
            }
        }, FACE_SAMPLE_INTERVAL_MS);

        return () => {
            if (loopRef.current) {
                clearInterval(loopRef.current);
                loopRef.current = null;
            }
        };
        // Both are useCallback([]) and never change, so listing them satisfies
        // the lint rule without the interval being torn down mid-capture.
    }, [cameraOn, grabDescriptor, clearAlignTimeout]);

    const resetDetector = () => {
        // hardReset, not reset: the learned baseline must go too, or a reading
        // taken under different lighting keeps the old baseline forever.
        detectorRef.current.hardReset();
        blinkCountRef.current = 0;
        frameTimesRef.current = [];
        setMetrics((m) => ({ ...m, blink: EMPTY_BLINK, blinkCount: 0 }));
    };

    /**
     * Rehearse a graduate login: drop the camera, bring it back, hold a frontal
     * face, then pass one randomised challenge before the descriptor is sent.
     * The restart is deliberate — it makes this feel like arriving at the login
     * screen rather than reusing a camera that has been warm for minutes.
     */
    const startVerify = useCallback(() => {
        setAccountError('');
        setVerifyResult(null);
        pendingDescriptorRef.current = null;
        peakYawRef.current = 0;

        // Direction stays randomised so a pre-recorded clip cannot be replayed.
        setTurnDirection(Math.random() < 0.5 ? 'left' : 'right');

        stopCamera();
        setVerifyStage('restarting');
        setVerifyHint('');
        restartTimerRef.current = setTimeout(() => {
            void startCamera().then(() => setVerifyStage('identify'));
        }, VERIFY_RESTART_MS);
    }, [startCamera, stopCamera]);

    const cancelVerify = useCallback(() => {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
        peakYawRef.current = 0;
        pendingDescriptorRef.current = null;
        setVerifyStage('idle');
        setVerifyHint('');
    }, []);

    useEffect(
        () => () => {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        },
        [],
    );

    // The peak is tracked in a ref (written from the loop); mirror it for the
    // overlay so the user can watch it climb as they turn.
    const peakYawDisplay =
        verifyStage === 'turn'
            ? Math.max(peakYawRef.current, turnDirection === 'left' ? metrics.yaw : -metrics.yaw)
            : 0;

    const { blink } = metrics;
    const nominalFps = Math.round(1000 / FACE_SAMPLE_INTERVAL_MS);
    const fpsTone = metrics.fps >= 10 ? 'good' : metrics.fps > 0 ? 'warn' : 'neutral';

    return (
        <PortalLayout
            role="admin"
            pageTitle="Face & Liveness Diagnostics"
            pageSubtitle="Debug tool — not part of the system spec"
        >
            <div className="space-y-5">
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                    <Activity className="size-4 shrink-0 text-amber-600 mt-0.5" />
                    <p className="text-amber-800 text-sm">
                        Live readout of the values the registration capture uses. The EAR cut-offs
                        are derived from your own face at runtime, so they differ per person and per
                        lighting condition — that is why a fixed threshold could not work.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* ── Camera ─────────────────────────────────────────── */}
                    <div className="lg:col-span-5 min-w-0 rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
                        <div
                            className="relative mb-3 overflow-hidden rounded-xl bg-gray-900"
                            style={{ aspectRatio: '4/3' }}
                        >
                            <video
                                ref={videoRef}
                                playsInline
                                muted
                                className="h-full w-full object-cover"
                            />
                            {/* Same box and same object-cover as the video, so
                                the browser scales both identically and the mesh
                                stays registered to the face. */}
                            <canvas
                                ref={canvasRef}
                                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                            />
                            {!cameraOn && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
                                    <CameraOff className="size-8" />
                                    <p className="text-xs">Camera is off</p>
                                </div>
                            )}
                            {cameraOn && (
                                <div
                                    className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[0.68rem] ${
                                        metrics.faceDetected
                                            ? 'bg-emerald-500/90 text-white'
                                            : 'bg-red-500/90 text-white'
                                    }`}
                                >
                                    {metrics.faceDetected ? 'Face detected' : 'No face'}
                                </div>
                            )}

                            {verifyStage !== 'idle' && verifyStage !== 'done' && (
                                <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2.5 text-center backdrop-blur-sm">
                                    <p className="text-sm text-white" style={{ fontWeight: 600 }}>
                                        {verifyStage === 'restarting' && 'Restarting camera…'}
                                        {verifyStage === 'identify' && '1 · Look at the camera'}
                                        {verifyStage === 'blink' && '2 · Blink once'}
                                        {verifyStage === 'turn' &&
                                            `3 · Turn your head ${turnDirection}`}
                                    </p>
                                    <p className="mt-0.5 font-mono text-[0.68rem] text-white/70">
                                        {verifyStage === 'identify' &&
                                            (metrics.faceDetected
                                                ? 'face seen — matching against the enrolled descriptor'
                                                : 'no face detected')}
                                        {verifyStage === 'blink' &&
                                            `EAR ${metrics.ear.toFixed(3)} → needs ≤ ${blink.closedCut.toFixed(3)}`}
                                        {verifyStage === 'turn' &&
                                            `peak ${metrics.faceDetected ? '' : '(face lost, peak kept) '}${peakYawDisplay.toFixed(1)}° → needs ${HEAD_TURN_YAW_THRESHOLD_DEG}°`}
                                        {verifyStage === 'restarting' &&
                                            (verifyHint || 'Rehearsing a graduate login')}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {!cameraOn ? (
                                <button
                                    onClick={() => void startCamera()}
                                    className="flex items-center gap-1.5 rounded-xl bg-[#166534] px-3.5 py-2.5 text-sm text-white transition hover:bg-[#14532d] gt-press"
                                >
                                    <Camera className="size-4" /> Start camera
                                </button>
                            ) : (
                                <button
                                    onClick={stopCamera}
                                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 gt-press"
                                >
                                    <CameraOff className="size-4" /> Stop
                                </button>
                            )}
                            <button
                                onClick={resetDetector}
                                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 gt-press"
                            >
                                <RotateCcw className="size-4" /> Reset detector
                            </button>
                            <button
                                onClick={() => setShowMesh((v) => !v)}
                                aria-pressed={showMesh}
                                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm transition gt-press ${
                                    showMesh
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                <Grid3x3 className="size-4" /> Mesh {showMesh ? 'on' : 'off'}
                            </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-gray-500">
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block size-2.5 rounded-full bg-[#34d399]" />
                                eyes — drive EAR
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block size-2.5 rounded-full bg-[#fbbf24]" />
                                mouth — drives MAR
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block size-2.5 rounded-full bg-gray-300" />
                                jaw / brows / nose
                            </span>
                        </div>

                        {error && (
                            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                                {error}
                            </p>
                        )}
                        {!error && !modelsReady && (
                            <p className="mt-3 text-xs text-gray-400">
                                face-api models load on first start (a few seconds).
                            </p>
                        )}
                    </div>

                    {/* ── Readouts ───────────────────────────────────────── */}
                    <div className="lg:col-span-7 min-w-0 space-y-4">
                        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
                            <h2
                                className="mb-3 text-sm text-gray-900"
                                style={{ fontWeight: 700 }}
                            >
                                Blink detection
                            </h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                <Stat label="Phase" value={blink.phase} />
                                <Stat
                                    label="Blinks seen"
                                    value={String(metrics.blinkCount)}
                                    hint="re-armed after each"
                                    tone={metrics.blinkCount > 0 ? 'good' : 'neutral'}
                                />
                                <Stat
                                    label="EAR now"
                                    value={metrics.ear.toFixed(3)}
                                    hint={
                                        metrics.ear <= blink.closedCut
                                            ? 'below closed cut'
                                            : metrics.ear >= blink.openCut
                                              ? 'above open cut'
                                              : 'between cuts'
                                    }
                                />
                                <Stat
                                    label="Open baseline"
                                    value={blink.openBaseline.toFixed(3)}
                                    hint="learned from your face"
                                />
                                <Stat
                                    label="Closed cut"
                                    value={blink.closedCut.toFixed(3)}
                                    hint={`ceiling ${EYE_CLOSED_EAR_THRESHOLD}`}
                                />
                                <Stat
                                    label="Open cut"
                                    value={blink.openCut.toFixed(3)}
                                    hint={`ceiling ${EYE_OPEN_EAR_THRESHOLD}`}
                                />
                                <Stat
                                    label="Min EAR seen"
                                    value={blink.minEar === 1 ? '—' : blink.minEar.toFixed(3)}
                                    hint="lowest this session"
                                    tone={
                                        blink.minEar !== 1 && blink.minEar > blink.closedCut
                                            ? 'warn'
                                            : 'neutral'
                                    }
                                />
                                <Stat
                                    label="Max closed"
                                    value={`${BLINK_MAX_CLOSED_MS} ms`}
                                    hint="longer = not a blink"
                                />
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-gray-500">
                                If <span className="font-mono">Min EAR seen</span> never drops below{' '}
                                <span className="font-mono">Closed cut</span> while you blink
                                normally, the cut-off is too strict for your face — that is the
                                number to tune, not the sampling rate.
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-gray-500">
                                Registration latches after one blink and stops —{' '}
                                <span className="font-mono">&apos;blinked&apos;</span> is a terminal
                                state there, which is correct. This page re-arms the detector after
                                each blink, so a counter stuck at 1 would be the detector, not your
                                camera.
                            </p>
                        </section>

                        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
                            <h2 className="mb-3 text-sm text-gray-900" style={{ fontWeight: 700 }}>
                                Pose &amp; sampling
                            </h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                <Stat
                                    label="Yaw"
                                    value={`${metrics.yaw.toFixed(1)}°`}
                                    hint={`turn ≥ ${HEAD_TURN_YAW_THRESHOLD_DEG}° · frontal ≤ ${FRONTAL_YAW_TOLERANCE_DEG}°`}
                                    tone={
                                        Math.abs(metrics.yaw) >= HEAD_TURN_YAW_THRESHOLD_DEG
                                            ? 'good'
                                            : 'neutral'
                                    }
                                />
                                <Stat
                                    label="Mouth (MAR)"
                                    value={metrics.mar.toFixed(3)}
                                    hint={`open > ${MOUTH_OPEN_MAR_THRESHOLD}`}
                                />
                                <Stat
                                    label="Achieved FPS"
                                    value={metrics.fps.toFixed(1)}
                                    hint={`nominal ${nominalFps}`}
                                    tone={fpsTone}
                                />
                                <Stat
                                    label="Inference"
                                    value={`${metrics.inferenceMs.toFixed(0)} ms`}
                                    hint="per frame"
                                />
                                <Stat
                                    label="Sample interval"
                                    value={`${FACE_SAMPLE_INTERVAL_MS} ms`}
                                    hint="floor, not a guarantee"
                                />
                                <Stat
                                    label="Face"
                                    value={metrics.faceDetected ? 'yes' : 'no'}
                                    tone={metrics.faceDetected ? 'good' : 'warn'}
                                />
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-gray-500">
                                Achieved FPS is what matters, not the sample interval. A blink&apos;s
                                fully-closed phase lasts roughly 100 ms, so below about 10 FPS the
                                loop can step straight over it and no threshold will help.
                            </p>
                        </section>

                        {/* ── Dummy account round-trip ───────────────────── */}
                        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
                            <h2 className="mb-1 text-sm text-gray-900" style={{ fontWeight: 700 }}>
                                Throwaway account
                            </h2>
                            <p className="mb-3 text-xs leading-relaxed text-gray-500">
                                Enrol a face, then verify a fresh capture against it. The server
                                runs the same comparison the real login does, so the distance below
                                is the number production would compute.
                            </p>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    disabled={!!busy}
                                    onClick={() =>
                                        void runAccountAction('create', async () => {
                                            const created = await createDebugFaceAccount();
                                            setAccount(created);
                                            setEnrolled(false);
                                            setVerifyResult(null);
                                        })
                                    }
                                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 gt-press"
                                >
                                    <UserPlus className="size-4" />
                                    {busy === 'create' ? 'Creating…' : 'New test account'}
                                </button>

                                <button
                                    disabled={!!busy || !account || !cameraOn}
                                    onClick={() =>
                                        void runAccountAction('enrol', async () => {
                                            const d = await grabDescriptor();
                                            if (!d) throw new Error('No face in frame — hold still and retry.');
                                            await enrolDebugFace(account!.id, d, [d]);
                                            setEnrolled(true);
                                            setVerifyResult(null);
                                        })
                                    }
                                    className="flex items-center gap-1.5 rounded-xl bg-[#166534] px-3 py-2 text-sm text-white transition hover:bg-[#14532d] disabled:opacity-50 gt-press"
                                >
                                    <ScanFace className="size-4" />
                                    {busy === 'enrol' ? 'Enrolling…' : 'Enrol this face'}
                                </button>

                                {verifyStage === 'idle' || verifyStage === 'done' ? (
                                    <button
                                        disabled={!!busy || !account || !enrolled}
                                        onClick={startVerify}
                                        className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 gt-press"
                                    >
                                        <Activity className="size-4" /> Verify like a login (3 stages)
                                    </button>
                                ) : (
                                    <button
                                        onClick={cancelVerify}
                                        className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 transition gt-press"
                                    >
                                        Cancel rehearsal
                                    </button>
                                )}

                                <button
                                    disabled={!!busy}
                                    onClick={() =>
                                        void runAccountAction('purge', async () => {
                                            const n = await purgeDebugFaceAccounts();
                                            setAccount(null);
                                            setEnrolled(false);
                                            setVerifyResult(null);
                                            setAccountError(`Deleted ${n} debug account(s).`);
                                        })
                                    }
                                    className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50 gt-press"
                                >
                                    <Trash2 className="size-4" />
                                    {busy === 'purge' ? 'Deleting…' : 'Delete all test accounts'}
                                </button>
                            </div>

                            {account && (
                                <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 break-all">
                                    {account.email} · {enrolled ? 'face enrolled' : 'no face yet'}
                                </p>
                            )}

                            {verifyResult && (
                                <div
                                    className={`mt-3 rounded-xl border p-3 ${
                                        verifyResult.isMatch
                                            ? 'border-emerald-200 bg-emerald-50'
                                            : 'border-red-200 bg-red-50'
                                    }`}
                                >
                                    <p
                                        className={`text-sm ${verifyResult.isMatch ? 'text-emerald-800' : 'text-red-700'}`}
                                        style={{ fontWeight: 600 }}
                                    >
                                        {verifyResult.isMatch ? 'MATCH' : 'NO MATCH'}
                                    </p>
                                    <p className="mt-1 font-mono text-xs text-gray-600">
                                        distance {verifyResult.distance} · threshold{' '}
                                        {verifyResult.threshold} · similarity{' '}
                                        {verifyResult.similarity} · {verifyResult.referenceCount} ref
                                    </p>
                                    <p className="mt-1 text-[0.68rem] leading-snug text-gray-500">
                                        Same face usually lands 0.30–0.45; different people sit above
                                        0.60. A stranger scoring under the threshold means it is still
                                        too loose.
                                    </p>
                                </div>
                            )}

                            {verifyHint && verifyStage === 'idle' && (
                                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
                                    {verifyHint}
                                </p>
                            )}

                            {accountError && (
                                <p className="mt-3 text-sm text-gray-700">{accountError}</p>
                            )}
                        </section>
                    </div>
                </div>
            </div>
        </PortalLayout>
    );
}
// #endregion DEBUG-ONLY:CurrenChanDebug
