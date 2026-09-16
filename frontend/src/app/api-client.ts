export const API_BASE_URL = (
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/$/, '');

export const ADMIN_ACCESS_TOKEN_KEY = 'admin_access_token';
export const ALUMNI_ACCESS_TOKEN_KEY = 'alumni_access_token';

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
    requiresRetracking?: boolean;
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
    /** Issued on successful login only — registration returns a pending account. */
    accessToken?: string;
    tokenType?: 'Bearer';
    expiresIn?: number;
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
    evaluationSubmitted?: boolean;
    evaluationSubmittedAt?: string | null;
}

// Employer's Confidential Feedback Form - 17-field payload submitted
// alongside a confirm decision via submitVerificationDecision.
export type EmployerEvaluationRating =
    | 'excellent'
    | 'very_good'
    | 'good'
    | 'fair'
    | 'unsatisfactory';

export interface EmployerEvaluationPayload {
    evaluator_name: string;
    employee_status: 'regular' | 'probationary_casual_jo' | 'other';
    employee_status_other?: string;
    years_in_company?: number | null;
    educational_attainment?: string;
    marital_status?: string;
    type_of_business?: string;
    date_of_evaluation: string;
    assessment_strengths: string;
    assessment_improvements: string;
    rating_quality_of_work: EmployerEvaluationRating;
    rating_work_habits: EmployerEvaluationRating;
    rating_relationship_with_people: EmployerEvaluationRating;
    rating_dependability: EmployerEvaluationRating;
    rating_quantity_of_work: EmployerEvaluationRating;
    rating_initiative: EmployerEvaluationRating;
    rating_analytical_ability: EmployerEvaluationRating;
    rating_ability_as_supervisor: EmployerEvaluationRating;
    rating_administrative_ability: EmployerEvaluationRating;
    rating_safety: EmployerEvaluationRating;
    rating_commitment_to_social_equity: EmployerEvaluationRating;
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

function readAlumniAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(ALUMNI_ACCESS_TOKEN_KEY);
}

export function withAlumniAuthHeaders(
    headers: Record<string, string> = {},
): Record<string, string> {
    const token = readAlumniAccessToken();
    if (!token) return headers;
    return {
        ...headers,
        Authorization: `Bearer ${token}`,
    };
}

/** Clear every stored session token — call on logout or on a 401. */
export function clearAccessTokens(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ALUMNI_ACCESS_TOKEN_KEY);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/alumni/register/`, {
            method: 'POST',
            body: payload,
            signal: controller.signal,
        });
        await throwIfNotOk(response);
        return response.json();
    } finally {
        clearTimeout(timeout);
    }
}   // Passing FormData but not setting the Content-Type header. When you send FormData, 
    // the browser automatically sets multipart/form-data, but your backend expects application/json

export interface AlumniLoginGps {
    gpsLat?: number | null;
    gpsLng?: number | null;
    gpsAccuracyM?: number | null;
}

export interface AlumniLoginLivenessSignal {
    challenge: 'blink' | 'mouth_open' | 'head_turn' | 'head_turn_left' | 'head_turn_right';
    mouthAspectRatio: number;
    yawDegrees: number;
    completedAt: string;
}

export async function alumniLogin(
    email: string,
    password: string,
    faceScan: Blob,
    faceDescriptor?: number[],
    similarityScore?: number,
    gps?: AlumniLoginGps,
    liveness?: AlumniLoginLivenessSignal,
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
    if (gps?.gpsLat != null) payload.append('gps_lat', String(gps.gpsLat));
    if (gps?.gpsLng != null) payload.append('gps_lng', String(gps.gpsLng));
    if (gps?.gpsAccuracyM != null) payload.append('gps_accuracy_m', String(gps.gpsAccuracyM));
    if (liveness) payload.append('liveness_signal', JSON.stringify(liveness));

    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/login/`, {
        method: 'POST',
        body: payload,
    });
    await throwIfNotOk(response);
    return response.json();
}

// ---------------------------------------------------------------------------
// Forgot password (Gmail SMTP backend)
// ---------------------------------------------------------------------------

export type ForgotRole = 'graduate' | 'employer' | 'admin';

export interface ForgotPasswordRequestResponse {
    message: string;
    resend_available_in_seconds: number;
    code_expires_in_seconds: number;
    /** Role that the backend resolved from the email (set when auto-detect was used). */
    role?: ForgotRole;
}

export interface ForgotPasswordVerifyResponse {
    message?: string;
    detail?: string;
    remaining_attempts?: number;
    lockout_seconds?: number;
}

export interface ForgotPasswordCheckCodeResponse {
    message: string;
    reset_ticket: string;
    ticket_expires_in_seconds: number;
    role?: ForgotRole;
}

export interface ForgotPasswordSetPasswordResponse {
    message: string;
}

async function postJsonOrThrow<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        let payload: Record<string, unknown> = {};
        try { payload = (await response.json()) as Record<string, unknown>; } catch { /* ignore */ }
        const err = new Error(
            (payload.detail as string)
            || (payload.message as string)
            || `Request failed (${response.status}).`,
        ) as Error & { status?: number; payload?: Record<string, unknown> };
        err.status = response.status;
        err.payload = payload;
        throw err;
    }
    return response.json() as Promise<T>;
}

export function forgotPasswordRequest(
    email: string,
    role?: ForgotRole,
): Promise<ForgotPasswordRequestResponse> {
    const body: Record<string, string> = { email };
    if (role) body.role = role;
    return postJsonOrThrow(`${API_BASE_URL}/api/auth/forgot-password/request/`, body);
}

export function forgotPasswordResend(
    email: string,
    role?: ForgotRole,
): Promise<ForgotPasswordRequestResponse> {
    const body: Record<string, string> = { email };
    if (role) body.role = role;
    return postJsonOrThrow(`${API_BASE_URL}/api/auth/forgot-password/resend/`, body);
}

export function forgotPasswordVerify(
    email: string,
    role: ForgotRole | undefined,
    code: string,
    newPassword: string,
): Promise<ForgotPasswordVerifyResponse> {
    const body: Record<string, string> = { email, code, new_password: newPassword };
    if (role) body.role = role;
    return postJsonOrThrow(
        `${API_BASE_URL}/api/auth/forgot-password/verify/`,
        body,
    );
}

export function forgotPasswordCheckCode(
    email: string,
    role: ForgotRole | undefined,
    code: string,
): Promise<ForgotPasswordCheckCodeResponse> {
    const body: Record<string, string> = { email, code };
    if (role) body.role = role;
    return postJsonOrThrow(
        `${API_BASE_URL}/api/auth/forgot-password/check-code/`,
        body,
    );
}

export function forgotPasswordSetPassword(
    resetTicket: string,
    newPassword: string,
): Promise<ForgotPasswordSetPasswordResponse> {
    return postJsonOrThrow(
        `${API_BASE_URL}/api/auth/forgot-password/set-password/`,
        { reset_ticket: resetTicket, new_password: newPassword },
    );
}

// ---------------------------------------------------------------------------
// Alumni endpoints
// ---------------------------------------------------------------------------

export async function fetchAlumniAccountStatus(alumniId: string): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}/api/auth/alumni/account/${alumniId}/`, {
        headers: withAlumniAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return data?.alumni ?? data;
}

export async function updateAlumniEmployment(
    alumniId: string,
    payload: {
        employment_status?: string;
        survey_data?: unknown;
        job_title_id?: string;
        region_id?: string;
        skill_entries?: Array<{ skillId?: string; name?: string; proficiency?: string }>;
        /** When false, suppress the auto re-evaluation email to prior confirmers. */
        notify_previous_evaluator?: boolean;
        /** True only from the Employment page: restarts the two-year retracking clock. */
        retrace_submission?: boolean;
    },
): Promise<{ alumni?: unknown }> {
    const response = await fetch(
        `${API_BASE_URL}/api/auth/alumni/account/${alumniId}/employment/`,
        {
            method: 'PATCH',
            // Backend now requires the graduate's own token and checks that it
            // matches alumniId — this endpoint was previously world-writable.
            headers: withAlumniAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload),
        },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return { alumni: data?.alumni ?? data };
}

/**
 * Graduate-initiated verification invite: mints a token for the graduate's own
 * current employment record and returns it so the UI can build a deep link
 * (`/employer/evaluate?invite={id}`) to hand to a (possibly new) evaluator.
 */
export async function createAlumniVerificationInvite(
    alumniId: string,
    employerEmail?: string,
): Promise<{ message?: string; token?: { id?: string }; companyName?: string; invitedEmail?: string }> {
    const response = await fetch(
        `${API_BASE_URL}/api/verification/alumni/${alumniId}/invite/`,
        {
            method: 'POST',
            headers: withAlumniAuthHeaders({ 'Content-Type': 'application/json' }),
            // Recorded as invited_email so a decision answered from a
            // different address can be flagged as forwarded.
            body: JSON.stringify(employerEmail ? { employer_email: employerEmail } : {}),
        },
    );
    await throwIfNotOk(response);
    return response.json();
}

/** Shape returned by the public token landing endpoint. Carries no graduate email. */
export interface VerificationTokenDetail {
    token?: { id?: string; status?: string; expiresAt?: string };
    alumni?: { id?: string; name?: string; program?: string; batchYear?: number | null };
    employmentRecord?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Employer verification endpoints (DS7)
// ---------------------------------------------------------------------------

export async function fetchVerificationToken(tokenId: string): Promise<VerificationTokenDetail> {
    // Public: holding the link is the authorisation. No auth header.
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
        // Who is answering. Required — the token proves which graduate is being
        // verified, but not who is vouching for them.
        verifier_name: string;
        verifier_email: string;
        verifier_position?: string;
    } & Partial<EmployerEvaluationPayload>,
): Promise<{ message?: string; decision?: VerificationDecisionResponse; employmentRecord?: unknown }> {
    const response = await fetch(`${API_BASE_URL}/api/verification/tokens/${tokenId}/decision/`, {
        method: 'POST',
        // No employer auth header: employers have no accounts.
        headers: { 'Content-Type': 'application/json' },
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

// ---------------------------------------------------------------------------
// Admin - Alumni endpoints
// ---------------------------------------------------------------------------

export async function fetchPendingAlumni(): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/api/admin/alumni/pending/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.results ?? []);
}

/** Masterlist-matched graduates who are already active but not yet checked by an admin. */
export async function fetchProfileReviewAlumni(): Promise<unknown[]> {
    const response = await fetch(`${API_BASE_URL}/api/admin/alumni/profile-review/`, {
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
    reason?: string,
): Promise<{ alumni?: unknown }> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/alumni/requests/${alumniId}/${action}/`,
        {
            method: 'POST',
            headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(action === 'reject' ? { reason: reason ?? '' } : {}),
        },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return { alumni: data?.alumni ?? data };
}

/** Email one verified graduate the retracking reminder now. */
export async function sendRetrackingReminder(alumniId: string): Promise<{ message?: string; sentAt?: string }> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/alumni/${alumniId}/retracking-reminder/`,
        {
            method: 'POST',
            headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({}),
        },
    );
    await throwIfNotOk(response);
    return response.json();
}

export type RetrackingEventKind = 'registered' | 'retraced' | 'reminder' | 'employer_confirmed' | 'employer_denied';

export interface RetrackingHistoryEvent {
    id: string;
    kind: RetrackingEventKind;
    occurredAt: string;
    /** Snapshot after the event (registration and confirmations). */
    employmentStatus: string;
    jobTitle: string;
    company: string;
    /** Confirmations: field is employment_status, job_title or company. */
    changes: { field: string; from: string; to: string }[];
    daysSincePrevious: number | null;
    /** Confirmations: days past the two-year due date (0 = on time). */
    overdueDays: number | null;
    /** Reminders: "auto" or the admin's email. */
    sentBy: string;
    /** Employer decisions: verifier name and position. */
    verifier: string;
    flagged: boolean;
    /** Rebuilt from saved dates when history tracking started; no snapshot. */
    backfilled: boolean;
}

export interface RetrackingHistory {
    events: RetrackingHistoryEvent[];
    summary: { confirmations: number; lateConfirmations: number; reminders: number; employerDecisions: number };
}

export interface EmployerEvaluationDetail {
    submitted: boolean;
    submittedAt: string | null;
    evaluatorName: string;
    employeeStatus: string;
    employeeStatusOther: string;
    yearsInCompany: number | null;
    educationalAttainment: string;
    typeOfBusiness: string;
    dateOfEvaluation: string | null;
    ratings: { field: string; label: string; value: string; valueLabel: string }[];
    strengths: string;
    improvements: string;
}

export interface EmployerDecisionDetail {
    id: string;
    decision: 'confirm' | 'deny' | string;
    decidedAt: string;
    comment: string;
    verifierName: string;
    verifierEmail: string;
    verifierPosition: string;
    /** Address the invite was sent to; differs from verifierEmail on some flagged rows. */
    invitedEmail: string;
    flaggedForReview: boolean;
    /** Soft checks recorded at submission; empty when nothing was flagged. */
    flagReasons: string[];
    verifiedEmployerName: string;
    verifiedJobTitle: string;
    /** Null when the employer confirmed without filling the evaluation form. */
    evaluation: EmployerEvaluationDetail | null;
}

/** Every employer decision for one graduate, with flag reasons and evaluations. */
export async function fetchEmployerDecisions(alumniId: string): Promise<EmployerDecisionDetail[]> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/alumni/${alumniId}/employer-decisions/`,
        { method: 'GET', headers: withAdminAuthHeaders({}) },
    );
    await throwIfNotOk(response);
    const data = await response.json();
    return (data.decisions ?? []) as EmployerDecisionDetail[];
}

/** One graduate's retracking history, newest first. */
export async function fetchRetrackingHistory(alumniId: string): Promise<RetrackingHistory> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/alumni/${alumniId}/retracking-history/`,
        { method: 'GET', headers: withAdminAuthHeaders({}) },
    );
    await throwIfNotOk(response);
    return response.json();
}

// ---------------------------------------------------------------------------
// Admin - Employer endpoints
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin - User management (admin accounts)
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

export interface MasterlistEntry { id: string; name: string; graduationYear: number | null; }
export interface MasterlistData {
    total: number;
    perBatch: { year: number; count: number }[];
    entries: MasterlistEntry[];
}

export async function fetchMasterlist(): Promise<MasterlistData> {
    const response = await fetch(`${API_BASE_URL}/api/admin/masterlist/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return {
        total: typeof data?.total === 'number' ? data.total : 0,
        perBatch: Array.isArray(data?.perBatch) ? data.perBatch : [],
        entries: Array.isArray(data?.entries) ? data.entries : [],
    };
}

export async function createMasterlistEntries(
    entries: { name: string; graduation_year: number }[],
): Promise<{
    created: number;
    duplicates?: number;
    skipped?: number;
    /** Rows the server refused, with the reason (first 50). */
    skippedRows?: { row: number; name: string; reason: string }[];
    entries: { id: string; name: string; batch_year: number }[];
}> {
    const response = await fetch(`${API_BASE_URL}/api/admin/masterlist/bulk-create/`, {
        method: 'POST',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ entries }),
    });
    await throwIfNotOk(response);
    return response.json();
}

// ---------------------------------------------------------------------------
// Analytics - Employability Predictions
// ---------------------------------------------------------------------------

/** A proportion with its sample size and Wilson 95% interval. `rate` is null
 *  when there is no data (n = 0) or when the group is too small to show
 *  (`suppressed`, fewer than 5 graduates). Never render either case as 0%. */
export interface RateEstimate {
    n: number;
    k: number | null;
    rate: number | null;
    ci_low: number | null;
    ci_high: number | null;
    suppressed: boolean;
}

export interface TimeToFirstJob {
    n: number;
    suppressed: boolean;
    bands: { label: string; count: number | null }[];
}

export interface EmployabilityIndicators {
    respondents: number;
    /** Graduates on the masterlist for the same batches. */
    graduates: number | null;
    response_rate: number | null;
    /** More respondents than masterlist records: the masterlist is missing graduates, so there is no response rate. */
    masterlist_incomplete: boolean;
    /** Seeded demonstration accounts among the respondents. */
    sample_accounts: number;
    n_with_outcome: number;
    /** Employed among graduates who are working or looking for work. */
    employment_rate: RateEstimate;
    employed_within_12_months: RateEstimate;
    bsis_aligned_first_job: RateEstimate;
    bsis_aligned_current_job: RateEstimate;
    time_to_first_job: TimeToFirstJob;
    /** Mean predicted chance of work within 12 months from the active model; null without one. */
    model_expected_within_12_months: { rate: number | null; n: number; suppressed: boolean } | null;
}

export interface BatchIndicators extends EmployabilityIndicators {
    batch: number;
}

export interface OutlookYear {
    batch: number;
    centre: number;
    low: number;
    high: number;
}

/** Expected employment range for the next batches: how much past batches
 *  varied, not a forecast from graduate answers. */
export interface EmploymentOutlook {
    available: boolean;
    reason?: string;
    basis?: 'backtest' | 'default';
    batches_used?: number[];
    backtest_errors?: number;
    half_width?: number;
    years: OutlookYear[];
}

export interface ModelCheck {
    key: string;
    label: string;
    passed: boolean;
    value: string;
    rule: string;
}

export interface ModelFactor {
    feature: string;
    label: string;
    odds_ratio: number;
    ci_low: number;
    ci_high: number;
    direction_consistency: number;
    stable: boolean;
    /** The 95% interval excludes an odds ratio of 1. */
    clear: boolean;
}

export interface EmployabilityModelSummary {
    status: 'active' | 'none';
    message?: string;
    version?: string;
    trained_at?: string;
    source?: 'database' | 'simulated' | string;
    source_details?: Record<string, unknown>;
    target_label?: string;
    features?: string[];
    passed?: boolean;
    metrics?: Record<string, number | null>;
    checks?: ModelCheck[];
    factors?: ModelFactor[];
}

export interface SkillComparison {
    /** Employment rate of labor-force graduates who listed the skill. */
    with_rate: number;
    with_n: number;
    /** Employment rate of labor-force graduates who did not. */
    without_rate: number;
    without_n: number;
    difference_points: number;
    difference_low_points: number;
    difference_high_points: number;
    /** The 95% interval for the difference does not include zero. */
    clear: boolean;
}

export interface SkillRow {
    skill: string;
    kind: 'technical' | 'soft';
    graduates: number;
    /** Share of graduates who listed any skill. */
    share: number;
    /** Null when either group has fewer than `min_group` graduates. */
    comparison: SkillComparison | null;
}

export interface SkillSummary {
    respondents: number;
    labor_force: number;
    min_group: number;
    hidden_skills: number;
    skills: SkillRow[];
}

export interface AnalyticsPredictionsResponse {
    batch: number | null;
    /** Summary for the selected batch, or for all batches. */
    overall: EmployabilityIndicators;
    /** Every batch on the masterlist or with respondents, oldest first. */
    per_batch: BatchIndicators[];
    outlook: EmploymentOutlook;
    model: EmployabilityModelSummary;
    skills: SkillSummary;
    /** Records left out of every figure, e.g. graduation dates in the future. */
    data_issues: { future_graduation: number };
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

// #region DEBUG-ONLY:CurrenChanDebug
// Temporary admin debug-only API helpers - pair with the fenced backend
// endpoints in users/api.py. Remove together when the codeword is retired.
// Agents writing docs / DFD / use-cases must omit these.

export type DebugAccountRole = 'alumni' | 'employer' | 'admin';

export interface DebugAccountRow {
    role: DebugAccountRole;
    id: string;
    userId: string | null;
    email: string;
    name: string;
    status: string;
    createdAt: string | null;
}

export interface DebugAccountsResponse {
    alumni: DebugAccountRow[];
    employer: DebugAccountRow[];
    admin: DebugAccountRow[];
}

export async function fetchDebugAccounts(): Promise<DebugAccountsResponse> {
    const response = await fetch(`${API_BASE_URL}/api/admin/debug/accounts/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return {
        alumni: Array.isArray(data?.alumni) ? data.alumni : [],
        employer: Array.isArray(data?.employer) ? data.employer : [],
        admin: Array.isArray(data?.admin) ? data.admin : [],
    };
}

export async function deleteDebugAccount(role: DebugAccountRole, id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/admin/debug/accounts/${role}/${id}/`, {
        method: 'DELETE',
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
}

// ── Face / liveness harness (backs /admin/debug/face) ───────────────────────

export interface DebugFaceAccount {
    id: string;
    email: string;
    password: string;
    status: string;
}

export interface DebugFaceVerifyResult {
    isMatch: boolean;
    distance: number;
    similarity: number;
    threshold: number;
    referenceCount: number;
    /**
     * Which engine produced this number, straight from the server. Surfaced
     * because the distance scales are not comparable between engines --
     * face-api is euclidean where strangers sit above 0.60, ArcFace is cosine
     * where they sit above 0.45 -- so a reading is meaningless without it.
     */
    engine?: string;
    dimensions?: number;
    metric?: string;
}

export async function createDebugFaceAccount(): Promise<DebugFaceAccount> {
    const response = await fetch(`${API_BASE_URL}/api/admin/debug/face-account/`, {
        method: 'POST',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
    });
    await throwIfNotOk(response);
    return response.json();
}

/** Removes every account carrying BOTH debug markers. Returns how many went. */
export async function purgeDebugFaceAccounts(): Promise<number> {
    const response = await fetch(`${API_BASE_URL}/api/admin/debug/face-account/`, {
        method: 'DELETE',
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    const data = await response.json();
    return Number(data?.deleted ?? 0);
}

export interface DebugFaceEngineInfo {
    name: string;
    dimensions: number;
    threshold: number;
    metric: string;
    /** True when the embedding is produced in the browser (face-api only). */
    runsInBrowser: boolean;
    available: boolean;
    reason: string;
}

export async function fetchDebugFaceEngines(): Promise<{
    engines: DebugFaceEngineInfo[];
    serverDefault: string;
}> {
    const response = await fetch(`${API_BASE_URL}/api/admin/debug/face-engines/`, {
        headers: withAdminAuthHeaders(),
    });
    await throwIfNotOk(response);
    return response.json();
}

/**
 * Both enrol and verify take the engine per request, so the debug page can
 * switch between engines against the same face. The image is always sent:
 * face-api ignores it and uses the descriptor, the server-side engines ignore
 * the descriptor and embed the image.
 */
/** One captured frame: the image, the browser-side vector if any, and the pose. */
export interface DebugFaceCapture {
    blob: Blob | null;
    descriptor: number[] | null;
    yaw?: number;
}

/**
 * Both enrol and verify take the engine per request, so the debug page can
 * switch between engines against the same face. Frames are always sent:
 * face-api ignores them and uses its descriptors, while the server-side engines
 * ignore the descriptors and embed the frames.
 */
function debugFaceBody(engine: string, captures: DebugFaceCapture[]): FormData {
    const body = new FormData();
    body.append('engine', engine);

    const descriptors: number[][] = [];
    const meta: { yaw: number | null }[] = [];
    captures.forEach((c, i) => {
        if (c.blob) body.append('face_images', c.blob, `face_${i}.jpg`);
        if (c.descriptor) descriptors.push(c.descriptor);
        meta.push({ yaw: typeof c.yaw === 'number' ? c.yaw : null });
    });

    if (descriptors.length) {
        body.append('face_descriptor_samples', JSON.stringify(descriptors));
        body.append('face_descriptor', JSON.stringify(descriptors[0]));
    }
    body.append('sample_meta', JSON.stringify(meta));
    return body;
}

export interface DebugFaceEnrolResult {
    engine: string;
    dimensions: number;
    samples: number;
    framesSupplied: number;
    /** Null for browser engines, which embed client-side. */
    framesUsed: number | null;
    enrolledEngines: string[];
}

export async function enrolDebugFace(
    accountId: string,
    engine: string,
    captures: DebugFaceCapture[],
): Promise<DebugFaceEnrolResult> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/debug/face-account/${accountId}/enrol/`,
        {
            method: 'POST',
            // No Content-Type: the browser sets the multipart boundary itself.
            headers: withAdminAuthHeaders(),
            body: debugFaceBody(engine, captures),
        },
    );
    await throwIfNotOk(response);
    return response.json();
}

export async function verifyDebugFace(
    accountId: string,
    engine: string,
    capture: DebugFaceCapture,
): Promise<DebugFaceVerifyResult> {
    const response = await fetch(
        `${API_BASE_URL}/api/admin/debug/face-account/${accountId}/verify/`,
        {
            method: 'POST',
            headers: withAdminAuthHeaders(),
            body: debugFaceBody(engine, [capture]),
        },
    );
    await throwIfNotOk(response);
    return response.json();
}

// #endregion DEBUG-ONLY:CurrenChanDebug