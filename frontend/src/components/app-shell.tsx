"use client";

import dynamic from 'next/dynamic';

const App = dynamic(() => import('@/App'), { ssr: false });

// Temporary preview mode: set to false once normal login-only flow is restored.
const PREVIEW_ALL_PAGES = false;
let previewSessionSeeded = false;

function ensurePreviewSession() {
    if (!PREVIEW_ALL_PAGES || previewSessionSeeded || typeof window === 'undefined') {
        return;
    }

    const previewAlumni = {
        id: 'preview-001',
        schoolId: 'BSIS-2023-001',
        studentId: 'BSIS-2023-001',
        name: 'Preview Alumni',
        email: 'preview.alumni@chmsu.edu.ph',
        graduationYear: 2023,
        verificationStatus: 'verified',
        employmentStatus: 'employed',
        jobTitle: 'Junior Developer',
        company: 'Preview Tech Solutions',
        industry: 'Information Technology',
        jobAlignment: 'related',
        workLocation: 'Bacolod City',
        dateUpdated: new Date().toISOString().split('T')[0],
        biometricCaptured: true,
        biometricDate: new Date().toISOString().split('T')[0],
        skills: ['Web Development', 'Database Management'],
    };

    const previewEmployer = {
        name: 'Preview Employer',
        email: 'preview.employer@company.com',
        company: 'Preview Tech Solutions',
        companyName: 'Preview Tech Solutions',
        industry: 'Information Technology',
        status: 'approved',
    };

    try {
        const alumniRaw = sessionStorage.getItem('alumni_user');
        const alumni = alumniRaw ? JSON.parse(alumniRaw) : null;
        if (!alumni || typeof alumni !== 'object' || !alumni.name) {
            sessionStorage.setItem('alumni_user', JSON.stringify(previewAlumni));
        }

        const employerRaw = sessionStorage.getItem('employer_user');
        const employer = employerRaw ? JSON.parse(employerRaw) : null;
        if (!employer || typeof employer !== 'object' || !employer.company) {
            sessionStorage.setItem('employer_user', JSON.stringify(previewEmployer));
        }

        if (sessionStorage.getItem('admin_authenticated') !== 'true') {
            sessionStorage.setItem('admin_authenticated', 'true');
        }
    } catch {
        sessionStorage.setItem('alumni_user', JSON.stringify(previewAlumni));
        sessionStorage.setItem('employer_user', JSON.stringify(previewEmployer));
        sessionStorage.setItem('admin_authenticated', 'true');
    }

    previewSessionSeeded = true;
}

export function AppShell() {
    ensurePreviewSession();
    return <App />;
}