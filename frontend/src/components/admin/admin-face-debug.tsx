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
import { MESH_COLORS, clearFaceMesh, drawFaceMesh } from '../../app/face-mesh';
import {
    createDebugFaceAccount,
    enrolDebugFace,
    fetchDebugFaceEngines,
    purgeDebugFaceAccounts,
    verifyDebugFace,
    type DebugFaceAccount,
    type DebugFaceEngineInfo,
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
// Stage 1 costs a descriptor pass plus an HTTP round trip. login-page.tsx polls
// its own alignment loop at 600ms; there is no reason to be greedier.
const IDENTIFY_POLL_MS = 700;

/**
 * Yaw angles to collect during enrolment, in degrees (negative = turned right).
 *
 * One frontal frame yields one reference vector, so a login at a slightly
 * different angle has nothing close to match against. Collecting a short sweep
 * gives several references and the best one wins -- which is why banking apps
 * ask you to turn your head instead of just holding still.
 *
 * The range stops around +/-24 deg on purpose: face-api's tinyFaceDetector
 * loses the face not far past that, so asking for a full profile would collect
 * nothing. InsightFace's SCRFD holds on considerably further, and the
 * frames-used count after enrolment is what shows that difference.
 */
const SWEEP_TARGETS = [-24, -12, 0, 12, 24];
/** How close to a target the yaw must be for that slot to accept a frame. */
const SWEEP_TOLERANCE_DEG = 7;

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
    const [engines, setEngines] = useState<DebugFaceEngineInfo[]>([]);
    const [selectedEngine, setSelectedEngine] = useState('faceapi');
    const [enrolledEngines, setEnrolledEngines] = useState<string[]>([]);
    const selectedEngineRef = useRef('faceapi');
    useEffect(() => {
        selectedEngineRef.current = selectedEngine;
    }, [selectedEngine]);

    const activeEngine = engines.find((e) => e.name === selectedEngine) ?? null;
    const enginesRef = useRef<DebugFaceEngineInfo[]>([]);
    useEffect(() => {
        enginesRef.current = engines;
    }, [engines]);
    const activeEngineRef = useRef<DebugFaceEngineInfo | null>(null);
    useEffect(() => {
        activeEngineRef.current = activeEngine;
    }, [activeEngine]);

    useEffect(() => {
        void fetchDebugFaceEngines()
            .then((data) => {
                setEngines(data.engines);
                setSelectedEngine(data.serverDefault);
            })
            .catch(() => {
                // Selector stays empty; the page is still usable for the live
                // metrics, which need no server at all.
            });
    }, []);

    /**
     * One row per engine for a SINGLE capture. Comparing engines is the entire
     * purpose of this page, and reading one number at a time cannot do it --
     * the scales differ, so a lone 0.42 is uninterpretable without the other
     * engines' numbers and their own thresholds beside it.
     */
    interface ComparisonRow {
        engine: string;
        dimensions?: number;
        metric?: string;
        distance?: number;
        threshold?: number;
        isMatch?: boolean;
        /** How far under (negative) or over (positive) its own threshold. */
        margin?: number;
        error?: string;
        ms?: number;
    }
    const [comparison, setComparison] = useState<ComparisonRow[] | null>(null);
    /** What the server actually stored, per engine, on the last enrolment. */
    const [enrolStats, setEnrolStats] = useState<
        { engine: string; dimensions: number; samples: number; supplied: number; used: number | null }[]
    >([]);

    /** One captured pose: the frame, its vector (browser engines only), the angle. */
    interface SweepSample {
        blob: Blob | null;
        descriptor: number[] | null;
        yaw: number;
        dataUrl: string;
    }
    const [sweep, setSweep] = useState<(SweepSample | null)[]>(
        () => SWEEP_TARGETS.map(() => null),
    );
    const [sweeping, setSweeping] = useState(false);
    // The loop writes samples; a ref keeps it out of the effect dependencies.
    const sweepRef = useRef<SweepSample[]>([]);
    const sweepSlotsRef = useRef<(SweepSample | null)[]>(SWEEP_TARGETS.map(() => null));
    const sweepingRef = useRef(false);
    useEffect(() => {
        sweepingRef.current = sweeping;
    }, [sweeping]);

    /**
     * A rolling log of what the rehearsal actually did.
     *
     * A single "last failure" string kept losing the context that mattered: the
     * deadline would overwrite it, or report its own guess when nothing had been
     * recorded, and the result was a message that named the wrong cause. A log
     * cannot do that -- whatever happened is still on screen.
     */
    const [log, setLog] = useState<{ t: string; msg: string }[]>([]);
    const pushLog = useCallback((msg: string) => {
        const t = new Date().toLocaleTimeString([], {
            minute: '2-digit',
            second: '2-digit',
        });
        setLog((prev) => [...prev.slice(-11), { t, msg }]);
    }, []);
    const pushLogRef = useRef(pushLog);
    useEffect(() => {
        pushLogRef.current = pushLog;
    }, [pushLog]);

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
    /**
     * Stage 1 runs a descriptor pass AND a network round trip, so it must not
     * fire on every sampled frame. Throttled to the rate login polls at.
     */
    const lastIdentifyAttemptRef = useRef(0);
    /**
     * The last REAL error, as opposed to a frame that simply had no face in it.
     * The loop catch-all used to discard these, so an HTTP 401 or 409 looked
     * identical to a dropped frame and the deadline then invented a reason.
     */
    const lastFailureRef = useRef('');
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
     * One frame from the live video, as both a JPEG and (for face-api only) a
     * descriptor.
     *
     * Which half matters depends on the engine: face-api computes its embedding
     * in the browser and the server just compares it, while InsightFace and
     * CompreFace embed the image themselves and ignore anything the client
     * computed. Sending both keeps one code path for all three, and skipping
     * the descriptor pass for server-side engines avoids paying for an
     * inference nobody will read.
     */
    const grabCapture = useCallback(
        async (
            needsDescriptor: boolean,
        ): Promise<{ blob: Blob | null; descriptor: number[] | null; dataUrl: string }> => {
            const empty = { blob: null, descriptor: null, dataUrl: '' };
            const video = videoRef.current;
            if (!video || video.videoWidth === 0) return empty;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return empty;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const blob = await (await fetch(dataUrl)).blob();
            const descriptor = needsDescriptor
                ? await extractFaceDescriptorFromDataUrl(dataUrl)
                : null;
            return { blob, descriptor, dataUrl };
        },
        [],
    );

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
            if (lastFailureRef.current) {
                setVerifyHint(`Gave up: ${lastFailureRef.current}`);
            } else if (!faceDetected) {
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
        clearFaceMesh(canvasRef.current);
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
                    drawFaceMesh(canvasRef.current, video, showMeshRef.current ? landmarks : null, {
                        alpha: 1,
                    });
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

                // ── Enrolment sweep ─────────────────────────────────────────
                // Fills one slot per target angle. Slots are filled once and
                // then left alone, so holding still at 0 deg cannot flood the
                // set with near-identical frontal frames and crowd out the
                // angles that actually add information.
                if (sweepingRef.current && landmarks) {
                    const yaw = estimateHeadYawDegrees(landmarks);
                    const slot = SWEEP_TARGETS.findIndex(
                        (target, i) =>
                            sweepSlotsRef.current[i] === null &&
                            Math.abs(yaw - target) <= SWEEP_TOLERANCE_DEG,
                    );
                    if (slot >= 0) {
                        const anyBrowser = enginesRef.current.some(
                            (e) => e.available && e.runsInBrowser,
                        );
                        const shot = await grabCapture(anyBrowser);
                        if (shot.blob) {
                            const sample: SweepSample = { ...shot, yaw };
                            sweepSlotsRef.current[slot] = sample;
                            sweepRef.current = sweepSlotsRef.current.filter(
                                (x): x is SweepSample => x !== null,
                            );
                            setSweep([...sweepSlotsRef.current]);
                            pushLogRef.current(
                                `captured ${SWEEP_TARGETS[slot] > 0 ? '+' : ''}${SWEEP_TARGETS[slot]}° (actual ${yaw.toFixed(1)}°)`,
                            );
                            if (sweepSlotsRef.current.every((x) => x !== null)) {
                                setSweeping(false);
                                pushLogRef.current('sweep complete');
                            }
                        }
                    }
                }

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
                    const acct = accountRef.current;
                    if (!acct) {
                        lastFailureRef.current = 'No debug account selected.';
                        setVerifyHint(lastFailureRef.current);
                        setVerifyStage('idle');
                    } else if (
                        landmarks &&
                        now - lastIdentifyAttemptRef.current >= IDENTIFY_POLL_MS
                    ) {
                        lastIdentifyAttemptRef.current = now;
                        const engineName = selectedEngineRef.current;
                        const known = activeEngineRef.current;
                        // If the engine list never loaded, `known` is null and
                        // this would silently assume a browser engine and demand
                        // a descriptor no server-side engine can supply. Say so
                        // rather than failing as though the face were the problem.
                        if (!known) {
                            lastFailureRef.current =
                                `Engine "${engineName}" is not in the loaded engine list — ` +
                                'the list needs an admin token. Reload while signed in.';
                            pushLogRef.current(lastFailureRef.current);
                            setVerifyHint(lastFailureRef.current);
                            setVerifyStage('idle');
                            return;
                        }
                        const inBrowser = known.runsInBrowser;
                        const capture = await grabCapture(inBrowser);
                        // A browser engine has nothing to send without its
                        // descriptor; a server-side engine only needs the frame.
                        const usable = inBrowser ? !!capture.descriptor : !!capture.blob;
                        if (!usable) {
                            lastFailureRef.current = inBrowser
                                ? 'Landmarks found a face, but the recognition net returned no descriptor.'
                                : 'Could not capture a frame to send.';
                            pushLogRef.current(lastFailureRef.current);
                            setVerifyHint('Hold still — reading your face…');
                        } else {
                            // Its own try/catch: this is a NETWORK call, and the
                            // loop catch-all exists for dropped frames. Letting
                            // an HTTP error fall through to it is exactly what
                            // made this stage stall behind an invented reason.
                            try {
                                pushLogRef.current(
                                    `verify → ${engineName} (${inBrowser ? 'descriptor' : 'image'})`,
                                );
                                const result = await verifyDebugFace(
                                    acct.id,
                                    engineName,
                                    capture,
                                );
                                setVerifyResult(result);
                                pushLogRef.current(
                                    `${engineName}: distance ${result.distance} vs ${result.threshold} → ${result.isMatch ? 'MATCH' : 'no match'}`,
                                );
                                if (result.isMatch) {
                                    pendingDescriptorRef.current = capture.descriptor ?? [];
                                    peakYawRef.current = 0;
                                    detectorRef.current.reset();
                                    setVerifyStage('blink');
                                    setVerifyHint('');
                                } else {
                                    // Wrong face. Stop rather than asking for
                                    // gestures: liveness on the wrong person
                                    // proves nothing, and carrying on would
                                    // imply the identity check had passed.
                                    setVerifyHint(
                                        `Face did not match — distance ${result.distance} vs threshold ${result.threshold}.`,
                                    );
                                    setVerifyStage('idle');
                                }
                            } catch (e) {
                                lastFailureRef.current =
                                    e instanceof Error ? e.message : 'Verify request failed.';
                                pushLogRef.current(`verify FAILED: ${lastFailureRef.current}`);
                                setVerifyHint(`Verify request failed: ${lastFailureRef.current}`);
                                setVerifyStage('idle');
                            }
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
            } catch (e) {
                // A frame with no face in it is normal and raises nothing, so
                // anything landing here is worth keeping: it lets the stage
                // deadline report what actually went wrong instead of guessing.
                lastFailureRef.current = e instanceof Error ? e.message : String(e);
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
    }, [cameraOn, grabCapture, clearAlignTimeout]);

    const resetDetector = () => {
        // hardReset, not reset: the learned baseline must go too, or a reading
        // taken under different lighting keeps the old baseline forever.
        detectorRef.current.hardReset();
        blinkCountRef.current = 0;
        frameTimesRef.current = [];
        setMetrics((m) => ({ ...m, blink: EMPTY_BLINK, blinkCount: 0 }));
    };

    /**
     * Enrol the SAME capture under every available engine.
     *
     * One capture, not one per engine: if each engine saw a different frame,
     * any difference in their distances could just be the frames differing,
     * and the comparison would prove nothing.
     */
    const enrolAllEngines = useCallback(async () => {
        const acct = accountRef.current;
        if (!acct) throw new Error('Create a test account first.');
        const usable = engines.filter((e) => e.available);
        if (usable.length === 0) throw new Error('No engines available.');

        // Every engine gets the SAME frames. If each saw different frames, a
        // difference in their distances could just be the frames differing.
        const captures = sweepRef.current.length
            ? sweepRef.current
            : [await grabCapture(usable.some((e) => e.runsInBrowser))];
        if (!captures.some((c) => c.blob)) throw new Error('Could not capture a frame.');

        const done: string[] = [];
        const failures: string[] = [];
        const stats: typeof enrolStats = [];
        for (const e of usable) {
            try {
                const res = await enrolDebugFace(acct.id, e.name, captures);
                done.push(...res.enrolledEngines);
                stats.push({
                    engine: res.engine,
                    dimensions: res.dimensions,
                    samples: res.samples,
                    supplied: res.framesSupplied,
                    used: res.framesUsed,
                });
            } catch (err) {
                failures.push(`${e.name}: ${err instanceof Error ? err.message : 'failed'}`);
            }
        }
        setEnrolledEngines(Array.from(new Set(done)));
        setEnrolled(done.length > 0);
        setEnrolStats(stats);
        setComparison(null);
        if (failures.length) throw new Error(failures.join(' · '));
    }, [engines, grabCapture]);

    /** Run one capture through every engine and lay the answers side by side. */
    const compareAllEngines = useCallback(async () => {
        const acct = accountRef.current;
        if (!acct) throw new Error('Create a test account first.');
        const usable = engines.filter((e) => e.available);
        if (usable.length === 0) throw new Error('No engines available.');

        const capture = await grabCapture(usable.some((e) => e.runsInBrowser));
        if (!capture.blob) throw new Error('Could not capture a frame.');

        const rows: ComparisonRow[] = [];
        for (const e of usable) {
            const started = performance.now();
            try {
                const r = await verifyDebugFace(acct.id, e.name, capture);
                rows.push({
                    engine: e.name,
                    dimensions: r.dimensions,
                    metric: r.metric,
                    distance: r.distance,
                    threshold: r.threshold,
                    isMatch: r.isMatch,
                    // Normalising by the threshold is what makes two different
                    // metrics comparable: -0.4 means "40% of the way inside its
                    // own limit" whichever engine produced it.
                    margin:
                        r.threshold > 0 ? (r.distance - r.threshold) / r.threshold : undefined,
                    ms: Math.round(performance.now() - started),
                });
            } catch (err) {
                rows.push({
                    engine: e.name,
                    error: err instanceof Error ? err.message : 'request failed',
                    ms: Math.round(performance.now() - started),
                });
            }
        }
        setComparison(rows);
    }, [engines, grabCapture]);

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
        lastIdentifyAttemptRef.current = 0;
        lastFailureRef.current = '';

        // Direction stays randomised so a pre-recorded clip cannot be replayed.
        setTurnDirection(Math.random() < 0.5 ? 'left' : 'right');

        setLog([]);
        pushLog(`start · engine=${selectedEngine}`);
        stopCamera();
        setVerifyStage('restarting');
        setVerifyHint('');
        restartTimerRef.current = setTimeout(() => {
            void startCamera().then(() => setVerifyStage('identify'));
        }, VERIFY_RESTART_MS);
    }, [startCamera, stopCamera, pushLog, selectedEngine]);

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
                                <span
                                    className="inline-block size-2.5 rounded-full"
                                    style={{ background: MESH_COLORS.ear }}
                                />
                                eyes — drive EAR
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span
                                    className="inline-block size-2.5 rounded-full"
                                    style={{ background: MESH_COLORS.mar }}
                                />
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

                            {/* Engine selector — the reason this page exists.
                                Templates are stored per engine, so the same face
                                can be enrolled under each and their distances
                                compared directly. */}
                            <div className="mb-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                                <p
                                    className="mb-2 text-[0.68rem] uppercase tracking-wide text-gray-500"
                                >
                                    Recognition engine
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {engines.length === 0 && (
                                        <p className="text-xs text-gray-400">
                                            Could not load the engine list (admin token required).
                                        </p>
                                    )}
                                    {engines.map((e) => {
                                        const active = e.name === selectedEngine;
                                        const done = enrolledEngines.includes(e.name);
                                        return (
                                            <button
                                                key={e.name}
                                                onClick={() => setSelectedEngine(e.name)}
                                                disabled={!e.available}
                                                title={e.reason}
                                                className={`rounded-lg border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 gt-press ${
                                                    active
                                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                                }`}
                                            >
                                                <span
                                                    className="block font-mono"
                                                    style={{ fontWeight: 600 }}
                                                >
                                                    {e.name}
                                                    {done ? ' ✓' : ''}
                                                </span>
                                                <span className="block text-[0.66rem] text-gray-500">
                                                    {e.dimensions}-d · {e.metric} · thr{' '}
                                                    {e.threshold}
                                                </span>
                                                <span className="block text-[0.66rem] text-gray-400">
                                                    {e.runsInBrowser ? 'browser' : 'server'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {activeEngine && !activeEngine.available && (
                                    <p className="mt-2 text-xs text-amber-700">
                                        {activeEngine.reason}
                                    </p>
                                )}
                                <p className="mt-2 text-[0.66rem] leading-snug text-gray-500">
                                    Distances are NOT comparable across engines — face-api is
                                    euclidean where strangers sit above 0.60, ArcFace is cosine
                                    where they sit above 0.45. Compare each against its own
                                    threshold, not against each other.
                                </p>
                            </div>

                            {/* Multi-angle enrolment. Slots fill as the yaw
                                passes each target, so the set covers a range of
                                poses instead of five near-identical frontals. */}
                            <div className="mb-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-[0.68rem] uppercase tracking-wide text-gray-500">
                                        Enrolment poses
                                    </p>
                                    <button
                                        disabled={!cameraOn}
                                        onClick={() => {
                                            sweepSlotsRef.current = SWEEP_TARGETS.map(() => null);
                                            sweepRef.current = [];
                                            setSweep(SWEEP_TARGETS.map(() => null));
                                            setSweeping((v) => !v);
                                            pushLog(sweeping ? 'sweep cancelled' : 'sweep started');
                                        }}
                                        className={`rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-50 gt-press ${
                                            sweeping
                                                ? 'border-amber-300 bg-amber-50 text-amber-800'
                                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        {sweeping ? 'Stop sweep' : 'Capture sweep'}
                                    </button>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {SWEEP_TARGETS.map((target, i) => {
                                        const shot = sweep[i];
                                        const isNext =
                                            sweeping &&
                                            !shot &&
                                            sweep.findIndex((x) => !x) === i;
                                        return (
                                            <div key={target} className="w-[4.4rem]">
                                                <div
                                                    className={`flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border ${
                                                        shot
                                                            ? 'border-emerald-300'
                                                            : isNext
                                                              ? 'border-amber-400 bg-amber-50'
                                                              : 'border-dashed border-gray-300 bg-white'
                                                    }`}
                                                >
                                                    {shot ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={shot.dataUrl}
                                                            alt={`pose ${target}°`}
                                                            className="h-full w-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="text-[0.62rem] text-gray-400">
                                                            {sweeping ? 'turn' : 'empty'}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-center font-mono text-[0.62rem] text-gray-500">
                                                    {target > 0 ? '+' : ''}
                                                    {target}°
                                                    {shot && (
                                                        <span className="block text-gray-400">
                                                            got {shot.yaw.toFixed(0)}°
                                                        </span>
                                                    )}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>

                                <p className="mt-2 text-[0.66rem] leading-snug text-gray-500">
                                    {sweeping
                                        ? 'Turn your head slowly left to right. Each slot fills once, so holding still cannot flood the set with identical frontals.'
                                        : 'Capture a sweep, then enrol — every engine gets the SAME frames, so any difference in their distances is the engine and not the photos.'}
                                </p>
                            </div>

                            {enrolStats.length > 0 && (
                                <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                                    <p className="mb-1.5 text-[0.68rem] uppercase tracking-wide text-gray-500">
                                        Stored template
                                    </p>
                                    {enrolStats.map((st) => (
                                        <p
                                            key={st.engine}
                                            className="font-mono text-[0.7rem] text-gray-700"
                                        >
                                            {st.engine}: {st.samples} × {st.dimensions}-d
                                            {st.used !== null && (
                                                <span
                                                    className={
                                                        st.used < st.supplied
                                                            ? ' text-amber-700'
                                                            : ' text-emerald-700'
                                                    }
                                                >
                                                    {' '}
                                                    · {st.used}/{st.supplied} frames usable
                                                </span>
                                            )}
                                        </p>
                                    ))}
                                    <p className="mt-1.5 text-[0.66rem] leading-snug text-gray-500">
                                        <b>frames usable</b> is the honest comparison: both engines
                                        got the same poses, so whichever turned more of them into
                                        embeddings coped better with the angles. face-api normally
                                        drops the outer ones.
                                    </p>
                                </div>
                            )}

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
                                    onClick={() => void runAccountAction('enrolAll', enrolAllEngines)}
                                    className="flex items-center gap-1.5 rounded-xl bg-[#166534] px-3 py-2 text-sm text-white transition hover:bg-[#14532d] disabled:opacity-50 gt-press"
                                >
                                    <ScanFace className="size-4" />
                                    {busy === 'enrolAll' ? 'Enrolling…' : 'Enrol on ALL engines'}
                                </button>

                                <button
                                    disabled={
                                        !!busy || !account || !cameraOn || enrolledEngines.length === 0
                                    }
                                    onClick={() => void runAccountAction('compare', compareAllEngines)}
                                    className="flex items-center gap-1.5 rounded-xl border border-[#166534] px-3 py-2 text-sm text-[#166534] transition hover:bg-emerald-50 disabled:opacity-50 gt-press"
                                >
                                    <Activity className="size-4" />
                                    {busy === 'compare' ? 'Comparing…' : 'Compare ALL engines'}
                                </button>

                                <button
                                    disabled={!!busy || !account || !cameraOn}
                                    onClick={() =>
                                        void runAccountAction('enrol', async () => {
                                            const inBrowser =
                                                activeEngine?.runsInBrowser ?? true;
                                            const capture = await grabCapture(inBrowser);
                                            if (inBrowser && !capture.descriptor) {
                                                throw new Error(
                                                    'No face in frame — hold still and retry.',
                                                );
                                            }
                                            if (!capture.blob) {
                                                throw new Error('Could not capture a frame.');
                                            }
                                            const res = await enrolDebugFace(
                                                account!.id,
                                                selectedEngine,
                                                [capture],
                                            );
                                            setEnrolledEngines(res.enrolledEngines);
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
                                        disabled={!!busy || !account || !enrolledEngines.includes(selectedEngine)}
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

                            {comparison && (
                                <div className="mt-3 overflow-x-auto">
                                    <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-200 text-[0.66rem] uppercase tracking-wide text-gray-500">
                                                <th className="py-1.5 pr-3">Engine</th>
                                                <th className="py-1.5 pr-3">Distance</th>
                                                <th className="py-1.5 pr-3">Threshold</th>
                                                <th className="py-1.5 pr-3">Margin</th>
                                                <th className="py-1.5 pr-3">Verdict</th>
                                                <th className="py-1.5">Took</th>
                                            </tr>
                                        </thead>
                                        <tbody className="font-mono">
                                            {comparison.map((row) => (
                                                <tr
                                                    key={row.engine}
                                                    className="border-b border-gray-100 last:border-0"
                                                >
                                                    <td className="py-2 pr-3">
                                                        <span style={{ fontWeight: 600 }}>
                                                            {row.engine}
                                                        </span>
                                                        {row.dimensions && (
                                                            <span className="block text-[0.64rem] text-gray-400">
                                                                {row.dimensions}-d · {row.metric}
                                                            </span>
                                                        )}
                                                    </td>
                                                    {row.error ? (
                                                        <td
                                                            colSpan={4}
                                                            className="py-2 pr-3 font-sans text-red-600"
                                                        >
                                                            {row.error}
                                                        </td>
                                                    ) : (
                                                        <>
                                                            <td className="py-2 pr-3">
                                                                {row.distance?.toFixed(4)}
                                                            </td>
                                                            <td className="py-2 pr-3 text-gray-500">
                                                                {row.threshold}
                                                            </td>
                                                            <td
                                                                className={`py-2 pr-3 ${
                                                                    (row.margin ?? 0) < 0
                                                                        ? 'text-emerald-700'
                                                                        : 'text-red-600'
                                                                }`}
                                                            >
                                                                {row.margin === undefined
                                                                    ? '—'
                                                                    : `${row.margin > 0 ? '+' : ''}${(row.margin * 100).toFixed(0)}%`}
                                                            </td>
                                                            <td className="py-2 pr-3">
                                                                <span
                                                                    className={
                                                                        row.isMatch
                                                                            ? 'text-emerald-700'
                                                                            : 'text-red-600'
                                                                    }
                                                                    style={{ fontWeight: 600 }}
                                                                >
                                                                    {row.isMatch ? 'MATCH' : 'NO'}
                                                                </span>
                                                            </td>
                                                        </>
                                                    )}
                                                    <td className="py-2 text-gray-400">
                                                        {row.ms}ms
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <p className="mt-2 text-[0.66rem] leading-snug text-gray-500">
                                        <b>Margin</b> is distance relative to that engine&apos;s own
                                        threshold, so it IS comparable across engines where the raw
                                        distances are not. &minus;60% means the face landed 60% inside
                                        the limit; +20% means it missed by 20%. More negative is a
                                        more confident match.
                                    </p>
                                    <p className="mt-1 text-[0.66rem] leading-snug text-gray-500">
                                        The number that decides the engine choice is an IMPOSTOR
                                        margin: enrol your face, then have someone else press
                                        Compare. Whichever engine pushes them furthest positive is
                                        the one worth shipping.
                                    </p>
                                </div>
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
                                    {verifyResult.engine && (
                                        <p className="mt-1 font-mono text-[0.68rem] text-gray-500">
                                            engine: {verifyResult.engine}
                                            {verifyResult.dimensions
                                                ? ` · ${verifyResult.dimensions}-d`
                                                : ''}
                                        </p>
                                    )}
                                    <p className="mt-1 text-[0.68rem] leading-snug text-gray-500">
                                        Same face usually lands 0.30–0.45; different people sit above
                                        0.60. A stranger scoring under the threshold means it is still
                                        too loose.
                                    </p>
                                </div>
                            )}

                            {log.length > 0 && (
                                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-900 p-2.5">
                                    <p className="mb-1 text-[0.62rem] uppercase tracking-wide text-white/40">
                                        Rehearsal log
                                    </p>
                                    <div className="max-h-40 overflow-y-auto">
                                        {log.map((entry, i) => (
                                            <p
                                                key={`${entry.t}-${i}`}
                                                className="font-mono text-[0.66rem] leading-relaxed text-white/80"
                                            >
                                                <span className="text-white/35">{entry.t} </span>
                                                {entry.msg}
                                            </p>
                                        ))}
                                    </div>
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
