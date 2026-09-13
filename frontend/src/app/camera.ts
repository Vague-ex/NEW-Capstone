/**
 * Opening the front camera in a way that survives phones.
 *
 * Desktop browsers forgive a lot that mobile ones do not:
 *
 *  - iOS Safari will not start playback on a <video> that is display:none, and
 *    `play()` returns a promise that rejects quietly. The capture screens hid
 *    the video until the camera was on, so on an iPhone the stream opened but
 *    the video never started -- which looks exactly like "the camera does not
 *    open". Callers must keep the element laid out (opacity-0, not `hidden`).
 *  - The camera only exists in a secure context. An http:// or LAN-IP link has
 *    no `navigator.mediaDevices` at all.
 *  - In-app browsers (Facebook, Messenger, Instagram...) commonly block
 *    getUserMedia outright. Graduates often open links from exactly there.
 *  - A phone can reject the facingMode constraint; plain `video: true` is the
 *    fallback that almost always succeeds.
 *
 * Every failure is mapped to a message that says what to do, and carries the
 * browser's own error name so a report from a real phone can be diagnosed.
 */

const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|MicroMessenger|TikTok|Snapchat/i;

export class CameraStartError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CameraStartError';
  }
}

function isInAppBrowser(): boolean {
  return typeof navigator !== 'undefined' && IN_APP_BROWSER.test(navigator.userAgent);
}

async function requestStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    // Some devices refuse the facingMode hint itself. Any camera beats none.
    if (name === 'OverconstrainedError' || name === 'NotFoundError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw err;
  }
}

/**
 * Open the front camera and start it playing in `video`. Resolves once the
 * stream is attached; throws CameraStartError with a user-facing message.
 */
export async function openFrontCamera(video: HTMLVideoElement | null): Promise<MediaStream> {
  if (typeof window === 'undefined') {
    throw new CameraStartError('The camera is not available here.', 'NoWindow');
  }
  if (!window.isSecureContext) {
    throw new CameraStartError(
      'The camera only works on a secure connection. Open the site through its https:// address, not an http:// or IP-address link.',
      'InsecureContext',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraStartError(
      isInAppBrowser()
        ? "This page is open inside another app's browser, which blocks the camera. Tap the menu (⋯) and choose \"Open in browser\", then try again."
        : "This browser can't open the camera. Please try Chrome or Safari.",
      'Unsupported',
    );
  }

  const stream = await requestStream();

  if (!video) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraStartError('The camera view was not ready. Please try again.', 'NoVideoElement');
  }

  // Set as properties as well as attributes: iOS reads these at play() time.
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // The stream is open; a refused play() here is an autoplay policy, and the
    // element's own autoPlay attribute starts it once it is on screen. Failing
    // the whole capture over it would be worse than a moment's delay.
  }
  return stream;
}

/** A user-facing message for anything openFrontCamera (or getUserMedia) threw. */
export function describeCameraError(err: unknown): string {
  if (err instanceof CameraStartError) return err.message;

  const name = (err as { name?: string })?.name ?? 'Error';
  const tag = ` (${name})`;

  if (isInAppBrowser()) {
    return (
      "This page is open inside another app's browser, which blocks the camera. Tap the menu (⋯) and choose \"Open in browser\", then try again." +
      tag
    );
  }
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return (
        'Camera permission is blocked. Allow camera access for this site in your browser settings (usually the icon beside the address bar), then try again.' +
        tag
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.' + tag;
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is being used by another app. Close any app or tab using the camera and try again.' + tag;
    default:
      return "Couldn't start the camera. Please try again." + tag;
  }
}
