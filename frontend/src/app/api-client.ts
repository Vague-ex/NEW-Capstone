export const API_BASE_URL = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/$/, '');

export const ADMIN_ACCESS_TOKEN_KEY = 'admin_access_token';
export const EMPLOYER_ACCESS_TOKEN_KEY = 'employer_access_token';

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
    accessToken?: string;
    tokenType?: 'Bearer';
    expiresIn?: number;
}

export interface AlumniAuthResponse {
    message: string;
    alumni: AlumniSession;
    user?: Record<string, unknown>;
    faceScanUrl?: string;
}

export interface VerificationTokenResponse {
    id?: string;
    status?: string;
    expiresAt?: string;
    usedAt?: string | null;
    alumniId?: string;
    employmentRecordId?: string | null;
    createdAt?: string;
}

export interface VerificationDecisionResponse {
    id?: string;
    decision?: string;
    comment?: string;
    verifiedEmployerName?: string;
    verifiedJobTitleId?: string | null;
    verifiedJobTitleName?: string | null;
    decidedAt?: string;
    employerId?: string;
    isHeld?: boolean;
    heldActivatedAt?: string | null;
}

export interface EmployerAccountResponse {
    id?: string;
    company?: string;
    companyName?: string;
    industry?: string;
    contact?: string;
    contactName?: string;
    position?: string;
    email?: string;
    credentialEmail?: string;
    phone?: string;
    website?: string;
    status?: string;
    accountStatus?: string;
    date?: string;
}

export interface EmployerVerifiableGraduateResponse {
    id?: string;
    employmentRecordId?: string;
    name?: string;
    email?: string;
    graduationYear?: number | null;
    verificationStatus?: string;
    employmentStatus?: string;
    jobTitle?: string;
    jobTitleId?: string | null;
    company?: string;
    industry?: string;
    workLocation?: string;
    regionId?: string | null;
    jobAlignment?: string;
    dateUpdated?: string;
    skills?: string[];
    biometricCaptured?: boolean;
    biometricDate?: string | null;
    lat?: number;
    lng?: number;
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

function readAdminAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(ADMIN_ACCESS_TOKEN_KEY);
}

function readEmployerAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(EMPLOYER_ACCESS_TOKEN_KEY);
}

function withAdminAuthHeaders(
    headers: Record<string, string> = {},
): Record<string, string> {
    const token = readAdminAccessToken();
    if (!token) return headers;
    return {
        ...headers,
        Authorization: `Bearer ${token}`,
    };
}

function withEmployerAuthHeaders(
    headers: Record<string, string> = {},
): Record<string, string> {
    const token = readEmployerAccessToken();
    if (!token) return headers;
    return {
        ...headers,
        Authorization: `Bearer ${token}`,
    };
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

export async function registerAlumni(
    payload: FormData,
): Promise<AlumniAuthResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/register/`, {
        method: 'POST',
        body: payload,
    });
    await throwIfNotOk(response);
    return response.json();
}   // Passing FormData but not setting the Content-Type header. When you send FormData, 
    // the browser automatically sets multipart/form-data, but your backend expects application/json

export async function alumniLogin(
    email: string,
    password: string,
    faceScan: Blob,
    faceDescriptor?: number[],
    similarityScore?: number,
): Promise<AlumniAuthResponse> {
    const payload = new FormData();
    payload.append('email', email);
    payload.append('password', password);
    payload.append('face_scan', faceScan, `face_scan_${Date.now()}.jpg`);
    if (faceDescriptor && faceDescriptor.length > 0) {
        payload.append('face_descriptor', JSON.stringify(faceDescriptor));
    }
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

export async function employerLogin(
    email: string,
    password: string,
): Promise<{ employer?: EmployerAccountResponse; accessToken?: string; tokenType?: 'Bearer'; expiresIn?: number }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/employer/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    await throwIfNotOk(response);
    return response.json();
}

export async function registerEmployer(
    payload: Record<string, string>,
): Promise<{ employer?: EmployerAccountResponse; accessToken?: string; tokenType?: 'Bearer'; expiresIn?: number }> {
    const response = await fetch(`${API_BASE_URL}/api/auth/employer/register/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    await throwIfNotOk(response);
    return response.json();
}

// ---------------------------------------------------------------------------
// Alumni endpoints
// ---------------------------------------------------------------------------

export async function fetchAlumniAccountStatus(alumniId: string): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/account/${alumniId}/`);
    await throwIfNotOk(response);
    const data = await response.json();
    return data?.alumni ?? data;
}

export async function fetchEmployerAccountStatus(
    employerId: string,
): Promise<EmployerAccountResponse> {
    const response = await fetch(`${API_BASE_URL}/api/auth/employer/account/${employerId}/`, {
        headers: withEmployerAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return (data?.employer ?? data ?? {}) as EmployerAccountResponse;
}

export async function updateAlumniEmployment(
    alumniId: string,
    payload: {
        employment_status?: string;
        survey_data?: unknown;
        job_title_id?: string;
        region_id?: string;
        skill_entries?: Array<{ skillId?: string; name?: string; proficiency?: string }>;
    },
): Promise<{ alumni?: unknown }> {
    const response = await fetch(
        `${API_BASE_URL}/api/auth/alumni/account/${alumniId}/employment/`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return { alumni: data?.alumni ?? data };
}

// ---------------------------------------------------------------------------
// Employer verification endpoints (DS7)
// ---------------------------------------------------------------------------

export async function issueVerificationToken(
    payload: { alumni_id?: string; employment_record_id?: string; expires_in_days?: number },
): Promise<{ message?: string; token?: VerificationTokenResponse; employmentRecord?: unknown }> {
    const response = await fetch(`${API_BASE_URL}/api/verification/tokens/issue/`, {
        method: 'POST',
        headers: withEmployerAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return {
        message: typeof data?.message === 'string' ? data.message : undefined,
        token: data?.token,
        employmentRecord: data?.employmentRecord,
    };
}

export async function fetchVerificationToken(tokenId: string): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}/api/verification/tokens/${tokenId}/`);
    await throwIfNotOk(response);
    return response.json();
}

export async function submitVerificationDecision(
    tokenId: string,
    payload: {
        decision: 'confirm' | 'deny';
        comment?: string;
        verified_employer_name?: string;
        verified_job_title_id?: string;
    },
): Promise<{ message?: string; decision?: VerificationDecisionResponse; employmentRecord?: unknown }> {
    const response = await fetch(`${API_BASE_URL}/api/verification/tokens/${tokenId}/decision/`, {
        method: 'POST',
        headers: withEmployerAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return {
        message: typeof data?.message === 'string' ? data.message : undefined,
        decision: data?.decision,
        employmentRecord: data?.employmentRecord,
    };
}

export async function fetchEmployerVerifiableGraduates(
    params?: { q?: string; year?: number | string },
): Promise<EmployerVerifiableGraduateResponse[]> {
    const query = new URLSearchParams();
    if (params?.q && params.q.trim()) {
        query.set('q', params.q.trim());
    }
    if (params?.year !== undefined && params.year !== null && String(params.year).trim() !== '') {
        query.set('year', String(params.year).trim());
    }

    const qs = query.toString();
    const response = await fetch(
        `${API_BASE_URL}/api/verification/employer/graduates/${qs ? `?${qs}` : ''}`,
        {
            headers: withEmployerAuthHeaders(),
        },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return Array.isArray(data)
        ? data
        : (Array.isArray(data?.results) ? data.results : []);
}

// ---------------------------------------------------------------------------
// Admin — Alumni endpoints
// ---------------------------------------------------------------------------

export async function fetchPendingAlumni(): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/api/admin/alumni/pending/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.results ?? []);
}

export async function fetchVerifiedAlumni(): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/api/admin/alumni/verified/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.results ?? []);
}

export async function reviewAlumniRequest(
    alumniId: string,
    action: 'approve' | 'reject',
): Promise<{ alumni?: unknown }> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/alumni/requests/${alumniId}/${action}/`,
        {
            method: 'POST',
            headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return { alumni: data?.alumni ?? data };
}

// ---------------------------------------------------------------------------
// Admin — Employer endpoints
// ---------------------------------------------------------------------------

export async function fetchEmployerRequests(): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/api/admin/employers/requests/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.results ?? []);
}

export async function reviewEmployerRequest(
    employerId: string,
    action: 'approve' | 'reject',
): Promise<{ employer?: unknown }> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/employers/requests/${employerId}/${action}/`,
        {
            method: 'POST',
            headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return { employer: data?.employer ?? data };
}

// ---------------------------------------------------------------------------
// Admin — User management (admin accounts)
// ---------------------------------------------------------------------------

export interface AdminAccount {
    id: string;
    user_id: string;
    email: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export async function fetchAdmins(): Promise<AdminAccount[]> {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return Array.isArray(data) ? (data as AdminAccount[]) : [];
}

export async function createAdmin(input: {
    email: string;
    password: string;
    is_active?: boolean;
}): Promise<AdminAccount> {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/`, {
        method: 'POST',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
    });
    await throwIfNotOk(response);
    return (await response.json()) as AdminAccount;
}

export async function updateAdmin(
    id: string,
    patch: Partial<{ email: string; password: string; is_active: boolean }>,
): Promise<AdminAccount> {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/${id}/`, {
        method: 'PATCH',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
    });
    await throwIfNotOk(response);
    return (await response.json()) as AdminAccount;
}

export async function deleteAdmin(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/admin/users/${id}/`, {
        method: 'DELETE',
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
}

// ---------------------------------------------------------------------------
// Analytics — Employability Predictions
// ---------------------------------------------------------------------------

export interface BatchPrediction {
    batch: number;
    n_alumni: number;
    actual_employment_rate: number;
    predicted_employment_rate: number;
    actual_mean_time_to_hire_months: number;
    predicted_mean_time_to_hire_months: number;
    actual_bsis_first_rate: number;
    actual_bsis_current_rate: number;
    time_to_hire_distribution: Record<string, number>;
}

export interface BatchForecast {
    batch: number;
    n_alumni_basis: number;
    predicted_employment_rate: number;
    employment_rate_lo: number;
    employment_rate_hi: number;
    predicted_mean_time_to_hire_months: number;
    time_to_hire_lo: number;
    time_to_hire_hi: number;
    time_to_hire_distribution: Record<string, number>;
}

export interface SkillProjection {
    batch: number;
    projected_share: number;
}

export interface SkillForecast {
    skill: string;
    kind: 'technical' | 'soft';
    current_share: number;
    lift: number;
    slope_per_year: number;
    holders_total: number;
    projections: SkillProjection[];
    relevance_score: number;
}

export interface AnalyticsPredictionsResponse {
    batch: number | null;
    overall: Omit<BatchPrediction, 'batch'> & { batch?: number };
    per_batch: BatchPrediction[];
    forecast: BatchForecast[];
    skill_forecast: SkillForecast[];
    model_metadata: {
        trained_at: string;
        n_samples: number;
        n_features: number;
        best_models: Record<string, string>;
        targets: Record<string, { best_model: string; metrics: Record<string, unknown> }>;
    };
    timestamp: string;
}

export async function fetchAnalyticsPredictions(
    batch?: number,
    horizon?: number,
): Promise<AnalyticsPredictionsResponse> {
    const params = new URLSearchParams();
    if (batch != null) params.set('batch', String(batch));
    if (horizon != null) params.set('horizon', String(horizon));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(
        `${API_BASE_URL}/api/admin/analytics/employability-predictions/${qs}`,
        { headers: withAdminAuthHeaders() },
    );
    await throwIfNotOk(response);
    return response.json();
}


export interface ReportSection {
    title: string;
    columns: string[];
    rows: (string | number | null)[][];
}

export interface ReportPayload {
    title: string;
    generated_at: string;
    filters: {
        batch_start: number;
        batch_end: number;
        include_unverified: boolean;
    };
    sections: ReportSection[];
}

export interface ReportFilters {
    batchStart: number;
    batchEnd: number;
    includeUnverified: boolean;
}

export async function fetchReport(
    endpointSlug: string,
    filters: ReportFilters,
): Promise<ReportPayload> {
    const params = new URLSearchParams({
        batch_start: String(filters.batchStart),
        batch_end: String(filters.batchEnd),
        include_unverified: String(filters.includeUnverified),
    });
    const response = await fetch(
        `${API_BASE_URL}/api/admin/reports/${endpointSlug}/?${params.toString()}`,
        { headers: withAdminAuthHeaders() },
    );
    await throwIfNotOk(response);
    return response.json();
}