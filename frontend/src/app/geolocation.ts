/**
 * Best-effort GPS capture for the identity audit trail.
 *
 * PRD Module A requires every identity capture — registration and login alike —
 * to be stamped with date, time and GPS coordinates for administrative
 * auditing. Registration previously captured no GPS at all: the backend read
 * `gps_lat` / `gps_lng` from the request, but the registration form never sent
 * them, so `capture_meta` GPS was null for every graduate on record.
 *
 * Always resolves — never rejects. A denied permission, an unavailable sensor
 * or a timeout all yield null, because a missing coordinate must never block
 * someone from registering or signing in.
 */

export interface GpsFix {
    lat: number;
    lng: number;
    /** Accuracy radius in metres, as reported by the device. */
    acc: number;
}

export async function captureGps(timeoutMs = 4000): Promise<GpsFix | null> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
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

export type GpsFailure = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

/**
 * A precise, fresh fix for pinning a home location, reporting WHY it failed.
 *
 * Unlike captureGps (an audit stamp that must never block anything), this backs
 * a button the graduate pressed, so a failure has to tell them what to do.
 * High accuracy and no cached position: a pin from a stale network-based fix can
 * land a barangay away.
 *
 * The browser's own `timeout` excludes the time the permission prompt is open;
 * the outer guard does not, so it is deliberately generous.
 */
export async function locateDevice(
    timeoutMs = 20000,
): Promise<{ fix: GpsFix | null; failure: GpsFailure | null }> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return { fix: null, failure: 'unsupported' };
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
        return { fix: null, failure: 'insecure' };
    }
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: { fix: GpsFix | null; failure: GpsFailure | null }) => {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            resolve(result);
        };
        const guard = setTimeout(() => finish({ fix: null, failure: 'timeout' }), timeoutMs + 60000);
        navigator.geolocation.getCurrentPosition(
            (p) => finish({
                fix: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy },
                failure: null,
            }),
            (err) => finish({
                fix: null,
                failure: err.code === err.PERMISSION_DENIED
                    ? 'denied'
                    : err.code === err.TIMEOUT
                        ? 'timeout'
                        : 'unavailable',
            }),
            { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
        );
    });
}

/**
 * A PSGC city name in the form OpenStreetMap's geocoder recognises.
 *
 * PSGC lists chartered cities as "City of Bacolod". Nominatim does not know that
 * form and matches something unrelated (it returned a university in Sagay), so a
 * city-level pin landed in the wrong town. "Bacolod City" resolves correctly.
 */
export function geocoderCityName(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    const match = /^city of\s+(.+)$/i.exec(trimmed);
    return match ? `${match[1]} City` : trimmed;
}

export function describeGpsFailure(failure: GpsFailure | null): string {
    switch (failure) {
        case 'denied':
            return 'Location permission is blocked. Allow location for this site in your browser settings, or fill in your address below.';
        case 'insecure':
            return 'Location only works on the secure https:// address of this site. Please fill in your address below.';
        case 'timeout':
            return 'Your location took too long to find. Move near a window and try again, or fill in your address below.';
        case 'unsupported':
            return "This browser can't share your location. Please fill in your address below.";
        default:
            return "Your location couldn't be found. Turn on your device's location services and try again, or fill in your address below.";
    }
}
