import { useState, useEffect } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import {
    Plus, Trash2, Pencil, Check, X, AlertCircle,
    ChevronDown, ChevronUp, RefreshCw, Tag, Briefcase,
    Building2, Layers, MapPin, Search,
} from 'lucide-react';
import {
    industriesApi,
    jobTitlesApi,
    regionsApi,
    skillCategoriesApi,
    skillsApi,
    type IndustryItem,
    type JobTitleItem,
    type RegionItem,
    type SkillCategoryItem,
    type SkillItem,
    useReferenceData,
} from '../../hooks/useReferenceData';

// ── Reusable inline-edit row ───────────────────────────────────────────────────

function EditableRow({
    value,
    badge,
    onSave,
    onDelete,
}: {
    value: string;
    badge?: string;
    onSave: (newName: string) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const save = async () => {
        if (!draft.trim() || draft.trim() === value) { setEditing(false); return; }
        setBusy(true);
        setErr('');
        try {
            await onSave(draft.trim());
            setEditing(false);
        } catch (e: any) {
            setErr(e.message || 'Save failed.');
        } finally {
            setBusy(false);
        }
    };

    const del = async () => {
        if (!confirm(`Remove "${value}"?`)) return;
        setBusy(true);
        try {
            await onDelete();
        } catch (e: any) {
            setErr(e.message || 'Delete failed.');
            setBusy(false);
        }
    };

    return (
        <div className="flex items-center gap-2 py-2 px-3 rounded-xl hover:bg-gray-50 group transition">
            {editing ? (
                <>
                    <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
                        className="flex-1 rounded-lg border border-[#166534] bg-white px-3 py-1.5 text-sm outline-none ring-2 ring-[#166534]/15"
                    />
                    <button onClick={save} disabled={busy}
                        className="flex size-7 items-center justify-center rounded-lg bg-[#166534] text-white hover:bg-[#14532d] disabled:opacity-60 transition">
                        {busy ? <span className="size-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="size-3.5" />}
                    </button>
                    <button onClick={() => setEditing(false)}
                        className="flex size-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition">
                        <X className="size-3.5" />
                    </button>
                </>
            ) : (
                <>
                    <span className="flex-1 text-gray-700 text-sm">{value}</span>
                    {badge && (
                        <span className="text-gray-400 bg-gray-100 text-xs px-2 py-0.5 rounded-full shrink-0">{badge}</span>
                    )}
                    {err && <span className="text-red-500 text-xs">{err}</span>}
                    <button onClick={() => { setDraft(value); setEditing(true); }}
                        className="opacity-0 group-hover:opacity-100 flex size-7 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-[#166534] hover:border-[#166534]/40 transition">
                        <Pencil className="size-3.5" />
                    </button>
                    <button onClick={del} disabled={busy}
                        className="opacity-0 group-hover:opacity-100 flex size-7 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition disabled:opacity-40">
                        {busy ? <span className="size-3 border border-gray-300 border-t-red-400 rounded-full animate-spin" /> : <Trash2 className="size-3.5" />}
                    </button>
                </>
            )}
        </div>
    );
}

// ── Add-item input ─────────────────────────────────────────────────────────────

function AddItemRow({
    placeholder,
    onAdd,
    selectOptions,
    selectLabel,
    extraTextPlaceholder,
}: {
    placeholder: string;
    onAdd: (name: string, extraId?: string) => Promise<void>;
    selectOptions?: { id: string; name: string }[];
    selectLabel?: string;
    extraTextPlaceholder?: string;
}) {
    const [name, setName] = useState('');
    const [extraId, setExtraId] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const submit = async () => {
        if (!name.trim()) return;
        setBusy(true);
        setErr('');
        try {
            await onAdd(name.trim(), extraId || undefined);
            setName('');
            setExtraId('');
        } catch (e: any) {
            setErr(e.message || 'Add failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-1.5">
            <div className="flex gap-2">
                <input
                    value={name}
                    onChange={e => { setName(e.target.value); setErr(''); }}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    placeholder={placeholder}
                    className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                />
                {selectOptions && selectOptions.length > 0 && (
                    <select
                        value={extraId}
                        onChange={e => setExtraId(e.target.value)}
                        className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-[#166534] focus:bg-white"
                    >
                        <option value="">{selectLabel ?? 'Category (optional)'}</option>
                        {selectOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                )}
                {extraTextPlaceholder && (
                    <input
                        value={extraId}
                        onChange={e => setExtraId(e.target.value)}
                        placeholder={extraTextPlaceholder}
                        className="w-40 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white"
                    />
                )}
                <button onClick={submit} disabled={busy || !name.trim()}
                    className="flex items-center gap-1.5 bg-[#166534] hover:bg-[#14532d] text-white px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
                    style={{ fontWeight: 600 }}>
                    {busy
                        ? <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        : <><Plus className="size-4" /> Add</>}
                </button>
            </div>
            {err && (
                <p className="flex items-center gap-1.5 text-red-600 text-xs">
                    <AlertCircle className="size-3.5" /> {err}
                </p>
            )}
        </div>
    );
}

// ── Collapsible section ────────────────────────────────────────────────────────

function Section({
    icon: Icon,
    title,
    subtitle,
    count,
    defaultOpen = false,
    children,
}: {
    icon: React.ElementType;
    title: string;
    subtitle: string;
    count: number;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-gray-50/60 transition">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]/10 shrink-0">
                    <Icon className="size-5 text-[#166534]" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>{title}</p>
                        <span className="text-xs bg-[#166534]/10 text-[#166534] px-2 py-0.5 rounded-full" style={{ fontWeight: 600 }}>
                            {count}
                        </span>
                    </div>
                    <p className="text-gray-400 text-xs mt-0.5">{subtitle}</p>
                </div>
                {open ? <ChevronUp className="size-4 text-gray-400 shrink-0" /> : <ChevronDown className="size-4 text-gray-400 shrink-0" />}
            </button>
            {open && <div className="border-t border-gray-100 px-6 pb-5 pt-4">{children}</div>}
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AdminSettings() {
    const { data, loading, error: loadError, reload } = useReferenceData();

    // Local copies for optimistic UI
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [categories, setCategories] = useState<SkillCategoryItem[]>([]);
    const [industries, setIndustries] = useState<IndustryItem[]>([]);
    const [jobTitles, setJobTitles] = useState<JobTitleItem[]>([]);
    const [regions, setRegions] = useState<RegionItem[]>([]);

    const [search, setSearch] = useState('');

    useEffect(() => {
        setSkills(data.skills);
        setCategories(data.skill_categories);
        setIndustries(data.industries);
        setJobTitles(data.job_titles);
        setRegions(data.regions);
    }, [data]);

    // ── Skills ──────────────────────────────────────────────────────────────────
    const addSkill = async (name: string, category_id?: string) => {
        const res = await skillsApi.create(name, category_id || null);
        setSkills(prev => [...prev, res.skill].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateSkill = async (id: string, newName: string) => {
        const res = await skillsApi.update(id, { name: newName });
        setSkills(prev => prev.map(s => s.id === id ? res.skill : s));
    };

    const removeSkill = async (id: string) => {
        await skillsApi.remove(id);
        setSkills(prev => prev.filter(s => s.id !== id));
    };

    // ── Categories ──────────────────────────────────────────────────────────────
    const addCategory = async (name: string) => {
        const res = await skillCategoriesApi.create(name);
        setCategories(prev => [...prev, res.category].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateCategory = async (id: string, newName: string) => {
        const res = await skillCategoriesApi.update(id, { name: newName });
        setCategories(prev => prev.map(c => c.id === id ? res.category : c));
    };

    const removeCategory = async (id: string) => {
        await skillCategoriesApi.remove(id);
        setCategories(prev => prev.filter(c => c.id !== id));
    };

    // ── Industries ──────────────────────────────────────────────────────────────
    const addIndustry = async (name: string) => {
        const res = await industriesApi.create(name);
        setIndustries(prev => [...prev, res.industry].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateIndustry = async (id: string, newName: string) => {
        const res = await industriesApi.update(id, { name: newName });
        setIndustries(prev => prev.map(i => i.id === id ? res.industry : i));
    };

    const removeIndustry = async (id: string) => {
        await industriesApi.remove(id);
        setIndustries(prev => prev.filter(i => i.id !== id));
    };

    // ── Job Titles ──────────────────────────────────────────────────────────────
    const addJobTitle = async (name: string, industry_id?: string) => {
        const res = await jobTitlesApi.create(name, industry_id || null);
        setJobTitles(prev => [...prev, res.job_title].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateJobTitle = async (id: string, newName: string) => {
        const res = await jobTitlesApi.update(id, { name: newName });
        setJobTitles(prev => prev.map(j => j.id === id ? res.job_title : j));
    };

    const removeJobTitle = async (id: string) => {
        await jobTitlesApi.remove(id);
        setJobTitles(prev => prev.filter(j => j.id !== id));
    };

    // ── Regions ─────────────────────────────────────────────────────────────────
    const addRegion = async (name: string, code?: string) => {
        const normalizedCode = (code ?? '').trim().toUpperCase();
        if (!normalizedCode) {
            throw new Error('Region code is required.');
        }
        const res = await regionsApi.create(name, normalizedCode);
        setRegions(prev => [...prev, res.region].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const updateRegion = async (id: string, newName: string) => {
        const res = await regionsApi.update(id, { name: newName });
        setRegions(prev => prev.map(r => r.id === id ? res.region : r));
    };

    const removeRegion = async (id: string) => {
        await regionsApi.remove(id);
        setRegions(prev => prev.filter(r => r.id !== id));
    };

    // ── Filter ──────────────────────────────────────────────────────────────────
    const q = search.toLowerCase();
    const filteredSkills = q ? skills.filter(s => s.name.toLowerCase().includes(q)) : skills;
    const filteredIndustries = q ? industries.filter(i => i.name.toLowerCase().includes(q)) : industries;
    const filteredJobTitles = q ? jobTitles.filter(j => j.name.toLowerCase().includes(q)) : jobTitles;
    const filteredRegions = q
        ? regions.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
        : regions;

    return (
        <PortalLayout
            role="admin"
            pageTitle="Reference Settings"
            pageSubtitle="Manage skills, industries, and job titles used across the system">
            <div className="max-w-3xl mx-auto space-y-5">

                {/* Header bar */}
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Filter items across all sections…"
                            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15"
                        />
                    </div>
                    <button onClick={reload}
                        className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2.5 rounded-xl text-sm transition"
                        style={{ fontWeight: 500 }}>
                        <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>

                {loadError && (
                    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
                        <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-amber-700 text-sm">{loadError}</p>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <span className="size-8 border-4 border-[#166534]/20 border-t-[#166534] rounded-full animate-spin" />
                    </div>
                ) : (
                    <>
                        {/* ── BSIS Skills ─────────────────────────────────────────── */}
                        <Section
                            icon={Tag}
                            title="Skills"
                            subtitle="Skills shown in the registration form and alumni profile (Step 5)"
                            count={skills.length}
                            defaultOpen>
                            <div className="mb-4">
                                <AddItemRow
                                    placeholder="New skill name (e.g. Cloud Computing)"
                                    onAdd={addSkill}
                                    selectOptions={categories}
                                    selectLabel="Category (optional)"
                                />
                            </div>

                            {/* Group by category */}
                            {categories.map(cat => {
                                const catSkills = filteredSkills.filter(s => s.category === cat.id);
                                if (catSkills.length === 0) return null;
                                return (
                                    <div key={cat.id} className="mb-3">
                                        <p className="text-[#166534] text-xs mb-1 px-3" style={{ fontWeight: 700 }}>{cat.name}</p>
                                        {catSkills.map(s => (
                                            <EditableRow
                                                key={s.id}
                                                value={s.name}
                                                onSave={name => updateSkill(s.id, name)}
                                                onDelete={() => removeSkill(s.id)}
                                            />
                                        ))}
                                    </div>
                                );
                            })}

                            {/* Uncategorized */}
                            {(() => {
                                const uncategorized = filteredSkills.filter(s => !s.category);
                                if (uncategorized.length === 0) return null;
                                return (
                                    <div className="mb-2">
                                        <p className="text-gray-400 text-xs mb-1 px-3" style={{ fontWeight: 600 }}>Uncategorized</p>
                                        {uncategorized.map(s => (
                                            <EditableRow
                                                key={s.id}
                                                value={s.name}
                                                onSave={name => updateSkill(s.id, name)}
                                                onDelete={() => removeSkill(s.id)}
                                            />
                                        ))}
                                    </div>
                                );
                            })()}

                            {filteredSkills.length === 0 && (
                                <p className="text-gray-400 text-sm text-center py-4">No skills yet. Add the first one above.</p>
                            )}
                        </Section>

                        {/* ── Skill Categories ────────────────────────────────────── */}
                        <Section
                            icon={Layers}
                            title="Skill Categories"
                            subtitle="Groups used to organise skills in the skills selector"
                            count={categories.length}>
                            <div className="mb-4">
                                <AddItemRow
                                    placeholder="New category name (e.g. Cloud & DevOps)"
                                    onAdd={addCategory}
                                />
                            </div>
                            {categories.map(c => (
                                <EditableRow
                                    key={c.id}
                                    value={c.name}
                                    badge={`${skills.filter(s => s.category === c.id).length} skills`}
                                    onSave={name => updateCategory(c.id, name)}
                                    onDelete={() => removeCategory(c.id)}
                                />
                            ))}
                            {categories.length === 0 && (
                                <p className="text-gray-400 text-sm text-center py-4">No categories yet.</p>
                            )}
                        </Section>

                        {/* ── Industries ──────────────────────────────────────────── */}
                        <Section
                            icon={Building2}
                            title="Industries"
                            subtitle="Industry options shown in employment forms and employer registration"
                            count={industries.length}>
                            <div className="mb-4">
                                <AddItemRow
                                    placeholder="New industry (e.g. Fintech)"
                                    onAdd={addIndustry}
                                />
                            </div>
                            {filteredIndustries.map(i => (
                                <EditableRow
                                    key={i.id}
                                    value={i.name}
                                    onSave={name => updateIndustry(i.id, name)}
                                    onDelete={() => removeIndustry(i.id)}
                                />
                            ))}
                            {filteredIndustries.length === 0 && (
                                <p className="text-gray-400 text-sm text-center py-4">No industries yet.</p>
                            )}
                        </Section>

                        {/* ── Job Titles ──────────────────────────────────────────── */}
                        <Section
                            icon={Briefcase}
                            title="Job Titles"
                            subtitle="Suggested job titles for alumni employment forms"
                            count={jobTitles.length}>
                            <div className="mb-4">
                                <AddItemRow
                                    placeholder="New job title (e.g. Systems Analyst)"
                                    onAdd={addJobTitle}
                                    selectOptions={industries}
                                    selectLabel="Industry (optional)"
                                />
                            </div>
                            {filteredJobTitles.map(j => (
                                <EditableRow
                                    key={j.id}
                                    value={j.name}
                                    badge={j.industry_name ?? undefined}
                                    onSave={name => updateJobTitle(j.id, name)}
                                    onDelete={() => removeJobTitle(j.id)}
                                />
                            ))}
                            {filteredJobTitles.length === 0 && (
                                <p className="text-gray-400 text-sm text-center py-4">No job titles yet.</p>
                            )}
                        </Section>

                        {/* ── Regions ─────────────────────────────────────────────── */}
                        <Section
                            icon={MapPin}
                            title="Regions"
                            subtitle="Region reference list used in alumni employment records"
                            count={regions.length}>
                            <div className="mb-4">
                                <AddItemRow
                                    placeholder="New region name (e.g. Region VI - Western Visayas)"
                                    onAdd={addRegion}
                                    extraTextPlaceholder="Code (e.g. R6)"
                                />
                            </div>
                            {filteredRegions.map(r => (
                                <EditableRow
                                    key={r.id}
                                    value={r.name}
                                    badge={r.code}
                                    onSave={name => updateRegion(r.id, name)}
                                    onDelete={() => removeRegion(r.id)}
                                />
                            ))}
                            {filteredRegions.length === 0 && (
                                <p className="text-gray-400 text-sm text-center py-4">No regions yet.</p>
                            )}
                        </Section>
                    </>
                )}
            </div>
        </PortalLayout>
    );
}