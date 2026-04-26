import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Check, X, AlertCircle, RefreshCw, Search,
  Tag, Briefcase, MapPin, FolderOpen, Building2, Inbox, Users, Shield,
} from 'lucide-react';
import { PortalLayout } from '../shared/portal-layout';
import {
  industriesApi,
  jobTitlesApi,
  regionsApi,
  skillCategoriesApi,
  skillsApi,
  useReferenceData,
  type IndustryItem,
  type JobTitleItem,
  type RegionItem,
  type SkillCategoryItem,
  type SkillItem,
} from '../../hooks/useReferenceData';
import {
  fetchAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  type AdminAccount,
} from '../../app/api-client';

type TabId = 'skills' | 'jobs' | 'regions' | 'users';

const TAB_DEFS: { id: TabId; label: string; Icon: typeof Tag }[] = [
  { id: 'skills', label: 'Skills', Icon: Tag },
  { id: 'jobs', label: 'Industries & Jobs', Icon: Briefcase },
  { id: 'regions', label: 'Regions', Icon: MapPin },
  { id: 'users', label: 'Users', Icon: Users },
];

// Master-rail selection: 'all', null (uncategorized), or a specific id.
type Selection = 'all' | null | string;

// ── Inline editable text (pencil → input) ───────────────────────────────────
function InlineEdit({
  value,
  onSave,
  className = '',
  inputClassName = '',
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className={`flex-1 rounded-lg border border-[#1B3A6B] bg-white px-2.5 py-1 text-sm outline-none ring-2 ring-[#1B3A6B]/15 ${inputClassName}`}
        />
        <button
          onClick={save}
          disabled={busy}
          className="flex size-7 items-center justify-center rounded-lg bg-[#1B3A6B] text-white hover:bg-[#142d54] disabled:opacity-60 transition"
          aria-label="Save"
        >
          {busy ? (
            <span className="size-3 border border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setErr('');
          }}
          className="flex size-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
        {err && <span className="text-rose-600 text-xs">{err}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`group flex items-center gap-1.5 text-left ${className}`}
    >
      <span className="text-sm text-gray-700">{value}</span>
      <Pencil className="size-3 text-gray-300 opacity-0 group-hover:opacity-100 transition" />
    </button>
  );
}

// ── Confirm-delete button (morphs in place) ─────────────────────────────────
function DeleteButton({
  onConfirm,
  size = 'sm',
}: {
  onConfirm: () => Promise<void>;
  size?: 'sm' | 'xs';
}) {
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Auto-cancel after 4s of no decision so the row doesn't get stuck.
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(t);
  }, [arming]);

  const dim = size === 'xs' ? 'size-6' : 'size-7';
  const ico = size === 'xs' ? 'size-3' : 'size-3.5';

  if (arming) {
    return (
      <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 rounded-lg px-1.5 py-0.5">
        <span className="text-[11px] text-rose-700" style={{ fontWeight: 600 }}>
          Delete?
        </span>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              setArming(false);
            }
          }}
          disabled={busy}
          className="flex size-5 items-center justify-center rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 transition"
          aria-label="Confirm delete"
        >
          {busy ? (
            <span className="size-2.5 border border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
        </button>
        <button
          onClick={() => setArming(false)}
          className="flex size-5 items-center justify-center rounded text-rose-700 hover:bg-rose-100 transition"
          aria-label="Cancel delete"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setArming(true)}
      className={`flex ${dim} items-center justify-center rounded-lg border border-gray-200 text-gray-400 opacity-60 hover:opacity-100 hover:text-rose-600 hover:border-rose-200 transition`}
      aria-label="Delete"
    >
      <Trash2 className={ico} />
    </button>
  );
}

// ── Master-rail row ─────────────────────────────────────────────────────────
function RailRow({
  active,
  label,
  count,
  onSelect,
  onRename,
  onDelete,
  muted = false,
}: {
  active: boolean;
  label: string;
  count: number;
  onSelect: () => void;
  onRename?: (name: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  muted?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer transition ${
        active
          ? 'bg-[#1B3A6B] text-white'
          : muted
            ? 'text-gray-500 hover:bg-gray-50'
            : 'text-gray-700 hover:bg-gray-50'
      }`}
      onClick={onSelect}
    >
      <span className="flex-1 text-sm truncate" style={{ fontWeight: active ? 600 : 500 }}>
        {label}
      </span>
      <span
        className={`text-[11px] px-1.5 py-0.5 rounded-full ${
          active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
        }`}
        style={{ fontWeight: 600 }}
      >
        {count}
      </span>
      {(onRename || onDelete) && active && (
        <span
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <InlineRenameTrigger value={label} onSave={onRename} dark />
          )}
          {onDelete && <DeleteButton size="xs" onConfirm={onDelete} />}
        </span>
      )}
    </div>
  );
}

// Compact pencil-only trigger that swaps to a small input. Used inside the
// active rail row (where the row is dark navy, hence the dark variant).
function InlineRenameTrigger({
  value,
  onSave,
  dark = false,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  dark?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`flex size-6 items-center justify-center rounded-lg transition ${
          dark
            ? 'text-white/70 hover:text-white hover:bg-white/10'
            : 'text-gray-400 hover:text-[#1B3A6B] hover:bg-gray-100'
        }`}
        aria-label="Rename"
      >
        <Pencil className="size-3" />
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="rounded-md bg-white text-gray-800 px-2 py-0.5 text-xs outline-none w-32"
      />
      <button
        onClick={save}
        disabled={busy}
        className="flex size-5 items-center justify-center rounded bg-white text-[#1B3A6B] hover:bg-white/90 disabled:opacity-60"
        aria-label="Save"
      >
        {busy ? (
          <span className="size-2.5 border border-[#1B3A6B]/30 border-t-[#1B3A6B] rounded-full animate-spin" />
        ) : (
          <Check className="size-3" />
        )}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="flex size-5 items-center justify-center rounded text-white/80 hover:bg-white/10"
        aria-label="Cancel"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

// ── Item-row: name + optional badge + edit + delete ─────────────────────────
function ItemRow({
  name,
  badge,
  badgeTone = 'gray',
  onRename,
  onDelete,
}: {
  name: string;
  badge?: string;
  badgeTone?: 'gray' | 'navy';
  onRename: (v: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 transition">
      <div className="flex-1 min-w-0">
        <InlineEdit value={name} onSave={onRename} className="w-full" />
      </div>
      {badge && (
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
            badgeTone === 'navy'
              ? 'bg-[#1B3A6B]/10 text-[#1B3A6B]'
              : 'bg-gray-100 text-gray-500'
          }`}
          style={{ fontWeight: 600 }}
        >
          {badge}
        </span>
      )}
      <DeleteButton onConfirm={onDelete} />
    </div>
  );
}

// ── Add-new input ───────────────────────────────────────────────────────────
function AddRow({
  placeholder,
  onAdd,
  selectOptions,
  selectLabel,
  forceSelect = false,
  selectedFixed,
  extraTextPlaceholder,
}: {
  placeholder: string;
  onAdd: (name: string, extra?: string) => Promise<void>;
  selectOptions?: { id: string; name: string }[];
  selectLabel?: string;
  /** If true, the user is required to pick a value from `selectOptions`. */
  forceSelect?: boolean;
  /** When set, hides the select; the value is always submitted as `extra`. */
  selectedFixed?: string;
  extraTextPlaceholder?: string;
}) {
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    if (forceSelect && !extra && !selectedFixed) {
      setErr('Pick a category first.');
      return;
    }
    if (extraTextPlaceholder && !extra.trim()) {
      setErr('Code is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const finalExtra = selectedFixed ?? (extra || undefined);
      await onAdd(
        name.trim(),
        extraTextPlaceholder ? extra.trim().toUpperCase() : finalExtra,
      );
      setName('');
      setExtra('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErr('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15 focus:bg-white"
        />
        {selectOptions && !selectedFixed && selectOptions.length > 0 && (
          <select
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-[#1B3A6B] focus:bg-white"
          >
            <option value="">{selectLabel ?? 'None'}</option>
            {selectOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        {extraTextPlaceholder && (
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={extraTextPlaceholder}
            className="w-32 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm placeholder-gray-400 outline-none transition focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15 focus:bg-white"
          />
        )}
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="flex items-center gap-1.5 bg-[#1B3A6B] hover:bg-[#142d54] text-white px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
          style={{ fontWeight: 600 }}
        >
          {busy ? (
            <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <Plus className="size-4" /> Add
            </>
          )}
        </button>
      </div>
      {err && (
        <p className="flex items-center gap-1.5 text-rose-600 text-xs">
          <AlertCircle className="size-3.5" /> {err}
        </p>
      )}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 text-gray-400">
      <Inbox className="size-8 mb-2 opacity-60" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export function AdminSettings() {
  const { data, loading, error: loadError, reload } = useReferenceData();

  // Local mirrors for optimistic UI (preserved from the previous version).
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [categories, setCategories] = useState<SkillCategoryItem[]>([]);
  const [industries, setIndustries] = useState<IndustryItem[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitleItem[]>([]);
  const [regions, setRegions] = useState<RegionItem[]>([]);

  const [tab, setTab] = useState<TabId>('skills');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Selection>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<Selection>('all');
  const [adminCount, setAdminCount] = useState(0);

  useEffect(() => {
    setSkills(data.skills);
    setCategories(data.skill_categories);
    setIndustries(data.industries);
    setJobTitles(data.job_titles);
    setRegions(data.regions);
  }, [data]);

  // Reset search when the user switches tabs.
  useEffect(() => {
    setSearch('');
  }, [tab]);

  const counts = useMemo(
    () => ({
      skills: skills.length,
      jobs: jobTitles.length,
      regions: regions.length,
      users: adminCount,
    }),
    [skills.length, jobTitles.length, regions.length, adminCount],
  );

  // ── CRUD: skills ──
  const addSkill = async (name: string, category_id?: string) => {
    const res = await skillsApi.create(name, category_id || null);
    setSkills((prev) => [...prev, res.skill].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const updateSkill = async (id: string, newName: string) => {
    const res = await skillsApi.update(id, { name: newName });
    setSkills((prev) => prev.map((s) => (s.id === id ? res.skill : s)));
  };
  const removeSkill = async (id: string) => {
    await skillsApi.remove(id);
    setSkills((prev) => prev.filter((s) => s.id !== id));
  };

  // ── CRUD: categories ──
  const addCategory = async (name: string) => {
    const res = await skillCategoriesApi.create(name);
    setCategories((prev) =>
      [...prev, res.category].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };
  const renameCategory = async (id: string, newName: string) => {
    const res = await skillCategoriesApi.update(id, { name: newName });
    setCategories((prev) => prev.map((c) => (c.id === id ? res.category : c)));
    setSkills((prev) =>
      prev.map((s) => (s.category === id ? { ...s, category_name: res.category.name } : s)),
    );
  };
  const removeCategory = async (id: string) => {
    await skillCategoriesApi.remove(id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setSkills((prev) =>
      prev.map((s) =>
        s.category === id ? { ...s, category: null, category_name: null } : s,
      ),
    );
    setSelectedCategory('all');
  };

  // ── CRUD: industries ──
  const addIndustry = async (name: string) => {
    const res = await industriesApi.create(name);
    setIndustries((prev) =>
      [...prev, res.industry].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };
  const renameIndustry = async (id: string, newName: string) => {
    const res = await industriesApi.update(id, { name: newName });
    setIndustries((prev) => prev.map((i) => (i.id === id ? res.industry : i)));
    setJobTitles((prev) =>
      prev.map((j) => (j.industry === id ? { ...j, industry_name: res.industry.name } : j)),
    );
  };
  const removeIndustry = async (id: string) => {
    await industriesApi.remove(id);
    setIndustries((prev) => prev.filter((i) => i.id !== id));
    setJobTitles((prev) =>
      prev.map((j) => (j.industry === id ? { ...j, industry: null, industry_name: null } : j)),
    );
    setSelectedIndustry('all');
  };

  // ── CRUD: job titles ──
  const addJobTitle = async (name: string, industry_id?: string) => {
    const res = await jobTitlesApi.create(name, industry_id || null);
    setJobTitles((prev) =>
      [...prev, res.job_title].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };
  const updateJobTitle = async (id: string, newName: string) => {
    const res = await jobTitlesApi.update(id, { name: newName });
    setJobTitles((prev) => prev.map((j) => (j.id === id ? res.job_title : j)));
  };
  const removeJobTitle = async (id: string) => {
    await jobTitlesApi.remove(id);
    setJobTitles((prev) => prev.filter((j) => j.id !== id));
  };

  // ── CRUD: regions ──
  const addRegion = async (name: string, code?: string) => {
    const norm = (code ?? '').trim().toUpperCase();
    if (!norm) throw new Error('Region code is required.');
    const res = await regionsApi.create(name, norm);
    setRegions((prev) => [...prev, res.region].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const renameRegion = async (id: string, newName: string) => {
    const res = await regionsApi.update(id, { name: newName });
    setRegions((prev) => prev.map((r) => (r.id === id ? res.region : r)));
  };
  const removeRegion = async (id: string) => {
    await regionsApi.remove(id);
    setRegions((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <PortalLayout
      role="admin"
      pageTitle="Reference Settings"
      pageSubtitle="Manage skills, industries, job titles, and regions used across the system"
    >
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Tab nav (matches admin-analytics.tsx pattern) */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Settings tabs">
            {TAB_DEFS.map(({ id, label, Icon }) => {
              const active = tab === id;
              const c = counts[id];
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm transition whitespace-nowrap ${
                    active
                      ? 'border-[#1B3A6B] text-[#1B3A6B]'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={{ fontWeight: active ? 700 : 500 }}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="size-4" />
                  {label}
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      active ? 'bg-[#1B3A6B]/10 text-[#1B3A6B]' : 'bg-gray-100 text-gray-500'
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {c}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Search + reload row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab === 'jobs' ? 'industries & jobs' : tab}…`}
              className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15"
            />
          </div>
          <button
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
            style={{ fontWeight: 500 }}
          >
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
          <div className="flex items-center justify-center py-20">
            <span className="size-8 border-4 border-[#1B3A6B]/20 border-t-[#1B3A6B] rounded-full animate-spin" />
          </div>
        ) : tab === 'skills' ? (
          <SkillsView
            skills={skills}
            categories={categories}
            search={search}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onDeleteCategory={removeCategory}
            onAddSkill={addSkill}
            onRenameSkill={updateSkill}
            onDeleteSkill={removeSkill}
          />
        ) : tab === 'jobs' ? (
          <JobsView
            industries={industries}
            jobs={jobTitles}
            search={search}
            selected={selectedIndustry}
            onSelect={setSelectedIndustry}
            onAddIndustry={addIndustry}
            onRenameIndustry={renameIndustry}
            onDeleteIndustry={removeIndustry}
            onAddJob={addJobTitle}
            onRenameJob={updateJobTitle}
            onDeleteJob={removeJobTitle}
          />
        ) : tab === 'regions' ? (
          <RegionsView
            regions={regions}
            search={search}
            onAdd={addRegion}
            onRename={renameRegion}
            onDelete={removeRegion}
          />
        ) : (
          <UsersView search={search} onCountChange={setAdminCount} />
        )}
      </div>
    </PortalLayout>
  );
}

// ── Skills tab ──────────────────────────────────────────────────────────────
function SkillsView({
  skills,
  categories,
  search,
  selected,
  onSelect,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onAddSkill,
  onRenameSkill,
  onDeleteSkill,
}: {
  skills: SkillItem[];
  categories: SkillCategoryItem[];
  search: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onAddCategory: (name: string) => Promise<void>;
  onRenameCategory: (id: string, name: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onAddSkill: (name: string, categoryId?: string) => Promise<void>;
  onRenameSkill: (id: string, name: string) => Promise<void>;
  onDeleteSkill: (id: string) => Promise<void>;
}) {
  const q = search.trim().toLowerCase();

  const matchedSkills = useMemo(
    () => (q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills),
    [skills, q],
  );

  const matchedCategories = useMemo(
    () => (q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories),
    [categories, q],
  );

  const uncategorizedCount = matchedSkills.filter((s) => !s.category).length;

  const visibleSkills = useMemo(() => {
    if (selected === 'all') return matchedSkills;
    if (selected === null) return matchedSkills.filter((s) => !s.category);
    return matchedSkills.filter((s) => s.category === selected);
  }, [matchedSkills, selected]);

  const selectedCategory =
    typeof selected === 'string' && selected !== 'all'
      ? categories.find((c) => c.id === selected)
      : null;

  const headerLabel =
    selected === 'all'
      ? 'All skills'
      : selected === null
        ? 'Uncategorized'
        : (selectedCategory?.name ?? '—');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Master rail */}
      <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center gap-2 px-3 py-2 mb-1">
          <FolderOpen className="size-4 text-[#1B3A6B]" />
          <h3 className="text-sm text-gray-800" style={{ fontWeight: 700 }}>
            Categories
          </h3>
        </div>
        <div className="space-y-0.5">
          <RailRow
            active={selected === 'all'}
            label="All skills"
            count={matchedSkills.length}
            onSelect={() => onSelect('all')}
          />
          {matchedCategories.map((c) => (
            <RailRow
              key={c.id}
              active={selected === c.id}
              label={c.name}
              count={matchedSkills.filter((s) => s.category === c.id).length}
              onSelect={() => onSelect(c.id)}
              onRename={(name) => onRenameCategory(c.id, name)}
              onDelete={() => onDeleteCategory(c.id)}
            />
          ))}
          {uncategorizedCount > 0 && (
            <RailRow
              active={selected === null}
              label="Uncategorized"
              count={uncategorizedCount}
              onSelect={() => onSelect(null)}
              muted
            />
          )}
        </div>
        <div className="border-t border-gray-100 mt-3 pt-3 px-1">
          <p className="text-[11px] text-gray-400 px-2 mb-1.5" style={{ fontWeight: 600 }}>
            NEW CATEGORY
          </p>
          <AddRow
            placeholder="e.g. Cloud & DevOps"
            onAdd={(name) => onAddCategory(name)}
          />
        </div>
      </div>

      {/* Detail pane */}
      <div className="lg:col-span-8 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
              {headerLabel}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {visibleSkills.length} skill{visibleSkills.length === 1 ? '' : 's'}
              {selected === 'all' && ' · pick a category to scope new skills there'}
            </p>
          </div>
        </div>

        <AddRow
          placeholder="New skill (e.g. Cloud Computing)"
          onAdd={(name, extra) => onAddSkill(name, extra)}
          selectOptions={selected === 'all' ? categories : undefined}
          selectLabel="Category (optional)"
          selectedFixed={typeof selected === 'string' && selected !== 'all' ? selected : undefined}
        />

        <div className="mt-4 space-y-0.5">
          {visibleSkills.length === 0 ? (
            <EmptyState
              message={
                q
                  ? 'No skills match that search.'
                  : selected === 'all'
                    ? 'No skills yet — add the first one above.'
                    : 'No skills in this category yet.'
              }
            />
          ) : (
            visibleSkills.map((s) => (
              <ItemRow
                key={s.id}
                name={s.name}
                badge={selected === 'all' && s.category_name ? s.category_name : undefined}
                onRename={(name) => onRenameSkill(s.id, name)}
                onDelete={() => onDeleteSkill(s.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Industries & Jobs tab ───────────────────────────────────────────────────
function JobsView({
  industries,
  jobs,
  search,
  selected,
  onSelect,
  onAddIndustry,
  onRenameIndustry,
  onDeleteIndustry,
  onAddJob,
  onRenameJob,
  onDeleteJob,
}: {
  industries: IndustryItem[];
  jobs: JobTitleItem[];
  search: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onAddIndustry: (name: string) => Promise<void>;
  onRenameIndustry: (id: string, name: string) => Promise<void>;
  onDeleteIndustry: (id: string) => Promise<void>;
  onAddJob: (name: string, industryId?: string) => Promise<void>;
  onRenameJob: (id: string, name: string) => Promise<void>;
  onDeleteJob: (id: string) => Promise<void>;
}) {
  const q = search.trim().toLowerCase();

  const matchedJobs = useMemo(
    () => (q ? jobs.filter((j) => j.name.toLowerCase().includes(q)) : jobs),
    [jobs, q],
  );
  const matchedIndustries = useMemo(
    () => (q ? industries.filter((i) => i.name.toLowerCase().includes(q)) : industries),
    [industries, q],
  );

  const noIndustryCount = matchedJobs.filter((j) => !j.industry).length;

  const visibleJobs = useMemo(() => {
    if (selected === 'all') return matchedJobs;
    if (selected === null) return matchedJobs.filter((j) => !j.industry);
    return matchedJobs.filter((j) => j.industry === selected);
  }, [matchedJobs, selected]);

  const selectedIndustry =
    typeof selected === 'string' && selected !== 'all'
      ? industries.find((i) => i.id === selected)
      : null;

  const headerLabel =
    selected === 'all'
      ? 'All job titles'
      : selected === null
        ? 'No industry'
        : (selectedIndustry?.name ?? '—');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Master rail — industries */}
      <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center gap-2 px-3 py-2 mb-1">
          <Building2 className="size-4 text-[#1B3A6B]" />
          <h3 className="text-sm text-gray-800" style={{ fontWeight: 700 }}>
            Industries
          </h3>
        </div>
        <div className="space-y-0.5">
          <RailRow
            active={selected === 'all'}
            label="All job titles"
            count={matchedJobs.length}
            onSelect={() => onSelect('all')}
          />
          {matchedIndustries.map((i) => (
            <RailRow
              key={i.id}
              active={selected === i.id}
              label={i.name}
              count={matchedJobs.filter((j) => j.industry === i.id).length}
              onSelect={() => onSelect(i.id)}
              onRename={(name) => onRenameIndustry(i.id, name)}
              onDelete={() => onDeleteIndustry(i.id)}
            />
          ))}
          {noIndustryCount > 0 && (
            <RailRow
              active={selected === null}
              label="No industry"
              count={noIndustryCount}
              onSelect={() => onSelect(null)}
              muted
            />
          )}
        </div>
        <div className="border-t border-gray-100 mt-3 pt-3 px-1">
          <p className="text-[11px] text-gray-400 px-2 mb-1.5" style={{ fontWeight: 600 }}>
            NEW INDUSTRY
          </p>
          <AddRow
            placeholder="e.g. Fintech"
            onAdd={(name) => onAddIndustry(name)}
          />
        </div>
      </div>

      {/* Detail pane — job titles */}
      <div className="lg:col-span-8 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="mb-4">
          <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
            {headerLabel}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {visibleJobs.length} job title{visibleJobs.length === 1 ? '' : 's'}
            {selected === 'all' && ' · pick an industry to scope new jobs there'}
          </p>
        </div>

        <AddRow
          placeholder="New job title (e.g. Systems Analyst)"
          onAdd={(name, extra) => onAddJob(name, extra)}
          selectOptions={selected === 'all' ? industries : undefined}
          selectLabel="Industry (optional)"
          selectedFixed={typeof selected === 'string' && selected !== 'all' ? selected : undefined}
        />

        <div className="mt-4 space-y-0.5">
          {visibleJobs.length === 0 ? (
            <EmptyState
              message={
                q
                  ? 'No job titles match that search.'
                  : selected === 'all'
                    ? 'No job titles yet — add the first one above.'
                    : 'No job titles for this industry yet.'
              }
            />
          ) : (
            visibleJobs.map((j) => (
              <ItemRow
                key={j.id}
                name={j.name}
                badge={selected === 'all' && j.industry_name ? j.industry_name : undefined}
                onRename={(name) => onRenameJob(j.id, name)}
                onDelete={() => onDeleteJob(j.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Regions tab ─────────────────────────────────────────────────────────────
function RegionsView({
  regions,
  search,
  onAdd,
  onRename,
  onDelete,
}: {
  regions: RegionItem[];
  search: string;
  onAdd: (name: string, code?: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const q = search.trim().toLowerCase();
  const visible = q
    ? regions.filter(
        (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q),
      )
    : regions;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-w-3xl">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="size-4 text-[#1B3A6B]" />
        <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
          Regions
        </h3>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500" style={{ fontWeight: 600 }}>
          {visible.length}
        </span>
      </div>

      <AddRow
        placeholder="Region name (e.g. Region VI - Western Visayas)"
        onAdd={(name, code) => onAdd(name, code)}
        extraTextPlaceholder="Code (e.g. R6)"
      />

      <div className="mt-4 space-y-0.5">
        {visible.length === 0 ? (
          <EmptyState
            message={q ? 'No regions match that search.' : 'No regions yet — add the first one above.'}
          />
        ) : (
          visible.map((r) => (
            <ItemRow
              key={r.id}
              name={r.name}
              badge={r.code}
              badgeTone="navy"
              onRename={(name) => onRename(r.id, name)}
              onDelete={() => onDelete(r.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Users tab ───────────────────────────────────────────────────────────────
function UsersView({
  search,
  onCountChange,
}: {
  search: string;
  onCountChange: (n: number) => void;
}) {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const currentUserId = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('admin_user');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { id?: unknown };
      return typeof parsed?.id === 'string' ? parsed.id : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdmins()
      .then((rows) => {
        if (cancelled) return;
        setAdmins(rows);
        onCountChange(rows.length);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load admins.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onCountChange]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? admins.filter((a) => a.email.toLowerCase().includes(q)) : admins),
    [admins, q],
  );

  const handleCreate = async (input: { email: string; password: string }) => {
    const created = await createAdmin(input);
    setAdmins((prev) => {
      const next = [...prev, created];
      onCountChange(next.length);
      return next;
    });
    setAdding(false);
  };

  const handleUpdate = async (
    id: string,
    patch: Partial<{ email: string; password: string; is_active: boolean }>,
  ) => {
    const updated = await updateAdmin(id, patch);
    setAdmins((prev) => prev.map((a) => (a.id === id ? updated : a)));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteAdmin(id);
    setAdmins((prev) => {
      const next = prev.filter((a) => a.id !== id);
      onCountChange(next.length);
      return next;
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-[#1B3A6B]" />
          <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
            Admins
          </h3>
          <span
            className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500"
            style={{ fontWeight: 600 }}
          >
            {admins.length}
          </span>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 bg-[#1B3A6B] text-white px-3 py-1.5 rounded-lg text-sm hover:bg-[#16315a] transition"
            style={{ fontWeight: 600 }}
          >
            <Plus className="size-3.5" /> Add admin
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl p-3.5 mb-3">
          <AlertCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-rose-700 text-sm">{error}</p>
        </div>
      )}

      {adding && (
        <AdminAddForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="size-6 border-4 border-[#1B3A6B]/20 border-t-[#1B3A6B] rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          message={
            q
              ? 'No admins match that search.'
              : 'No admins yet — add one to share access.'
          }
        />
      ) : (
        <div className="space-y-1.5">
          {visible.map((a) =>
            editingId === a.id ? (
              <AdminEditForm
                key={a.id}
                admin={a}
                onSubmit={(patch) => handleUpdate(a.id, patch)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <AdminRow
                key={a.id}
                admin={a}
                isCurrentUser={a.user_id === currentUserId}
                onEdit={() => setEditingId(a.id)}
                onDelete={() => handleDelete(a.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function AdminRow({
  admin,
  isCurrentUser,
  onEdit,
  onDelete,
}: {
  admin: AdminAccount;
  isCurrentUser: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 transition">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-9 items-center justify-center rounded-full bg-[#1B3A6B]/10 text-[#1B3A6B] shrink-0">
          <Shield className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-900 truncate" style={{ fontWeight: 600 }}>
            {admin.email}
            {isCurrentUser && (
              <span className="ml-2 text-[10px] text-[#1B3A6B] bg-[#1B3A6B]/10 px-1.5 py-0.5 rounded-full" style={{ fontWeight: 600 }}>
                you
              </span>
            )}
          </p>
          <p className="text-[11px] text-gray-400">
            <span
              className={`inline-block size-1.5 rounded-full mr-1.5 align-middle ${
                admin.is_active ? 'bg-emerald-500' : 'bg-gray-300'
              }`}
            />
            {admin.is_active ? 'Active' : 'Inactive'} · Created {formatDate(admin.created_at)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onEdit}
          className="flex size-7 items-center justify-center rounded-lg border border-gray-200 text-gray-400 opacity-60 hover:opacity-100 hover:text-[#1B3A6B] hover:border-[#1B3A6B]/30 transition"
          aria-label="Edit"
        >
          <Pencil className="size-3.5" />
        </button>
        {isCurrentUser ? (
          <button
            disabled
            title="You can't remove your own admin access."
            className="flex size-7 items-center justify-center rounded-lg border border-gray-200 text-gray-300 cursor-not-allowed"
            aria-label="Delete (disabled)"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : (
          <DeleteButton onConfirm={onDelete} />
        )}
      </div>
    </div>
  );
}

function AdminAddForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErr('Enter a valid email.');
      return;
    }
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSubmit({ email: trimmed, password });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create admin.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-[#1B3A6B]/20 bg-[#1B3A6B]/[0.03] rounded-xl p-3.5 mb-3">
      <p className="text-[11px] text-[#1B3A6B] mb-2" style={{ fontWeight: 700 }}>
        NEW ADMIN
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input
          autoFocus
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min. 8 chars)"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </div>
      {err && <p className="text-xs text-rose-600 mb-2">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 bg-[#1B3A6B] text-white px-3 py-1.5 rounded-lg text-sm hover:bg-[#16315a] disabled:opacity-60 transition"
          style={{ fontWeight: 600 }}
        >
          {busy ? (
            <span className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Create
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60 transition"
          style={{ fontWeight: 500 }}
        >
          <X className="size-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

function AdminEditForm({
  admin,
  onSubmit,
  onCancel,
}: {
  admin: AdminAccount;
  onSubmit: (
    patch: Partial<{ email: string; password: string; is_active: boolean }>,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(admin.email);
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(admin.is_active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const patch: Partial<{ email: string; password: string; is_active: boolean }> = {};
    const trimmed = email.trim().toLowerCase();

    if (trimmed !== admin.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setErr('Enter a valid email.');
        return;
      }
      patch.email = trimmed;
    }
    if (password) {
      if (password.length < 8) {
        setErr('Password must be at least 8 characters.');
        return;
      }
      patch.password = password;
    }
    if (isActive !== admin.is_active) {
      patch.is_active = isActive;
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSubmit(patch);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update admin.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-[#1B3A6B]/30 bg-[#1B3A6B]/[0.03] rounded-xl p-3.5">
      <p className="text-[11px] text-[#1B3A6B] mb-2" style={{ fontWeight: 700 }}>
        EDIT ADMIN
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input
          autoFocus
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank to keep current"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/15"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-gray-700 mb-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="size-4 accent-[#1B3A6B]"
        />
        Active
      </label>
      {err && <p className="text-xs text-rose-600 mb-2">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 bg-[#1B3A6B] text-white px-3 py-1.5 rounded-lg text-sm hover:bg-[#16315a] disabled:opacity-60 transition"
          style={{ fontWeight: 600 }}
        >
          {busy ? (
            <span className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Save
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60 transition"
          style={{ fontWeight: 500 }}
        >
          <X className="size-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}
