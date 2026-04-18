const runtimeDefaultApiBase = (() => {
    if (typeof window === 'undefined') {
        return 'http://localhost:8000';
    }

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname || 'localhost';
    return `${protocol}//${host}:8000`;
})();

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || runtimeDefaultApiBase).replace(/\/$/, '');

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

interface AdminLoginResponse {
    message: string;
    user: {
        id: string;
        email: string;
        role: 'admin';
    };
}

interface AlumniAuthResponse {
    message: string;
    alumni: Record<string, unknown>;
    user?: Record<string, unknown>;
    faceScanUrl?: string;
}

interface AlumniStatusResponse {
    alumni?: Record<string, unknown>;
}

interface PendingAlumniResponse {
    count?: number;
    results?: Array<Record<string, unknown>>;
}

interface AlumniReviewResponse {
    message: string;
    alumni?: Record<string, unknown>;
}

interface AlumniEmploymentUpdatePayload {
    employment_status?: string;
    survey_data?: Record<string, unknown>;
}

interface AlumniEmploymentUpdateResponse {
    message: string;
    alumni?: Record<string, unknown>;
}

interface EmployerRegisterPayload {
    company_name: string;
    industry: string;
    website?: string;
    contact_name: string;
    position?: string;
    credential_email: string;
    phone?: string;
    password: string;
    confirm_password: string;
}

interface EmployerAuthResponse {
    message: string;
    employer?: Record<string, unknown>;
    user?: Record<string, unknown>;
}

interface EmployerRequestsResponse {
    count?: number;
    results?: Array<Record<string, unknown>>;
}

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const ADMIN_CACHE_KEYS = {
    pendingAlumni: 'admin_cache_pending_alumni',
    verifiedAlumni: 'admin_cache_verified_alumni',
    employerRequests: 'admin_cache_employer_requests',
} as const;

type AdminCacheKey = (typeof ADMIN_CACHE_KEYS)[keyof typeof ADMIN_CACHE_KEYS];

const cachedAdminCollections: Partial<Record<AdminCacheKey, Array<Record<string, unknown>>>> = {};

function isRetryableStatus(statusCode: number): boolean {
    return RETRYABLE_STATUS_CODES.has(statusCode);
}

function isTransientNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (!(error instanceof Error)) return false;
    return /network|fetch|timeout|failed/i.test(error.message);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        globalThis.setTimeout(resolve, ms);
    });
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const maxAttempts = method === 'GET' ? 3 : 1;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetch(input, init);
            if (response.ok) {
                return response;
            }

            if (method === 'GET' && attempt < maxAttempts && isRetryableStatus(response.status)) {
                await delay(250 * attempt);
                continue;
            }

            await throwIfNotOk(response);
        } catch (error) {
            lastError = error;
            if (method === 'GET' && attempt < maxAttempts && isTransientNetworkError(error)) {
                await delay(250 * attempt);
                continue;
            }
            throw error;
        }
    }

    if (lastError instanceof Error) {
        throw lastError;
    }

    throw new Error('Request failed.');
}

function readCachedCollection(cacheKey: AdminCacheKey): Array<Record<string, unknown>> | null {
    const inMemory = cachedAdminCollections[cacheKey];
    if (Array.isArray(inMemory)) {
        return inMemory;
    }

    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return null;
        }

        const records = parsed.filter((entry): entry is Record<string, unknown> => (
            typeof entry === 'object' && entry !== null
        ));

        cachedAdminCollections[cacheKey] = records;
        return records;
    } catch {
        return null;
    }
}

function writeCachedCollection(cacheKey: AdminCacheKey, records: Array<Record<string, unknown>>): void {
    cachedAdminCollections[cacheKey] = records;

    if (typeof window === 'undefined') {
        return;
    }

    try {
        sessionStorage.setItem(cacheKey, JSON.stringify(records));
    } catch {
        // Ignore storage failures so API reads remain non-blocking.
    }
}

function normalizeCollectionResults(
    results: unknown,
): Array<Record<string, unknown>> {
    if (!Array.isArray(results)) {
        return [];
    }

    return results.filter((entry): entry is Record<string, unknown> => (
        typeof entry === 'object' && entry !== null
    ));
}

async function parseError(response: Response): Promise<{ message: string; payload?: unknown }> {
    try {
        const data = await response.json();
        if (typeof data?.detail === 'string') {
            let message = data.detail;
            if (typeof data?.descriptorDistance === 'number') {
                message = `${message} (descriptor distance: ${data.descriptorDistance.toFixed(3)})`;
            } else if (typeof data?.similarityScore === 'number') {
                message = `${message} (similarity: ${data.similarityScore.toFixed(3)})`;
            }
            return { message, payload: data };
        }
        if (typeof data?.message === 'string') return { message: data.message, payload: data };
        return { message: `Request failed with status ${response.status}`, payload: data };
    } catch {
        return { message: `Request failed with status ${response.status}` };
    }
}

async function throwIfNotOk(response: Response): Promise<void> {
    if (response.ok) {
        return;
    }

    const { message, payload } = await parseError(response);
    throw new ApiClientError(message, response.status, payload);
}

export async function adminLogin(email: string, password: string): Promise<AdminLoginResponse> {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/auth/admin/login/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
    });

    await throwIfNotOk(response);

    return response.json();
}

export async function registerAlumni(payload: FormData): Promise<AlumniAuthResponse> {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/auth/alumni/register/`, {
        method: 'POST',
        body: payload,
    });

    await throwIfNotOk(response);

    return response.json();
}

export async function alumniLogin(
    email: string,
    password: string,
    faceScan: Blob,
    faceDescriptor?: number[],
): Promise<AlumniAuthResponse> {
    const payload = new FormData();
    payload.append('email', email);
    payload.append('password', password);
    payload.append('face_scan', faceScan, `face_scan_${Date.now()}.jpg`);
    if (Array.isArray(faceDescriptor) && faceDescriptor.length > 0) {
        payload.append('face_descriptor', JSON.stringify(faceDescriptor));
    }

    const response = await fetchWithRetry(`${API_BASE_URL}/api/auth/alumni/login/`, {
        method: 'POST',
        body: payload,
    });

    await throwIfNotOk(response);

    return response.json();
}

export async function fetchAlumniAccountStatus(alumniId: string): Promise<Record<string, unknown>> {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/auth/alumni/account/${encodeURIComponent(alumniId)}/`, {
        method: 'GET',
    });

    await throwIfNotOk(response);

    const data: AlumniStatusResponse = await response.json();
    return data.alumni ?? {};
}

export async function updateAlumniEmployment(
    alumniId: string,
    payload: AlumniEmploymentUpdatePayload,
): Promise<AlumniEmploymentUpdateResponse> {
    const response = await fetchWithRetry(
        `${API_BASE_URL}/api/auth/alumni/account/${encodeURIComponent(alumniId)}/employment/`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        },
    );

    await throwIfNotOk(response);

    return response.json();
}

export async function fetchPendingAlumni(): Promise<Array<Record<string, unknown>>> {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/api/admin/alumni/pending/`, {
            method: 'GET',
        });

        const data: PendingAlumniResponse = await response.json();
        const records = normalizeCollectionResults(data.results);
        writeCachedCollection(ADMIN_CACHE_KEYS.pendingAlumni, records);
        return records;
    } catch (error) {
        const cached = readCachedCollection(ADMIN_CACHE_KEYS.pendingAlumni);
        if (cached !== null) {
            return cached;
        }
        throw error;
    }
}

export async function fetchVerifiedAlumni(): Promise<Array<Record<string, unknown>>> {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/api/admin/alumni/verified/`, {
            method: 'GET',
        });

        const data: PendingAlumniResponse = await response.json();
        const records = normalizeCollectionResults(data.results);
        writeCachedCollection(ADMIN_CACHE_KEYS.verifiedAlumni, records);
        return records;
    } catch (error) {
        const cached = readCachedCollection(ADMIN_CACHE_KEYS.verifiedAlumni);
        if (cached !== null) {
            return cached;
        }
        throw error;
    }
}

export async function reviewAlumniRequest(
    alumniId: string,
    action: 'approve' | 'reject',
): Promise<AlumniReviewResponse> {
    const response = await fetchWithRetry(
        `${API_BASE_URL}/api/admin/alumni/requests/${encodeURIComponent(alumniId)}/${action}/`,
        {
            method: 'POST',
        },
    );

    await throwIfNotOk(response);

    return response.json();
}

export async function registerEmployer(payload: EmployerRegisterPayload): Promise<EmployerAuthResponse> {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/auth/employer/register/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    await throwIfNotOk(response);

    return response.json();
}

export async function employerLogin(credentialEmail: string, password: string): Promise<EmployerAuthResponse> {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/auth/employer/login/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credential_email: credentialEmail, password }),
    });

    await throwIfNotOk(response);

    return response.json();
}

export async function fetchEmployerRequests(): Promise<Array<Record<string, unknown>>> {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/api/admin/employers/requests/`, {
            method: 'GET',
        });

        const data: EmployerRequestsResponse = await response.json();
        const records = normalizeCollectionResults(data.results);
        writeCachedCollection(ADMIN_CACHE_KEYS.employerRequests, records);
        return records;
    } catch (error) {
        const cached = readCachedCollection(ADMIN_CACHE_KEYS.employerRequests);
        if (cached !== null) {
            return cached;
        }
        throw error;
    }
}

export async function reviewEmployerRequest(
    employerId: string,
    action: 'approve' | 'reject',
): Promise<EmployerAuthResponse> {
    const response = await fetchWithRetry(
        `${API_BASE_URL}/api/admin/employers/requests/${encodeURIComponent(employerId)}/${action}/`,
        {
            method: 'POST',
        },
    );

    await throwIfNotOk(response);

    return response.json();
}
