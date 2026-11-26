/**
 * Re-capture the signed-in graduate's face.
 *
 * Until this existed the only way to replace a template was for login to hand
 * out a 409 + token, which happens only once the stored face is already
 * unusable. A graduate who knows their face has changed -- new glasses, a few
 * years older -- had no way to act before being locked out, and the admin's
 * only remedy was `manage.py reset_face_enrolment` on the server.
 *
 * Two stages, both borrowed from flows the system already runs:
 *
 *  1. Liveness, the login challenge: blink, falling back to a head turn in a
 *     randomised direction. Re-enrolment is authorised by the password alone,
 *     so without this a stolen password would be enough to enrol a photograph.
 *  2. The enrolment sweep, as on the face debug page: one frame per target
 *     angle, so a later login at a slightly different angle has several
 *     references to match against rather than one frontal vector.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, AlertCircle, X, Loader2 } from 'lucide-react';

import { updateAlumniFace, type AlumniFaceCapture } from '../../app/api-client';
import { captureGps } from '../../app/geolocation';
import { describeCameraError, openFrontCamera } from '../../app/camera';
import { clearFaceMesh, drawFaceMesh } from '../../app/face-mesh';
import {
  ensureModernFaceModelsLoaded,
  extractFaceDescriptorFromDataUrl,
  extractFaceLandmarksFromVideo,
  estimateHeadYawDegrees,
  createBlinkDetector,
  HEAD_TURN_YAW_THRESHOLD_DEG,
  FACE_SAMPLE_INTERVAL_MS,
} from '../../app/modern-face-descriptor';

// Same angles and tolerance the face debug page enrols with. The range stops
// near +/-24 deg because face-api's tinyFaceDetector loses the face past that.
const SWEEP_TARGETS = [-24, -12, 0, 12, 24];
const SWEEP_TOLERANCE_DEG = 7;

const BLINK_WINDOW_MS = 5000;
const TURN_TIMEOUT_MS = 12000;
const SWEEP_TIMEOUT_MS = 45000;

type TurnChallenge = 'head_turn_left' | 'head_turn_right';
type Challenge = 'blink' | TurnChallenge;
type Stage = 'starting' | 'liveness' | 'sweep' | 'saving' | 'done';

function pickRandomTurn(): TurnChallenge {
  return Math.random() < 0.5 ? 'head_turn_left' : 'head_turn_right';
}

function describeChallenge(challenge: Challenge): string {
  if (challenge === 'blink') return 'Blink once while looking at the camera';
  if (challenge === 'head_turn_left') return 'Turn your head slightly to your left';
  return 'Turn your head slightly to your right';
}

/** Whole frame, not the login oval: a head at 24 deg drifts out of a centred crop. */
function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export function AlumniFaceUpdateModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (alumni: Record<string, unknown>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const meshRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stage, setStage] = useState<Stage>('starting');
  const [challenge, setChallenge] = useState<Challenge>('blink');
  const [error, setError] = useState('');
  const [faceSeen, setFaceSeen] = useState(false);
  // One slot per target angle; filled once, then left alone so holding still
  // at 0 deg cannot crowd out the angles that carry the information.
  const [slots, setSlots] = useState<(AlumniFaceCapture | null)[]>(
    SWEEP_TARGETS.map(() => null),
  );
  const slotsRef = useRef<(AlumniFaceCapture | null)[]>(SWEEP_TARGETS.map(() => null));
  const turnRef = useRef<TurnChallenge>(pickRandomTurn());

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (meshRef.current) clearFaceMesh(meshRef.current);
  }, []);

  // Camera + models. Both are slow enough on a phone to be worth starting
  // together rather than one after the other.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stream] = await Promise.all([
          openFrontCamera(videoRef.current),
          ensureModernFaceModelsLoaded(),
        ]);
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        setStage('liveness');
      } catch (err) {
        if (!cancelled) setError(describeCameraError(err));
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  // Liveness. Blink first; if none is confirmed in its window, move on to a
  // head turn, which is held rather than momentary and so survives the few
  // frames per second face-api manages on a phone.
  useEffect(() => {
    if (stage !== 'liveness') return;
    let stopped = false;
    let next: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      stopped = true;
      if (next) clearTimeout(next);
    };

    const timeout = setTimeout(() => {
      stop();
      if (challenge === 'blink') {
        setChallenge(turnRef.current);
        return;
      }
      setError('Liveness check timed out. Close this and try again in better light.');
    }, challenge === 'blink' ? BLINK_WINDOW_MS : TURN_TIMEOUT_MS);

    const blink = challenge === 'blink' ? createBlinkDetector() : null;

    const sample = async () => {
      if (stopped) return;
      const video = videoRef.current;
      try {
        if (video && video.videoWidth > 0) {
          const landmarks = await extractFaceLandmarksFromVideo(video);
          if (stopped) return;
          if (meshRef.current) drawFaceMesh(meshRef.current, video, landmarks, { alpha: 0.5 });
          setFaceSeen(!!landmarks);

          // A blink is a transition, so the detector must see every frame --
          // including the faceless ones, which reset a half-finished blink.
          let passed = blink ? blink.push(landmarks) : false;
          if (landmarks && challenge !== 'blink') {
            const yaw = estimateHeadYawDegrees(landmarks);
            passed = challenge === 'head_turn_left'
              ? yaw >= HEAD_TURN_YAW_THRESHOLD_DEG
              : yaw <= -HEAD_TURN_YAW_THRESHOLD_DEG;
          }
          if (passed) {
            stop();
            clearTimeout(timeout);
            setStage('sweep');
            return;
          }
        }
      } catch { /* keep polling */ }
      if (!stopped) next = setTimeout(sample, FACE_SAMPLE_INTERVAL_MS);
    };
    void sample();

    return () => {
      stop();
      clearTimeout(timeout);
    };
  }, [stage, challenge]);

  // The sweep: fill one slot per target angle, then submit.
  useEffect(() => {
    if (stage !== 'sweep') return;
    let stopped = false;
    let next: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      stopped = true;
      if (next) clearTimeout(next);
    };

    const timeout = setTimeout(() => {
      stop();
      setError('Could not capture every angle. Close this and try again in better light.');
    }, SWEEP_TIMEOUT_MS);

    const submit = async () => {
      setStage('saving');
      const captures = slotsRef.current.filter((s): s is AlumniFaceCapture => s !== null);
      try {
        const gps = await captureGps();
        const result = await updateAlumniFace(
          captures,
          gps ? { gpsLat: gps.lat, gpsLng: gps.lng, gpsAccuracyM: gps.acc } : undefined,
        );
        stopCamera();
        setStage('done');
        onSaved(result.alumni);
      } catch (err) {
        stopCamera();
        setError(err instanceof Error ? err.message : 'Could not save the new face scan.');
      }
    };

    const sample = async () => {
      if (stopped) return;
      const video = videoRef.current;
      try {
        if (video && video.videoWidth > 0) {
          const landmarks = await extractFaceLandmarksFromVideo(video);
          if (stopped) return;
          if (meshRef.current) drawFaceMesh(meshRef.current, video, landmarks, { alpha: 0.5 });
          setFaceSeen(!!landmarks);

          if (landmarks) {
            const yaw = estimateHeadYawDegrees(landmarks);
            const slot = SWEEP_TARGETS.findIndex(
              (target, i) =>
                slotsRef.current[i] === null && Math.abs(yaw - target) <= SWEEP_TOLERANCE_DEG,
            );
            if (slot >= 0) {
              const dataUrl = captureFrame(video);
              const descriptor = await extractFaceDescriptorFromDataUrl(dataUrl);
              if (stopped) return;
              if (descriptor) {
                slotsRef.current[slot] = { blob: await dataUrlToBlob(dataUrl), descriptor, yaw };
                setSlots([...slotsRef.current]);
                if (slotsRef.current.every(s => s !== null)) {
                  stop();
                  clearTimeout(timeout);
                  void submit();
                  return;
                }
              }
            }
          }
        }
      } catch { /* keep polling */ }
      if (!stopped) next = setTimeout(sample, FACE_SAMPLE_INTERVAL_MS);
    };
    void sample();

    return () => {
      stop();
      clearTimeout(timeout);
    };
  // onSaved and stopCamera are stable for this modal's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const filled = slots.filter(Boolean).length;
  const nextTarget = SWEEP_TARGETS[slots.findIndex(s => s === null)];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera className="size-4 text-emerald-600" />
            <h3 className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>Update face scan</h3>
          </div>
          <button onClick={() => { stopCamera(); onClose(); }} aria-label="Close"
            className="text-gray-400 hover:text-gray-600 rounded-lg p-1">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {stage === 'done' ? (
            <div className="text-center py-6">
              <CheckCircle2 className="size-10 text-emerald-500 mx-auto" />
              <p className="text-gray-800 mt-3" style={{ fontWeight: 600 }}>Face scan updated</p>
              <p className="text-gray-500 text-xs mt-1">Your next sign-in will match against the new scan.</p>
              <button onClick={onClose}
                className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-xl">
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3]">
                {/* Kept laid out rather than hidden: iOS Safari will not start
                    playback on a display:none video. */}
                <video ref={videoRef} playsInline muted
                  className="absolute inset-0 size-full object-cover scale-x-[-1]" />
                <canvas ref={meshRef}
                  className="absolute inset-0 size-full object-cover scale-x-[-1] pointer-events-none" />
              </div>

              {error ? (
                <p className="flex items-start gap-2 text-rose-600 text-xs">
                  <AlertCircle className="size-4 shrink-0" /> {error}
                </p>
              ) : stage === 'starting' ? (
                <p className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Starting the camera…
                </p>
              ) : stage === 'saving' ? (
                <p className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Saving your new face scan…
                </p>
              ) : stage === 'liveness' ? (
                <div>
                  <p className="text-gray-800 text-sm" style={{ fontWeight: 600 }}>
                    Step 1 of 2 · {describeChallenge(challenge)}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {faceSeen ? 'Face detected.' : 'Looking for your face…'}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-gray-800 text-sm" style={{ fontWeight: 600 }}>
                    Step 2 of 2 · {nextTarget === 0
                      ? 'Look straight at the camera'
                      : `Turn your head slightly to your ${nextTarget > 0 ? 'left' : 'right'}`}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    {slots.map((slot, i) => (
                      <span key={SWEEP_TARGETS[i]}
                        className={`h-1.5 flex-1 rounded-full ${slot ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                    ))}
                  </div>
                  <p className="text-gray-400 text-xs mt-1.5">{filled} of {SWEEP_TARGETS.length} angles captured</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
