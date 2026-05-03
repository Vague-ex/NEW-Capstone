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
    dateEmployed?: string;
    monthsToHire?: number;
    biometricCaptured?: boolean;
    biometricDate?: string;
    skills?: string[];
    lat?: number;
    lng?: number;
    facePhotoUrl?: string;
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
export const MASTER_LIST: MasterEntry[] = [];
export const VALID_ALUMNI: AlumniRecord[] = [];
export const GRADUATION_YEARS: number[] = [];
export const INDUSTRIES: string[] = [];
export const UNEMPLOYMENT_REASONS: string[] = [];
export const TOP_SKILLS: Array<{ skill: string; count: number; percentage: number }> = [];
export const YEARLY_EMPLOYMENT_RATES: Array<{ year: number; rate: number }> = [];
export const TIME_TO_HIRE_DATA: Array<{ range: string; count: number }> = [];
export const INDUSTRY_TRENDS: Array<{ industry: string; value: number }> = [];
export const EMPLOYER_ACCOUNTS: EmployerAccount[] = [];
