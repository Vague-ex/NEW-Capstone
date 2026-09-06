const MODEL_URI = '/modern-face-models';
const DESCRIPTOR_LENGTH = 128;
const FACE_DISTANCE_SIMILARITY_SCALE = 1.5;
// Must track FACE_DESCRIPTOR_DISTANCE_THRESHOLD in backend/users/api.py. The
// server decides, but if the client is looser it tells the user "matched" a
// moment before the API rejects them, which reads as a broken login.
// 0.55 sits below the ~0.60 point where different people start colliding.
export const FACE_MATCH_DISTANCE_THRESHOLD = 0.55;
export const FACE_MATCH_SIMILARITY_THRESHOLD =
    1 - FACE_MATCH_DISTANCE_THRESHOLD / FACE_DISTANCE_SIMILARITY_SCALE;

export const MOUTH_OPEN_MAR_THRESHOLD = 0.45;
export const MOUTH_CLOSED_MAR_THRESHOLD = 0.25;
// Absolute CEILINGS for the adaptive blink thresholds below. A fixed cut-off
// alone does not work: baseline open-EAR varies with eye shape, glasses and
// camera angle, so someone whose open eyes sit near 0.26 could never cross a
// fixed 0.21 "closed" line and their blinks were never detected. The detector
// now derives per-user cut-offs from an observed baseline and clamps them here
// so the thresholds can adapt downward but never become permissive.
export const EYE_CLOSED_EAR_THRESHOLD = 0.24;
export const EYE_OPEN_EAR_THRESHOLD = 0.29;
// Fractions of the user's own observed open-eye baseline. 0.80 was chosen so
// the derived cut is never stricter than the old fixed 0.21 for a typical
// baseline — a lower ratio made detection HARDER for exactly the narrow-eyed
// and glasses-wearing users whose blinks were being missed.
export const BLINK_CLOSE_RATIO = 0.80;
export const BLINK_OPEN_RATIO = 0.90;
// Floor so a momentarily bad baseline cannot drive the cut to an unreachable
// value, and a minimum gap so hysteresis survives clamping at either end.
export const EYE_CLOSED_EAR_FLOOR = 0.16;
export const EYE_EAR_HYSTERESIS = 0.04;
// Lowered from 20°. The identity descriptor is now taken from a dedicated
// frontal frame, so a turn no longer has to produce a recognisable face — it
// only has to prove motion. A gentler angle is far easier to hit and holds up
// better on laptop webcams, where the 2D yaw estimate is noisy.
export const HEAD_TURN_YAW_THRESHOLD_DEG = 12;
export const FRONTAL_YAW_TOLERANCE_DEG = 15;
// A natural blink lasts roughly 100–400 ms, so the eyes must reopen within this
// window. Anything longer is someone holding their eyes shut, which a still
// photo of a closed-eyed face could also produce.
export const BLINK_MAX_CLOSED_MS = 1200;
// How often the live video should be sampled for liveness. This is a floor, not
// a guarantee: face-api.js inference adds 80-150 ms per frame on a typical
// laptop, so the achieved rate is always slower than the number here. At the
// previous 120 ms the effective rate fell to 3-5 Hz and the ~100 ms fully-closed
// phase of a blink landed between samples. 50 ms lets the loop run as fast as
// inference allows instead of adding delay on top of it.
export const FACE_SAMPLE_INTERVAL_MS = 50;

export type HeadTurnDirection = 'left' | 'right';

export interface LivenessSignal {
    mouthAspectRatio: number;
    yawDegrees: number;
    detected: boolean;
}

let faceApiPromise: Promise<typeof import('modern-face-api')> | null = null;
let modelsLoadedPromise: Promise<void> | null = null;

async function getFaceApi() {
    if (!faceApiPromise) {
        faceApiPromise = import('modern-face-api');
    }
    return faceApiPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load face image for descriptor extraction.'));
        image.src = dataUrl;
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                resolve(result);
                return;
            }
            reject(new Error('Failed to convert face scan blob to data URL.'));
        };
        reader.onerror = () => reject(new Error('Failed to read face scan blob.'));
        reader.readAsDataURL(blob);
    });
}

export async function ensureModernFaceModelsLoaded(): Promise<void> {
    if (typeof window === 'undefined') {
        return;
    }

    if (!modelsLoadedPromise) {
        modelsLoadedPromise = (async () => {
            const faceapi = await getFaceApi();
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URI),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI),
            ]);
        })();
    }

    await modelsLoadedPromise;
}

export async function extractFaceDescriptorFromDataUrl(dataUrl: string): Promise<number[] | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    await ensureModernFaceModelsLoaded();
    const faceapi = await getFaceApi();
    const image = await loadImage(dataUrl);

    const detection = await faceapi
        .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

    if (!detection || !detection.descriptor) {
        return null;
    }

    const descriptor = Array.from(detection.descriptor);
    if (descriptor.length !== DESCRIPTOR_LENGTH) {
        return null;
    }

    return descriptor;
}

export async function extractFaceDescriptorFromBlob(blob: Blob): Promise<number[] | null> {
    const dataUrl = await blobToDataUrl(blob);
    return extractFaceDescriptorFromDataUrl(dataUrl);
}

type Point2D = { x: number; y: number };

function distance(a: Point2D, b: Point2D): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export function computeMouthAspectRatio(positions: Point2D[]): number {
    if (!positions || positions.length < 68) {
        return 0;
    }
    const innerLeftCorner = positions[60];
    const innerRightCorner = positions[64];
    const innerTop1 = positions[61];
    const innerTop2 = positions[62];
    const innerTop3 = positions[63];
    const innerBottom1 = positions[67];
    const innerBottom2 = positions[66];
    const innerBottom3 = positions[65];

    const horizontal = distance(innerLeftCorner, innerRightCorner);
    if (horizontal <= 0) {
        return 0;
    }
    const vertical =
        (distance(innerTop1, innerBottom1) +
            distance(innerTop2, innerBottom2) +
            distance(innerTop3, innerBottom3)) /
        3;

    return vertical / horizontal;
}

export function computeEyeAspectRatio(positions: Point2D[]): number {
    // Average eye-aspect-ratio across both eyes. Returns a high (open) value
    // when no usable face so a missing detection never reads as a blink.
    if (!positions || positions.length < 68) {
        return 0.3;
    }
    const eyeEar = (p1: number, p2: number, p3: number, p4: number, p5: number, p6: number): number => {
        const horizontal = distance(positions[p1], positions[p4]);
        if (horizontal <= 0) return 0.3;
        const vertical = distance(positions[p2], positions[p6]) + distance(positions[p3], positions[p5]);
        return vertical / (2 * horizontal);
    };
    // face-api 68-point indices: left eye 36–41, right eye 42–47.
    const left = eyeEar(36, 37, 38, 39, 40, 41);
    const right = eyeEar(42, 43, 44, 45, 46, 47);
    return (left + right) / 2;
}

export function estimateHeadYawDegrees(positions: Point2D[]): number {
    if (!positions || positions.length < 68) {
        return 0;
    }
    const rightEyeOuter = positions[36];
    const leftEyeOuter = positions[45];
    const noseTip = positions[30];

    // Measure the nose offset ALONG the eye line rather than along the raw X
    // axis. Both the eye vector and the nose offset rotate together when the
    // head tilts, so projecting one onto the other cancels roll out entirely —
    // the previous X-only version drifted badly whenever someone leaned their
    // head, which read as a turn they had not made.
    const eyeVecX = leftEyeOuter.x - rightEyeOuter.x;
    const eyeVecY = leftEyeOuter.y - rightEyeOuter.y;
    const interOcular = Math.sqrt(eyeVecX * eyeVecX + eyeVecY * eyeVecY);
    if (interOcular <= 0) {
        return 0;
    }

    const eyeMidX = (rightEyeOuter.x + leftEyeOuter.x) / 2;
    const eyeMidY = (rightEyeOuter.y + leftEyeOuter.y) / 2;
    const offsetAlongEyeLine =
        ((noseTip.x - eyeMidX) * eyeVecX + (noseTip.y - eyeMidY) * eyeVecY) / interOcular;

    const normalized = offsetAlongEyeLine / (interOcular / 2);
    const clamped = Math.max(-1, Math.min(1, normalized));
    return clamped * 45;
}

export async function extractFaceLandmarksFromDataUrl(
    dataUrl: string,
): Promise<Point2D[] | null> {
    if (typeof window === 'undefined') {
        return null;
    }
    await ensureModernFaceModelsLoaded();
    const faceapi = await getFaceApi();
    const image = await loadImage(dataUrl);

    const detection = await faceapi
        .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
        .withFaceLandmarks(true);

    if (!detection || !detection.landmarks) {
        return null;
    }

    const positions = detection.landmarks.positions as Point2D[];
    if (!positions || positions.length < 68) {
        return null;
    }
    return positions.map((p) => ({ x: p.x, y: p.y }));
}

export async function extractFaceLandmarksFromVideo(
    video: HTMLVideoElement,
): Promise<Point2D[] | null> {
    if (typeof window === 'undefined') {
        return null;
    }
    await ensureModernFaceModelsLoaded();
    const faceapi = await getFaceApi();

    const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
        .withFaceLandmarks(true);

    if (!detection || !detection.landmarks) {
        return null;
    }
    const positions = detection.landmarks.positions as Point2D[];
    if (!positions || positions.length < 68) {
        return null;
    }
    return positions.map((p) => ({ x: p.x, y: p.y }));
}

export interface BlinkDetector {
    /** Feed one sampled frame. Returns true on the frame the blink completes. */
    push(positions: Point2D[] | null, now?: number): boolean;
    /** True once a full open -> closed -> open cycle has been observed. */
    hasBlinked(): boolean;
    /** Lowest eye-aspect-ratio seen so far, for the liveness audit record. */
    minEyeAspectRatio(): number;
    reset(): void;
}

/**
 * Blink liveness as a small state machine.
 *
 * A plain "are the eyes closed?" threshold is not proof of life — a still photo
 * of someone mid-blink satisfies it. Requiring the eyes to be seen OPEN, then
 * CLOSED, then OPEN again within `BLINK_MAX_CLOSED_MS` requires actual motion
 * over time, which a static image cannot produce.
 *
 * Call `push` on every sampled frame; sample at roughly 10 Hz or faster, since
 * a real blink lasts only 100–400 ms and slower polling will miss it entirely.
 */
export function createBlinkDetector(): BlinkDetector {
    type Phase = 'awaiting_open' | 'eyes_open' | 'eyes_closed' | 'blinked';
    let phase: Phase = 'awaiting_open';
    let closedAt = 0;
    let minEar = 1;
    // The user's own open-eye EAR, learned live. Tracked as a damped running
    // maximum: blinks are brief, so the peak over a few seconds of looking at
    // the camera is a good estimate of "eyes open" for THIS face. Damping stops
    // one noisy landmark frame from inflating it permanently.
    let openBaseline = 0;

    return {
        push(positions, now = Date.now()) {
            if (!positions) {
                // Lost the face. Do not reset a completed blink, but drop any
                // half-finished one so a detection gap cannot be stitched
                // together into a blink that never happened.
                if (phase === 'eyes_closed') phase = 'awaiting_open';
                return false;
            }

            const ear = computeEyeAspectRatio(positions);
            if (ear < minEar) minEar = ear;
            if (ear > openBaseline) {
                openBaseline = openBaseline === 0 ? ear : openBaseline * 0.7 + ear * 0.3;
            }

            // Derive this user's cut-offs from their baseline, clamped by the
            // absolute ceilings so the thresholds can only ever adapt downward.
            // Someone whose open eyes read 0.26 gets a closed cut of ~0.19
            // instead of an unreachable fixed 0.21.
            const usable = openBaseline >= 0.15;
            const closedCut = usable
                ? Math.min(
                      EYE_CLOSED_EAR_THRESHOLD,
                      Math.max(EYE_CLOSED_EAR_FLOOR, openBaseline * BLINK_CLOSE_RATIO),
                  )
                : EYE_CLOSED_EAR_THRESHOLD;
            // Must stay above closedCut or the state machine can chatter between
            // open and closed on a single noisy frame.
            const openCut = usable
                ? Math.max(
                      closedCut + EYE_EAR_HYSTERESIS,
                      Math.min(EYE_OPEN_EAR_THRESHOLD, openBaseline * BLINK_OPEN_RATIO),
                  )
                : EYE_OPEN_EAR_THRESHOLD;

            switch (phase) {
                case 'awaiting_open':
                case 'eyes_open':
                    if (ear <= closedCut) {
                        // Only counts if we had already confirmed open eyes,
                        // otherwise someone starting with eyes shut is halfway
                        // through a blink they never made.
                        if (phase === 'eyes_open') {
                            phase = 'eyes_closed';
                            closedAt = now;
                        }
                    } else if (ear >= openCut) {
                        phase = 'eyes_open';
                    }
                    return false;

                case 'eyes_closed':
                    if (ear >= openCut) {
                        if (now - closedAt <= BLINK_MAX_CLOSED_MS) {
                            phase = 'blinked';
                            return true;
                        }
                        // Held shut too long to be a blink — start over.
                        phase = 'eyes_open';
                    }
                    return false;

                case 'blinked':
                default:
                    return false;
            }
        },
        hasBlinked: () => phase === 'blinked',
        minEyeAspectRatio: () => minEar,
        reset() {
            phase = 'awaiting_open';
            closedAt = 0;
            minEar = 1;
        },
    };
}

export function computeLivenessSignal(positions: Point2D[]): LivenessSignal {
    const mouthAspectRatio = computeMouthAspectRatio(positions);
    const yawDegrees = estimateHeadYawDegrees(positions);
    return { mouthAspectRatio, yawDegrees, detected: true };
}

export function averageFaceDescriptors(descriptors: number[][]): number[] | null {
    const valid = descriptors.filter((descriptor) => Array.isArray(descriptor) && descriptor.length === DESCRIPTOR_LENGTH);
    if (valid.length === 0) {
        return null;
    }

    const sum = new Array<number>(DESCRIPTOR_LENGTH).fill(0);
    for (const descriptor of valid) {
        for (let index = 0; index < DESCRIPTOR_LENGTH; index += 1) {
            sum[index] += descriptor[index];
        }
    }

    return sum.map((value) => value / valid.length);
}

export function compareFaceDescriptors(
    descriptor1: number[],
    descriptor2: number[],
): { distance: number; similarity: number; isMatch: boolean } {
    if (descriptor1.length !== descriptor2.length) {
        throw new Error('Descriptors have different lengths');
    }

    let sum = 0;
    for (let i = 0; i < descriptor1.length; i += 1) {
        const delta = descriptor1[i] - descriptor2[i];
        sum += delta * delta;
    }

    const distance = Math.sqrt(sum);
    const similarity = Math.max(0, Math.min(1, 1 - distance / FACE_DISTANCE_SIMILARITY_SCALE));
    const isMatch = similarity >= FACE_MATCH_SIMILARITY_THRESHOLD;

    return { distance, similarity, isMatch };
}

export async function verifyFaceAgainstStored(
    currentDescriptor: number[],
    storedDescriptors: number[][],
    threshold: number = FACE_MATCH_DISTANCE_THRESHOLD,
): Promise<{ isMatch: boolean; bestDistance: number; bestSimilarity: number }> {
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const storedDescriptor of storedDescriptors) {
        if (!Array.isArray(storedDescriptor) || storedDescriptor.length !== currentDescriptor.length) {
            continue;
        }

        const { distance } = compareFaceDescriptors(currentDescriptor, storedDescriptor);
        if (distance < bestDistance) {
            bestDistance = distance;
        }
    }

    if (!Number.isFinite(bestDistance)) {
        return { isMatch: false, bestDistance: Number.POSITIVE_INFINITY, bestSimilarity: 0 };
    }

    const bestSimilarity = Math.max(0, Math.min(1, 1 - bestDistance / FACE_DISTANCE_SIMILARITY_SCALE));
    const isMatch = bestDistance <= threshold;

    return { isMatch, bestDistance, bestSimilarity };
}
