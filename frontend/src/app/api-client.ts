const API_BASE_URL = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/$/, '');

export class ApiClientError extends Error {
    status: number;
    payload?: unknown;

    constructor(message: string, status: number, payload?: unknown) {
        super(message);
        this.name = 'ApiClientError';
        this.status = status;
        this.payload = payload;
    }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface AdminUser {
    id: string;
    email: string;
    role: 'admin';
}

export interface AlumniSession {
    id: string;
    schoolId: string;
    studentId: string;
    studentNumber: string;
    name: string;
    email: string;
    graduationYear: number;
    verificationStatus: 'verified' | 'pending';
    employmentStatus: string;
    dateUpdated: string;
    biometricCaptured: boolean;
    biometricDate: string | null;
    facePhotoUrl: string;
    accountStatus: string;
}

export interface AdminLoginResponse {
    message: string;
    user: AdminUser;
}

export interface AlumniAuthResponse {
    message: string;
    alumni: AlumniSession;
    user?: Record<string, unknown>;
    faceScanUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseError(
    response: Response,
): Promise<{ message: string; payload?: unknown }> {
    try {
        const data = await response.json();
        if (typeof data?.detail === 'string') return { message: data.detail, payload: data };
        if (typeof data?.message === 'string') return { message: data.message, payload: data };
        return { message: `Request failed with status ${response.status}`, payload: data };
    } catch {
        return { message: `Request failed with status ${response.status}` };
    }
}

async function throwIfNotOk(response: Response): Promise<void> {
    if (response.ok) return;
    const { message, payload } = await parseError(response);
    throw new ApiClientError(message, response.status, payload);
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export async function adminLogin(
    email: string,
    password: string,
): Promise<AdminLoginResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/admin/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    await throwIfNotOk(response);
    return response.json();
}

/**
 * Register a new alumni account.
 *
 * The payload FormData must include:
 *   - email, password, confirm_password
 *   - first_name, middle_name, family_name
 *   - graduation_date, employment_status
 *   - capture_time, gps_lat, gps_lng
 *   - survey_data (JSON string of the full form)
 *   - face_descriptor (JSON string of Float32Array[128] — the face-api.js descriptor)
 *   - face_front, face_left, face_right (Blob files)
 */
export async function registerAlumni(
    payload: FormData,
): Promise<AlumniAuthResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/register/`, {
        method: 'POST',
        body: payload,
    });
    await throwIfNotOk(response);
    return response.json();
}

/**
 * Login as alumni.
 * Sends email, password, the login face scan blob, and optionally the
 * similarity score computed client-side by face-api.js.
 */
export async function alumniLogin(
    email: string,
    password: string,
    faceScan: Blob,
    similarityScore?: number,
): Promise<AlumniAuthResponse> {
    const payload = new FormData();
    payload.append('email', email);
    payload.append('password', password);
    payload.append('face_scan', faceScan, `face_scan_${Date.now()}.jpg`);
    if (similarityScore !== undefined) {
        payload.append('similarity_score', String(similarityScore));
    }

    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/login/`, {
        method: 'POST',
        body: payload,
    });
    await throwIfNotOk(response);
    return response.json();
}