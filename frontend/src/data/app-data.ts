export type EmploymentStatus = "employed" | "self-employed" | "unemployed" | string;
export type VerificationStatus = "verified" | "pending" | "rejected" | string;

export interface AlumniRecord {
    id?: string;
    schoolId?: string;
    studentId?: string;
    name?: string;
    email?: string;
    graduationYear?: number;
    verificationStatus?: VerificationStatus;
    employmentStatus?: EmploymentStatus;
    jobTitle?: string;
    company?: string;
    industry?: string;
    jobAlignment?: "related" | "not-related";
    workLocation?: string;
    workCity?: string;
    unemploymentReason?: string;
    dateUpdated?: string;
    /** Employment record last confirmed over two years ago. */
    requiresRetracking?: boolean;
    /** YYYY-MM-DD the graduate last retraced (or registered). */
    lastRetracedAt?: string | null;
    daysSinceRetrace?: number | null;
    retrackingDueAt?: string | null;
    retrackingOverdueDays?: number;
    /** ISO timestamp of the last retracking reminder email. */
    lastRetrackingReminderAt?: string | null;
    dateEmployed?: string;
    monthsToHire?: number;
    biometricCaptured?: boolean;
    biometricDate?: string;
    skills?: string[];
    lat?: number;
    lng?: number;
    workLat?: number | null;
    workLng?: number | null;
    /** Consent to appear on the public geomap. Absent/false means do not plot. */
    geomapConsent?: boolean;
    facePhotoUrl?: string;
    /** Whether registration found this graduate on the masterlist. */
    matchStatus?: 'matched' | 'unmatched' | string;
    masterRecordName?: string | null;
    masterRecordBatch?: number | null;
    registrationFaceScans?: { front?: string | null; left?: string | null; right?: string | null };
    [key: string]: unknown;
}

export interface MasterEntry {
    schoolId: string;
    name: string;
    email: string;
    graduationYear: number;
}

export interface EmployerAccount {
    name?: string;
    email?: string;
    companyName?: string;
    industry?: string;
    status?: string;
    [key: string]: unknown;
}

// Placeholder datasets while real backend integration is in progress.
