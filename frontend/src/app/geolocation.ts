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
