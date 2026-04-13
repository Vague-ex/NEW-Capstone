const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

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

async function parseError(response: Response): Promise<{ message: string; payload?: unknown }> {
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
    if (response.ok) {
        return;
    }

    const { message, payload } = await parseError(response);
    throw new ApiClientError(message, response.status, payload);
}

export async function adminLogin(email: string, password: string): Promise<AdminLoginResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/admin/login/`, {
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
    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/register/`, {
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
): Promise<AlumniAuthResponse> {
    const payload = new FormData();
    payload.append('email', email);
    payload.append('password', password);
    payload.append('face_scan', faceScan, `face_scan_${Date.now()}.jpg`);

    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/login/`, {
        method: 'POST',
        body: payload,
    });

    await throwIfNotOk(response);

    return response.json();
}

export async function fetchAlumniAccountStatus(alumniId: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/account/${encodeURIComponent(alumniId)}/`, {
        method: 'GET',
    });

    await throwIfNotOk(response);

    const data: AlumniStatusResponse = await response.json();
    return data.alumni ?? {};
}

export async function fetchPendingAlumni(): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(`${API_BASE_URL}/api/admin/alumni/pending/`, {
        method: 'GET',
    });

    await throwIfNotOk(response);

    const data: PendingAlumniResponse = await response.json();
    if (!Array.isArray(data.results)) {
        return [];
    }

    return data.results;
}

export async function fetchVerifiedAlumni(): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(`${API_BASE_URL}/api/admin/alumni/verified/`, {
        method: 'GET',
    });

    await throwIfNotOk(response);

    const data: PendingAlumniResponse = await response.json();
    if (!Array.isArray(data.results)) {
        return [];
    }

    return data.results;
}

export async function reviewAlumniRequest(
    alumniId: string,
    action: 'approve' | 'reject',
): Promise<AlumniReviewResponse> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/alumni/requests/${encodeURIComponent(alumniId)}/${action}/`,
        {
            method: 'POST',
        },
    );

    await throwIfNotOk(response);

    return response.json();
}

export async function registerEmployer(payload: EmployerRegisterPayload): Promise<EmployerAuthResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/employer/register/`, {
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
    const response = await fetch(`${API_BASE_URL}/api/auth/employer/login/`, {
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
    const response = await fetch(`${API_BASE_URL}/api/admin/employers/requests/`, {
        method: 'GET',
    });

    await throwIfNotOk(response);

    const data: EmployerRequestsResponse = await response.json();
    if (!Array.isArray(data.results)) {
        return [];
    }

    return data.results;
}

export async function reviewEmployerRequest(
    employerId: string,
    action: 'approve' | 'reject',
): Promise<EmployerAuthResponse> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/employers/requests/${encodeURIComponent(employerId)}/${action}/`,
        {
            method: 'POST',
        },
    );

    await throwIfNotOk(response);

    return response.json();
}
