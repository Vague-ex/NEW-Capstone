import { useEffect, useState, useCallback } from 'react';

const API_BASE_URL = (
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
    'http://localhost:8000'
).replace(/\/$/, '');

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SkillItem {
    id: string;
    name: string;
    category: string | null;
    category_name: string | null;
    is_active: boolean;
}

export interface SkillCategoryItem {
    id: string;
    name: string;
    is_active: boolean;
}

export interface IndustryItem {
    id: string;
    name: string;
    is_active: boolean;
}

export interface JobTitleItem {
    id: string;
    name: string;
    industry: string | null;
    industry_name: string | null;
    is_active: boolean;
}

export interface RegionItem {
    id: string;
    code: string;
    name: string;
    is_active: boolean;
}

export interface ReferenceData {
    skills: SkillItem[];
    skill_categories: SkillCategoryItem[];
    industries: IndustryItem[];
    job_titles: JobTitleItem[];
    regions: RegionItem[];
}

// ── Fallback static data (used when backend is not reachable) ──────────────────

export const FALLBACK_BSIS_CORE_SKILLS: SkillItem[] = [
    'Programming/Software Development',
    'Database Management',
    'Network Administration',
    'Business Process Analysis',
    'Project Management',
    'Technical Support / Troubleshooting',
    'Data Analytics',
    'Web Development',
    'System Analysis and Design',
    'Communication Skills (Oral/Written)',
    'Teamwork/Collaboration',
    'Problem-solving / Critical Thinking',
].map((name, i) => ({
    id: `fallback-${i}`,
    name,
    category: 'fallback-core',
    category_name: 'BSIS Core Competencies',
    is_active: true,
}));

export const FALLBACK_INDUSTRIES: IndustryItem[] = [
    'IT & BPO',
    'Banking & Finance',
    'Healthcare',
    'Telecommunications',
    'Government',
    'Manufacturing',
    'Retail & E-commerce',
    'Education',
    'Media & Entertainment',
    'Others',
].map((name, i) => ({ id: `fallback-ind-${i}`, name, is_active: true }));

const EMPTY: ReferenceData = {
    skills: [],
    skill_categories: [],
    industries: [],
    job_titles: [],
    regions: [],
};

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useReferenceData() {
    const [data, setData] = useState<ReferenceData>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/reference/`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: ReferenceData = await res.json();
            setData(json);
        } catch (err) {
            // Fall back gracefully — forms still work with static lists
            setError('Could not load reference data from server. Using defaults.');
            setData({
                skills: FALLBACK_BSIS_CORE_SKILLS,
                skill_categories: [{ id: 'fallback-core', name: 'BSIS Core Competencies', is_active: true }],
                industries: FALLBACK_INDUSTRIES,
                job_titles: [],
                regions: [],
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { data, loading, error, reload: load };
}

// ── Admin CRUD helpers (used by settings page) ─────────────────────────────────

async function apiRequest(path: string, method: string, body?: object): Promise<unknown> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json();
    if (!res.ok) throw new Error(json?.detail || `HTTP ${res.status}`);
    return json;
}

// Skills
export const skillsApi = {
    list: () => apiRequest('/api/reference/skills/', 'GET') as Promise<{ skills: SkillItem[] }>,
    create: (name: string, category_id?: string | null) =>
        apiRequest('/api/reference/skills/', 'POST', { name, category_id }) as Promise<{ skill: SkillItem }>,
    update: (id: string, patch: Partial<SkillItem & { category_id?: string | null }>) =>
        apiRequest(`/api/reference/skills/${id}/`, 'PATCH', patch) as Promise<{ skill: SkillItem }>,
    remove: (id: string) => apiRequest(`/api/reference/skills/${id}/`, 'DELETE'),
};

// Skill categories
export const skillCategoriesApi = {
    list: () => apiRequest('/api/reference/skill-categories/', 'GET') as Promise<{ categories: SkillCategoryItem[] }>,
    create: (name: string) =>
        apiRequest('/api/reference/skill-categories/', 'POST', { name }) as Promise<{ category: SkillCategoryItem }>,
    update: (id: string, patch: Partial<SkillCategoryItem>) =>
        apiRequest(`/api/reference/skill-categories/${id}/`, 'PATCH', patch) as Promise<{ category: SkillCategoryItem }>,
    remove: (id: string) => apiRequest(`/api/reference/skill-categories/${id}/`, 'DELETE'),
};

// Industries
export const industriesApi = {
    list: () => apiRequest('/api/reference/industries/', 'GET') as Promise<{ industries: IndustryItem[] }>,
    create: (name: string) =>
        apiRequest('/api/reference/industries/', 'POST', { name }) as Promise<{ industry: IndustryItem }>,
    update: (id: string, patch: Partial<IndustryItem>) =>
        apiRequest(`/api/reference/industries/${id}/`, 'PATCH', patch) as Promise<{ industry: IndustryItem }>,
    remove: (id: string) => apiRequest(`/api/reference/industries/${id}/`, 'DELETE'),
};

// Job titles
export const jobTitlesApi = {
    list: () => apiRequest('/api/reference/job-titles/', 'GET') as Promise<{ job_titles: JobTitleItem[] }>,
    create: (name: string, industry_id?: string | null) =>
        apiRequest('/api/reference/job-titles/', 'POST', { name, industry_id }) as Promise<{ job_title: JobTitleItem }>,
    update: (id: string, patch: Partial<JobTitleItem & { industry_id?: string | null }>) =>
        apiRequest(`/api/reference/job-titles/${id}/`, 'PATCH', patch) as Promise<{ job_title: JobTitleItem }>,
    remove: (id: string) => apiRequest(`/api/reference/job-titles/${id}/`, 'DELETE'),
};