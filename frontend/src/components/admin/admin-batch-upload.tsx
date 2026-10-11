import { useState, useRef, useEffect, useCallback } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import {
  createMasterlistEntries, deleteMasterlistEntry, fetchMasterlist, updateMasterlistEntry,
  renameMasterlistYear, deleteMasterlistYear,
  type MasterlistEntry,
} from '../../app/api-client';
import {
  Upload, CheckCircle2, AlertCircle, FileText, Plus, Trash2,
  Download, Info, Save, X, User, Calendar, Pencil, MoreHorizontal, Settings,
} from 'lucide-react';

interface BatchEntry {
  name: string;
  graduationYear: string;
}

const currentYear = new Date().getFullYear();
const YEAR_RANGE = Array.from({ length: currentYear - 2019 }, (_, i) => 2020 + i);

// Mirrors MasterlistBulkCreateView. A report CSV uploaded here once saved rows
// like "Avg Time-to-Hire (mo)" / batch 2 and "2021" / batch 6.
// The study covers batches from 2020. Mirrors MASTERLIST_MIN_YEAR.
const MIN_GRAD_YEAR = 2020;
const MAX_GRAD_YEAR = currentYear + 1;

/** Why a row can't go in the master list, or null when it looks valid. */
function masterRowProblem(name: string, year: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'missing name';
  if (!/\p{L}/u.test(trimmed) || trimmed.split(/\s+/).length < 2) {
    return `"${trimmed}" is not a full name (first and last)`;
  }
  const yearNum = Number(year.trim());
  if (!year.trim() || !Number.isInteger(yearNum)) return 'invalid graduation year';
  if (yearNum < MIN_GRAD_YEAR || yearNum > MAX_GRAD_YEAR) {
    return `graduation year ${yearNum} is outside ${MIN_GRAD_YEAR}–${MAX_GRAD_YEAR}`;
  }
  return null;
}

const TEMPLATE_CSV = `name,graduationYear
Juan dela Cruz,2024
Maria Reyes,2024
Pedro Santos,2025`;

/** Whether this masterlist graduate has an account in the system.
 *
 *  Nothing is drawn for the unregistered case on purpose: that is 523 of 525
 *  rows, so badging it spent a chip on every line to state the norm and left the
 *  name a few characters wide. The exception is what deserves the ink; the
 *  filter above and the "not yet registered" count cover the rest. */
function RegistrationBadge({ status }: { status: MasterlistEntry['accountStatus'] }) {
  if (!status) return null;
  // Each state named for what it is. "rejected" used to render as
  // "Registered · rejected", which reads as a contradiction: the person was
  // turned down, not registered.
  const look = status === 'active'
    ? { text: 'Registered', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : status === 'rejected'
      ? { text: 'Rejected', cls: 'bg-red-50 text-red-600 border-red-200' }
      : status === 'pending'
        ? { text: 'Awaiting review', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
        : { text: String(status), cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${look.cls}`} style={{ fontWeight: 600 }}>
      {look.text}
    </span>
  );
}

/** The per-row edit / retire / delete menu. Collapsed to one button so the
 *  graduate's name owns the row; the actions are a tap away rather than three
 *  permanent controls competing with it. */
function RowActions({ entry, busy, onEdit, onRemove }: {
  entry: MasterlistEntry;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A graduate has registered against this entry, so deleting it would orphan
  // their account; retiring is the safe equivalent.
  const locked = Boolean(entry.accountStatus);

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={`Actions for ${entry.name}`}
        aria-expanded={open}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <button onClick={() => { setOpen(false); onEdit(); }} className={`${item} text-gray-700`}>
            <Pencil className="size-3.5" /> Edit name or batch
          </button>
          <button
            onClick={() => { setOpen(false); onRemove(); }}
            disabled={busy || locked}
            title={locked
              ? `A graduate is registered against this entry (${entry.accountStatus}), so it cannot be deleted`
              : undefined}
            className={`${item} text-red-600`}
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminBatchUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'csv' | 'manual'>('csv');
  /** UI stage for the CSV flow:
   *   'pick'     -> waiting for the admin to pick a file
   *   'review'   -> CSV parsed; the admin is reviewing / editing the preview
   *   'saved'    -> rows persisted to the DB
   */
  const [csvStage, setCsvStage] = useState<'pick' | 'review' | 'saved'>('pick');
  const [importedCount, setImportedCount] = useState(0);
  const [importedEntries, setImportedEntries] = useState<BatchEntry[]>([]);
  const [savedSummary, setSavedSummary] = useState<{ created: number; skipped: number } | null>(null);
  /** Rows sent so far / total, while a chunked upload is in flight. */
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  /** Names already on file, shown for confirmation before anything is written. */
  const [dupePreview, setDupePreview] = useState<{ name: string; graduationYear: string }[] | null>(null);
  const [csvError, setCsvError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [manualEntries, setManualEntries] = useState<BatchEntry[]>([
    { name: '', graduationYear: '' },
  ]);

  // Live master-list counts from the database (the page used to read a static
  // array, which showed 0).
  const [masterTotal, setMasterTotal] = useState<number | null>(null);
  const [masterPerBatch, setMasterPerBatch] = useState<Record<number, number>>({});
  const [masterEntries, setMasterEntries] = useState<MasterlistEntry[]>([]);
  const [showMasterList, setShowMasterList] = useState(false);
  const [masterSearch, setMasterSearch] = useState('');
  const [masterFilter, setMasterFilter] = useState<'all' | 'registered' | 'unregistered'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editYear, setEditYear] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [masterNotice, setMasterNotice] = useState('');
  const [masterError, setMasterError] = useState('');
  const refreshMasterlist = useCallback(() => {
    fetchMasterlist()
      .then((d) => {
        setMasterTotal(d.total);
        setMasterEntries(d.entries);
        const m: Record<number, number> = {};
        for (const b of d.perBatch) m[b.year] = b.count;
        setMasterPerBatch(m);
      })
      .catch(() => { /* keep static fallback */ });
  }, []);
  useEffect(() => { refreshMasterlist(); }, [refreshMasterlist]);

  const registeredCount = masterEntries.filter(m => m.accountStatus).length;
  const filteredMaster = masterEntries.filter(m =>
    (masterFilter === 'all' || (masterFilter === 'registered') === Boolean(m.accountStatus))
    && (!masterSearch.trim() || m.name.toLowerCase().includes(masterSearch.trim().toLowerCase())
      || String(m.graduationYear ?? '').includes(masterSearch.trim())));

  const totalMaster = masterTotal ?? 0;
  // Tiles follow the batches actually on file (e.g. 2019), not only 2020 onward,
  // so they add up to the total. Implausible years are left out.
  const tileYears = Array.from(new Set([
    ...YEAR_RANGE,
    ...Object.keys(masterPerBatch).map(Number).filter(y => y >= MIN_GRAD_YEAR && y <= MAX_GRAD_YEAR),
  ])).sort((a, b) => a - b);
  const batchCount = (yr: number) =>
    masterPerBatch[yr] ?? 0;
  const [manualSaved, setManualSaved] = useState(false);
  const [manualError, setManualError] = useState('');
  const [yearMenuOpen, setYearMenuOpen] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [yearMenuError, setYearMenuError] = useState('');
  const [renameYear, setRenameYear] = useState<{ from: number; to: string } | null>(null);
  const [yearBusy, setYearBusy] = useState(false);
  // Batch years an admin opened before any graduate carries one, so a new batch
  // can be seen and filled before its CSV exists.
  //
  // localStorage, not a table: a year has no fields of its own, so a table would
  // store nothing but its own primary key. The moment one record exists the year
  // comes back from the database for every admin; until then it is one person's
  // working state. Survives reloads, which component state did not.
  const [openedYears, setOpenedYears] = useState<number[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('gt.openedBatchYears') ?? '[]');
      if (Array.isArray(saved)) setOpenedYears(saved.filter((y: unknown) => typeof y === 'number'));
    } catch { /* a cleared or blocked store just means no extra years */ }
  }, []);
  const persistOpenedYears = (years: number[]) => {
    setOpenedYears(years);
    try {
      localStorage.setItem('gt.openedBatchYears', JSON.stringify(years));
    } catch { /* private window: the years still work for this session */ }
  };

  // Tiles and the manual-entry dropdown both show the batches on file plus the
  // ones opened by hand. The dropdown used to read YEAR_RANGE (2020 onward), so
  // 2019 could not be picked even though 98 rows on file are 2019.
  const shownYears = Array.from(new Set([...tileYears, ...openedYears]))
    .filter(y => y >= MIN_GRAD_YEAR && y <= MAX_GRAD_YEAR)
    .sort((a, b) => a - b);
  const selectableYears = shownYears;

  const addBatchYear = () => {
    const year = Number(newYear);
    if (!year || year < MIN_GRAD_YEAR || year > MAX_GRAD_YEAR) {
      setYearMenuError(`Year must be between ${MIN_GRAD_YEAR} and ${MAX_GRAD_YEAR}.`);
      return;
    }
    if (shownYears.includes(year)) {
      setYearMenuError(`Batch ${year} is already listed.`);
      return;
    }
    setYearMenuError('');
    persistOpenedYears([...openedYears, year]);
    setNewYear('');
  };

  /** Move every record of one batch to another year. */
  const applyRenameYear = async () => {
    if (!renameYear) return;
    const target = Number(renameYear.to);
    if (!target || target < MIN_GRAD_YEAR || target > MAX_GRAD_YEAR) {
      setYearMenuError(`Year must be between ${MIN_GRAD_YEAR} and ${MAX_GRAD_YEAR}.`);
      return;
    }
    setYearBusy(true);
    setYearMenuError('');
    try {
      const res = await renameMasterlistYear(renameYear.from, target);
      // The year was opened by hand and has now moved, so carry the marker with
      // it -- otherwise the old empty year keeps a tile and the new one loses it.
      persistOpenedYears(
        openedYears.map(y => (y === renameYear.from ? target : y)).filter((y, i, a) => a.indexOf(y) === i),
      );
      setRenameYear(null);
      setManualError('');
      setManualSaved(false);
      refreshMasterlist();
      setYearMenuError(`Moved ${res.moved} record(s) from ${res.from} to ${res.to}.`);
    } catch (err) {
      setYearMenuError(err instanceof Error ? err.message : 'Could not move that batch.');
    } finally {
      setYearBusy(false);
    }
  };

  /** Close an empty batch year, or delete every record in a populated one. */
  const removeBatchYear = async (year: number) => {
    const count = batchCount(year);
    if (count === 0) {
      persistOpenedYears(openedYears.filter(y => y !== year));
      setYearMenuError('');
      return;
    }
    if (!window.confirm(
      `Delete all ${count} master list record(s) in batch ${year}? This cannot be undone.`,
    )) return;
    setYearBusy(true);
    setYearMenuError('');
    try {
      const res = await deleteMasterlistYear(year);
      persistOpenedYears(openedYears.filter(y => y !== year));
      refreshMasterlist();
      setYearMenuError(`Deleted ${res.deleted} record(s) from batch ${year}.`);
    } catch (err) {
      setYearMenuError(err instanceof Error ? err.message : 'Could not delete that batch.');
    } finally {
      setYearBusy(false);
    }
  };

  const parseCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError('');
    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = (reader.result as string).replace(/^\uFEFF/, '');
        const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (rawLines.length === 0) {
          setCsvError('CSV file is empty.');
          setIsProcessing(false);
          return;
        }

        const header = parseCsvLine(rawLines[0]).map(h => h.toLowerCase().replace(/\s+/g, ''));
        const nameIdx = header.findIndex(h => h === 'name' || h === 'fullname');
        const yearIdx = header.findIndex(h => h === 'graduationyear' || h === 'year' || h === 'batch');

        // The whole file is refused unless it is clearly a master list. A report
        // CSV uploaded here once put "Total" and "2021" into the graduate list,
        // so bad rows are never skipped quietly and the rest kept.
        const refuse = (message: string) => {
          setCsvError(message);
          setIsProcessing(false);
          if (fileRef.current) fileRef.current.value = '';
        };
        const usedHeaders = header.filter(Boolean);
        if (nameIdx < 0 || yearIdx < 0 || usedHeaders.length !== 2) {
          refuse(`File refused: this is not a master list CSV. The first row must be exactly "name,graduationYear" (found "${rawLines[0].slice(0, 60)}").`);
          return;
        }

        const entries: BatchEntry[] = [];
        const errors: string[] = [];
        const seen = new Set<string>();

        for (let i = 1; i < rawLines.length; i++) {
          const cols = parseCsvLine(rawLines[i]);
          const name = (cols[nameIdx] ?? '').replace(/\s+/g, ' ').trim();
          const graduationYear = (cols[yearIdx] ?? '').trim();
          const problem = masterRowProblem(name, graduationYear);
          if (problem) { errors.push(`Row ${i + 1}: ${problem}`); continue; }
          if (cols.filter(c => c.trim()).length > 2) { errors.push(`Row ${i + 1}: has extra columns`); continue; }
          const key = `${name.toLowerCase()}|${graduationYear}`;
          if (seen.has(key)) { errors.push(`Row ${i + 1}: "${name}" is listed twice`); continue; }
          seen.add(key);
          entries.push({ name, graduationYear });
        }

        if (errors.length > 0) {
          refuse(`File refused, nothing was imported. ${errors.length} row(s) need fixing: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? '; …' : ''}`);
          return;
        }
        if (entries.length === 0) {
          refuse('File refused: it has a header row but no graduates.');
          return;
        }

        setImportedEntries(entries);
        setImportedCount(entries.length);
        setCsvStage('review');
        setSavedSummary(null);
        setIsProcessing(false);
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV.');
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
      setCsvError('Failed to read file. Please try again.');
      setIsProcessing(false);
    };
    reader.readAsText(file);
  };

  const downloadCsv = (text: string, filename: string) => {
    // BOM so Excel opens accented names (Peña) correctly.
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => downloadCsv(TEMPLATE_CSV, 'CHMSU_BSIS_Batch_Template.csv');

  /** The whole master list as it stands, including who has registered. */
  const exportMasterlist = () => {
    const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      ['Name', 'Batch', 'In System', 'Status'],
      ...masterEntries.map(m => [
        m.name,
        String(m.graduationYear ?? ''),
        m.accountStatus ? 'Yes' : 'No',
        m.isActive ? 'Active' : 'Retired',
      ]),
    ];
    downloadCsv(
      rows.map(r => r.map(cell).join(',')).join('\r\n'),
      `CHMSU_BSIS_Masterlist_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const startEdit = (m: MasterlistEntry) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditYear(String(m.graduationYear ?? ''));
    setMasterError('');
    setMasterNotice('');
  };

  /** Save a corrected name / batch. The backend re-runs the masterlist match. */
  const saveEdit = async (m: MasterlistEntry) => {
    const problem = masterRowProblem(editName, editYear);
    if (problem) { setMasterError(`Cannot save: ${problem}.`); return; }
    setRowBusy(m.id);
    setMasterError('');
    try {
      const { rematched } = await updateMasterlistEntry(m.id, {
        name: editName.trim().replace(/\s+/g, ' '),
        graduationYear: Number(editYear),
      });
      setEditingId(null);
      setMasterNotice(rematched > 0
        ? `Saved. ${rematched} graduate${rematched === 1 ? '' : 's'} now matched to the master list.`
        : 'Saved.');
      refreshMasterlist();
    } catch (err) {
      setMasterError(err instanceof Error ? err.message : 'Could not save that entry.');
    } finally {
      setRowBusy(null);
    }
  };

  /** Delete for good. The backend refuses rows a graduate registered against. */
  const removeEntry = async (m: MasterlistEntry) => {
    if (!window.confirm(`Delete "${m.name}" (batch ${m.graduationYear ?? '—'}) from the master list? This cannot be undone.`)) return;
    setRowBusy(m.id);
    setMasterError('');
    try {
      await deleteMasterlistEntry(m.id);
      setMasterNotice(`${m.name} deleted.`);
      refreshMasterlist();
    } catch (err) {
      setMasterError(err instanceof Error ? err.message : 'Could not delete that entry.');
    } finally {
      setRowBusy(null);
    }
  };

  /** Inline-edit a row in the parsed preview table before save. */
  const editImportedEntry = (i: number, key: keyof BatchEntry, value: string) => {
    setImportedEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [key]: value } : e));
  };

  /** Drop a row from the parsed preview before save. */
  const removeImportedEntry = (i: number) => {
    setImportedEntries(prev => prev.filter((_, idx) => idx !== i));
    setImportedCount(c => Math.max(0, c - 1));
  };

  /** Persist the (possibly edited) preview rows to the masterlist DB.
   *
   *  `confirmed` is set by the duplicate dialog: the first call stops to show
   *  what is already on file, the second goes ahead with the new rows only. */
  const saveImportedToDb = async (confirmed = false) => {
    setCsvError('');
    // Validate each row before sending.
    const cleaned: { name: string; graduation_year: number }[] = [];
    const errors: string[] = [];
    importedEntries.forEach((entry, i) => {
      const problem = masterRowProblem(entry.name, entry.graduationYear);
      if (problem) { errors.push(`Row ${i + 1}: ${problem}`); return; }
      cleaned.push({ name: entry.name.trim(), graduation_year: Number(entry.graduationYear.trim()) });
    });
    // Rows edited in the review table are held to the same rule: all or nothing.
    if (errors.length > 0 || cleaned.length === 0) {
      setCsvError(errors.length
        ? `Fix these rows first, nothing was saved: ${errors.slice(0, 5).join('; ')}`
        : 'No rows to save.');
      return;
    }
    // Flag rows already on the master list BEFORE writing anything. The list is
    // already loaded for the table below, so this costs no request.
    const onFile = new Set(
      masterEntries.map(m => `${m.name.trim().toLowerCase()}|${m.graduationYear ?? ''}`),
    );
    const dupes = cleaned.filter(r => onFile.has(`${r.name.toLowerCase()}|${r.graduation_year}`));
    if (dupes.length && !confirmed) {
      setDupePreview(dupes.map(r => ({ name: r.name, graduationYear: String(r.graduation_year) })));
      return;
    }
    setDupePreview(null);

    setIsProcessing(true);
    setUploadProgress({ done: 0, total: cleaned.length });
    try {
      // Sent in chunks so the admin sees "x of y" instead of a spinner that
      // sits there for a 500-row file. Every row was validated above, so a
      // later chunk cannot fail on something an earlier one would have caught.
      const CHUNK = 25;
      let created = 0;
      const skippedRows: { name: string; batch_year: number }[] = [];
      for (let i = 0; i < cleaned.length; i += CHUNK) {
        const slice = cleaned.slice(i, i + CHUNK);
        const res = await createMasterlistEntries(slice);
        created += typeof res?.created === 'number' ? res.created : slice.length;
        skippedRows.push(...(res?.skippedRows ?? []));
        setUploadProgress({ done: Math.min(i + CHUNK, cleaned.length), total: cleaned.length });
      }
      setSavedSummary({ created, skipped: cleaned.length - created });
      setCsvStage('saved');
      refreshMasterlist();
      if (skippedRows.length) {
        const names = skippedRows.slice(0, 3).map(r => `${r.name} (${r.batch_year})`);
        setCsvError(
          `${skippedRows.length} row(s) were already on the master list and were not added: ${names.join('; ')}`
          + (skippedRows.length > 3 ? ` and ${skippedRows.length - 3} more.` : ''),
        );
      }
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setUploadProgress(null);
    }
  };

  const resetCsvFlow = () => {
    setCsvStage('pick');
    setImportedEntries([]);
    setImportedCount(0);
    setSavedSummary(null);
    setCsvError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const updateEntry = (i: number, key: keyof BatchEntry, value: string) => {
    setManualEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [key]: value } : e));
    setManualSaved(false);
  };

  const addRow = () => setManualEntries(prev => [...prev, { name: '', graduationYear: '' }]);
  const removeRow = (i: number) => setManualEntries(prev => prev.filter((_, idx) => idx !== i));

  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError('');
    const problemIdx = manualEntries.findIndex(entry => masterRowProblem(entry.name, entry.graduationYear));
    if (problemIdx >= 0) {
      const entry = manualEntries[problemIdx];
      setManualError(`Row ${problemIdx + 1}: ${masterRowProblem(entry.name, entry.graduationYear)}.`);
      return;
    }
    setIsProcessing(true);
    try {
      const payload = manualEntries.map(entry => ({
        name: entry.name.trim(),
        graduation_year: Number(entry.graduationYear),
      }));
      await createMasterlistEntries(payload);
      setManualSaved(true);
      refreshMasterlist();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <PortalLayout role="admin" pageTitle="Batch Upload" pageSubtitle="Register new graduating batch records to the master list">
      {/* Wide screens: master list on the left, upload workflow on the right,
          instead of one 896px column with empty space on both sides. */}
      <div className="gt-stagger flex flex-col gap-5 xl:grid xl:grid-cols-12 xl:items-start">
        <div className="flex flex-col gap-5 min-w-0 xl:col-span-5">

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <Info className="size-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-800 text-sm" style={{ fontWeight: 600 }}>Adding New Batch Records</p>
            <p className="text-blue-700 text-xs mt-0.5 leading-relaxed">
              Upload the names and graduation years of new graduating students (e.g. current 4th year batch).
              Once saved to the master list, graduates can register and the system will match them by name and graduation year.
              Use the format <span className="font-mono">First Middle Last</span> (e.g., <span className="font-mono">Juan Dela Cruz</span>) so that the registry's surname field matches exactly.
            </p>
          </div>
        </div>

        {/* Current master list count */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Master List Status</h3>
              <p className="text-gray-500 text-xs mt-0.5">Current graduate records on file</p>
            </div>
            <div className="flex items-start gap-2">
              <div className="text-right">
                <p className="text-[#166534]" style={{ fontWeight: 800, fontSize: '1.8rem', lineHeight: 1 }}>{totalMaster}</p>
                <p className="text-gray-400 text-xs">total entries</p>
              </div>
              {/* Batch year maintenance. Only years opened by hand can be
                  removed here -- once a graduate carries a year, the year is
                  the records, and removing it would mean deleting them. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setYearMenuOpen(o => !o)}
                  aria-label="Manage batch years"
                  aria-expanded={yearMenuOpen}
                  className="flex size-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
                >
                  <Settings className="size-4" />
                </button>
                {yearMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setYearMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg text-left">
                      <p className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>Batch years</p>
                      <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">
                        Open a batch before its records exist. It gets a tile and becomes
                        selectable when adding graduates by hand.
                      </p>

                      <div className="mt-2.5 flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={String(MAX_GRAD_YEAR)}
                          value={newYear}
                          onChange={e => setNewYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBatchYear(); } }}
                          className="w-20 px-2.5 py-2 border border-gray-200 rounded-lg text-sm tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={addBatchYear}
                          className="flex-1 px-3 py-2 rounded-lg bg-[#166534] hover:bg-[#14532d] text-white text-xs transition"
                          style={{ fontWeight: 600 }}
                        >
                          Add year
                        </button>
                      </div>
                      {yearMenuError && (
                        <p className="text-rose-600 text-[11px] mt-1.5">{yearMenuError}</p>
                      )}

                      <div className="mt-3 border-t border-gray-100 pt-2.5 max-h-60 overflow-y-auto">
                        {shownYears.map(yr => {
                          const count = batchCount(yr);
                          const renaming = renameYear?.from === yr;
                          return (
                            <div key={yr} className="py-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-gray-700 tabular-nums min-w-0">
                                  Batch {yr}
                                  <span className="text-gray-400">
                                    {' · '}{count} record{count !== 1 ? 's' : ''}
                                  </span>
                                </span>
                                <span className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={count === 0 || yearBusy}
                                    title={count === 0
                                      ? 'Nothing to move: this batch has no records.'
                                      : `Move all ${count} record(s) to another year`}
                                    onClick={() => { setRenameYear({ from: yr, to: '' }); setYearMenuError(''); }}
                                    className="flex size-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={yearBusy}
                                    title={count === 0
                                      ? 'Close this empty batch year'
                                      : `Delete all ${count} record(s) in this batch`}
                                    onClick={() => void removeBatchYear(yr)}
                                    className="flex size-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 transition"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </span>
                              </div>
                              {renaming && (
                                <div className="flex items-center gap-2 mt-1.5 mb-1 pl-2">
                                  <input
                                    autoFocus
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="New year"
                                    value={renameYear.to}
                                    onChange={e => setRenameYear({ from: yr, to: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void applyRenameYear(); } }}
                                    className="w-20 px-2 py-1.5 border border-[#166534] rounded-lg text-xs tabular-nums"
                                  />
                                  <button
                                    type="button"
                                    disabled={yearBusy}
                                    onClick={() => void applyRenameYear()}
                                    className="px-2.5 py-1.5 rounded-lg bg-[#166534] text-white text-[11px] disabled:opacity-60"
                                    style={{ fontWeight: 600 }}
                                  >
                                    Move
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRenameYear(null)}
                                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-600"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 xl:grid-cols-3 2xl:grid-cols-6 gap-2">
            {shownYears.map(yr => {
              const count = batchCount(yr);
              return (
                <div key={yr} className="bg-gray-50 border border-gray-100 rounded-xl p-2 text-center">
                  <p className="text-gray-700 text-xs" style={{ fontWeight: 700 }}>{count}</p>
                  <p className="text-gray-400 text-xs">Batch {yr}</p>
                </div>
              );
            })}
          </div>

          {masterTotal !== null && (
            <p className="mt-3 text-xs text-gray-500">
              <span className="text-emerald-700" style={{ fontWeight: 700 }}>{registeredCount}</span> registered in the system
              {' · '}
              <span className="text-gray-700" style={{ fontWeight: 700 }}>{masterEntries.length - registeredCount}</span> not yet registered
            </p>
          )}

          {/* View master list */}
          <div className="mt-4 border-t border-gray-100 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => setShowMasterList(v => !v)}
                className="text-[#166534] text-xs hover:underline"
                style={{ fontWeight: 600 }}
              >
                {showMasterList ? 'Hide master list' : `View master list (${masterEntries.length})`}
              </button>
              <button
                onClick={exportMasterlist}
                disabled={masterEntries.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                style={{ fontWeight: 600 }}
              >
                <Download className="size-3.5" /> Export CSV
              </button>
            </div>
            {showMasterList && (
              <div className="mt-3">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={masterSearch}
                    onChange={e => setMasterSearch(e.target.value)}
                    placeholder="Search name or year…"
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#166534]"
                  />
                  <select
                    value={masterFilter}
                    onChange={e => setMasterFilter(e.target.value as typeof masterFilter)}
                    aria-label="Filter by registration"
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#166534]"
                  >
                    <option value="all">Everyone</option>
                    <option value="registered">Registered</option>
                    <option value="unregistered">Not registered</option>
                  </select>
                </div>
                <div className="max-h-72 xl:max-h-[28rem] overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
                  {filteredMaster.length === 0 ? (
                    <p className="px-3 py-4 text-center text-gray-400 text-xs">No matching records.</p>
                  ) : (
                    filteredMaster.map(m => (
                      <div key={m.id} className={`flex items-center gap-2 px-3 py-2 ${m.isActive ? '' : 'bg-gray-50'}`}>
                        {editingId === m.id ? (
                          <>
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              aria-label="Graduate name"
                              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-[#166534]"
                            />
                            <input
                              value={editYear}
                              onChange={e => setEditYear(e.target.value)}
                              inputMode="numeric"
                              aria-label="Batch year"
                              className="w-20 shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-[#166534]"
                            />
                            <button
                              onClick={() => saveEdit(m)}
                              disabled={rowBusy === m.id}
                              title="Save"
                              className="shrink-0 rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <Save className="size-4" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              title="Cancel"
                              className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
                            >
                              <X className="size-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={`min-w-0 flex-1 truncate text-sm ${m.isActive ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                              {m.name}
                            </span>
                            {!m.isActive && (
                              <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-500" style={{ fontWeight: 600 }}>
                                Retired
                              </span>
                            )}
                            <RegistrationBadge status={m.accountStatus} />
                            <span className="text-gray-400 text-xs shrink-0">{m.graduationYear ?? '—'}</span>
                            {/* Edit, retire and delete behind one control. They are
                                occasional operations on a list of 525 that is mostly
                                scanned and searched, and three permanent buttons per
                                row left almost no width for the name. */}
                            <RowActions
                              entry={m}
                              busy={rowBusy === m.id}
                              onEdit={() => startEdit(m)}
                              onRemove={() => removeEntry(m)}
                            />
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {masterError && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-red-600">
                    <AlertCircle className="size-3.5 shrink-0" /> {masterError}
                  </p>
                )}
                {masterNotice && !masterError && (
                  <p className="mt-1 text-[11px] text-emerald-700">{masterNotice}</p>
                )}
                <p className="text-gray-400 text-[11px] mt-1">{filteredMaster.length} of {masterEntries.length} shown</p>
              </div>
            )}
          </div>
        </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0 xl:col-span-7">
        {/* Mode tabs */}
        <div className="flex gap-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5">
          <button onClick={() => setMode('csv')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition ${mode === 'csv' ? 'bg-[#166534] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            style={{ fontWeight: mode === 'csv' ? 600 : 400 }}>
            <Upload className="size-4" /> CSV Upload
          </button>
          <button onClick={() => setMode('manual')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition ${mode === 'manual' ? 'bg-[#166534] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            style={{ fontWeight: mode === 'manual' ? 600 : 400 }}>
            <Plus className="size-4" /> Manual Entry
          </button>
        </div>

        {/* ── CSV Upload ── */}
        {mode === 'csv' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
              <div className="min-w-0">
                <h3 className="text-gray-800" style={{ fontWeight: 700 }}>CSV Batch Upload</h3>
                <p className="text-gray-500 text-xs mt-0.5">Write each row as <span className="font-mono">First Middle Last,Year</span>. The surname is the last word and is matched case-insensitively at sign-up.</p>
              </div>
              <button onClick={downloadTemplate}
                className="flex shrink-0 self-start sm:self-auto items-center gap-1.5 text-[#166534] bg-[#166534]/5 hover:bg-[#166534]/15 text-xs px-3 py-2.5 sm:py-2 rounded-lg transition"
                style={{ fontWeight: 600 }}>
                <Download className="size-3.5" /> Download Template
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 font-mono text-xs text-gray-600">
              <p className="text-gray-400 text-xs mb-1" style={{ fontWeight: 600 }}>CSV FORMAT (2 columns required):</p>
              <p className="text-[#166534]" style={{ fontWeight: 600 }}>name,graduationYear</p>
              <p className="text-gray-500">Juan dela Cruz,2024</p>
              <p className="text-gray-500">Maria Reyes,2025</p>
            </div>

            {csvStage === 'pick' && (
              <>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-2xl p-8 sm:p-12 text-center cursor-pointer hover:border-[#166534]/40 hover:bg-[#166534]/3 transition">
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-3">
                      <span className="size-8 border-4 border-[#166534]/20 border-t-[#166534] rounded-full animate-spin" />
                      <p className="text-gray-600 text-sm">Processing CSV file…</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-xl bg-[#166534]/10">
                        <FileText className="size-6 text-[#166534]" />
                      </div>
                      <div>
                        <p className="text-gray-700 text-sm" style={{ fontWeight: 600 }}>Click to upload CSV file</p>
                        <p className="text-gray-400 text-xs mt-1">or drag and drop · .csv files only</p>
                      </div>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
              </>
            )}

            {csvStage === 'review' && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Info className="size-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-amber-900" style={{ fontWeight: 700, fontSize: '1rem' }}>
                      Review before saving
                    </p>
                    <p className="text-amber-800 text-xs mt-0.5">
                      {importedCount} row{importedCount !== 1 ? 's' : ''} parsed from your CSV. You can edit names or years inline, drop any row, then click <strong>Save to Master List</strong> to write them into the database. Nothing has been persisted yet.
                    </p>
                  </div>
                </div>

                <div className="bg-white border border-amber-100 rounded-xl overflow-hidden">
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100/60 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-amber-900 w-8" style={{ fontWeight: 600 }}>#</th>
                          <th className="text-left px-3 py-2 text-amber-900" style={{ fontWeight: 600 }}>Name (First Middle Last)</th>
                          <th className="text-left px-3 py-2 text-amber-900 w-32" style={{ fontWeight: 600 }}>Year</th>
                          <th className="text-right px-3 py-2 text-amber-900 w-12" style={{ fontWeight: 600 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {importedEntries.map((entry, i) => (
                          <tr key={i} className="border-t border-amber-50">
                            <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={entry.name}
                                onChange={(e) => editImportedEntry(i, 'name', e.target.value)}
                                className="w-full bg-transparent border-b border-transparent focus:border-amber-400 focus:outline-none text-gray-800"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={entry.graduationYear}
                                onChange={(e) => editImportedEntry(i, 'graduationYear', e.target.value)}
                                className="w-full bg-transparent border-b border-transparent focus:border-amber-400 focus:outline-none text-gray-800"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => removeImportedEntry(i)}
                                className="inline-flex size-8 items-center justify-center rounded-lg text-amber-700 hover:text-red-600 hover:bg-red-50 transition"
                                title="Remove row"
                                aria-label="Remove row"
                              >
                                <X className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
                  <button
                    onClick={resetCsvFlow}
                    disabled={isProcessing}
                    className="text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-sm px-4 py-2.5 sm:py-2 rounded-lg transition"
                    style={{ fontWeight: 600 }}>
                    Discard and upload a different file
                  </button>
                  <button
                    onClick={() => void saveImportedToDb()}
                    disabled={isProcessing || importedEntries.length === 0}
                    className="flex items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] disabled:opacity-50 text-white text-sm px-5 py-2.5 rounded-lg transition"
                    style={{ fontWeight: 600 }}>
                    {isProcessing ? (
                      <>
                        <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {uploadProgress
                          ? `Saving ${uploadProgress.done} of ${uploadProgress.total}…`
                          : 'Saving…'}
                      </>
                    ) : (
                      <>
                        <Save className="size-4" />
                        Save {importedEntries.length} row{importedEntries.length !== 1 ? 's' : ''} to Master List
                      </>
                    )}
                  </button>
                </div>

                {uploadProgress && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-[#166534] transition-all duration-200"
                        style={{ width: `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-gray-500 text-xs mt-1.5 text-center tabular-nums">
                      {uploadProgress.done} of {uploadProgress.total} rows sent
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Duplicate confirmation. Shown before anything is written, so the
                admin can back out of re-uploading a file they already imported. */}
            {dupePreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-lg rounded-2xl bg-white p-5 sm:p-6 shadow-xl">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="size-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
                        {dupePreview.length} of {importedEntries.length} rows are already on the master list
                      </h3>
                      <p className="text-gray-500 text-sm mt-1">
                        {dupePreview.length >= importedEntries.length
                          ? 'Every row in this file already exists. Saving would add nothing.'
                          : `Only the ${importedEntries.length - dupePreview.length} new row(s) will be added. The rest are left as they are.`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
                    {dupePreview.slice(0, 50).map((d, i) => (
                      <p key={i} className="text-xs text-gray-600 py-0.5">
                        {d.name} <span className="text-gray-400">· {d.graduationYear}</span>
                      </p>
                    ))}
                    {dupePreview.length > 50 && (
                      <p className="text-xs text-gray-400 pt-1">
                        … and {dupePreview.length - 50} more.
                      </p>
                    )}
                  </div>

                  <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDupePreview(null)}
                      className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={dupePreview.length >= importedEntries.length}
                      onClick={() => void saveImportedToDb(true)}
                      className="px-4 py-2.5 rounded-lg bg-[#166534] hover:bg-[#14532d] disabled:opacity-50 text-white text-sm transition"
                      style={{ fontWeight: 600 }}
                    >
                      Add the {importedEntries.length - dupePreview.length} new row(s)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {csvStage === 'saved' && savedSummary && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
                <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-emerald-800" style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                  Saved to the master list
                </p>
                <p className="text-emerald-700 text-sm mt-1">
                  {savedSummary.created} new graduate record{savedSummary.created !== 1 ? 's' : ''} added.
                  {savedSummary.skipped > 0 && ` ${savedSummary.skipped} duplicate row${savedSummary.skipped !== 1 ? 's were' : ' was'} skipped.`}
                </p>
                <button
                  onClick={resetCsvFlow}
                  className="mt-4 text-emerald-700 bg-emerald-100 hover:bg-emerald-200 text-sm px-4 py-2 rounded-lg transition"
                  style={{ fontWeight: 600 }}>
                  Upload another file
                </button>
              </div>
            )}

            {csvError && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mt-4">
                <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm">{csvError}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Manual Entry ── */}
        {mode === 'manual' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
            <div className="mb-5">
              <h3 className="text-gray-800" style={{ fontWeight: 700 }}>Manual Batch Entry</h3>
              <p className="text-gray-500 text-xs mt-0.5">Enter each graduate as <span className="font-mono">First Middle Last</span> plus the year. The system matches by surname (case-insensitive) and graduation year.</p>
            </div>

            {manualError && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 mb-4">
                <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm">{manualError}</p>
              </div>
            )}
            {manualSaved && (
              <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 mb-4">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                <p className="text-emerald-700 text-sm" style={{ fontWeight: 600 }}>
                  {manualEntries.length} record{manualEntries.length !== 1 ? 's' : ''} saved to master list successfully.
                </p>
              </div>
            )}

            <form onSubmit={handleManualSave}>
              {/* Table header */}
              <div className="grid grid-cols-[4fr_2fr_40px] gap-2 mb-2 px-1">
                {[
                  { label: 'Full Name', icon: User },
                  { label: 'Grad. Year', icon: Calendar },
                  { label: '', icon: null },
                ].map((h, i) => h.label ? (
                  <p key={i} className="text-gray-500 text-xs flex items-center gap-1" style={{ fontWeight: 600 }}>
                    {h.icon && <h.icon className="size-3" />} {h.label}
                  </p>
                ) : <div key={i} />)}
              </div>

              <div className="space-y-2 mb-4">
                {manualEntries.map((entry, i) => (
                  <div key={i} className="grid grid-cols-[4fr_2fr_40px] gap-2 items-center">
                    <input type="text" placeholder="e.g. Juan dela Cruz" value={entry.name}
                      onChange={e => updateEntry(i, 'name', e.target.value)} className={inputCls} />
                    <select value={entry.graduationYear}
                      onChange={e => updateEntry(i, 'graduationYear', e.target.value)}
                      className={inputCls}>
                      <option value="">Year</option>
                      {selectableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button type="button" onClick={() => removeRow(i)} disabled={manualEntries.length === 1}
                      className="flex size-9 items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition disabled:opacity-30">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={addRow}
                  className="flex flex-1 sm:flex-none items-center justify-center gap-2 border border-dashed border-gray-300 hover:border-[#166534]/50 text-gray-500 hover:text-[#166534] px-4 py-2.5 rounded-xl text-sm transition"
                  style={{ fontWeight: 500 }}>
                  <Plus className="size-4" /> Add Row
                </button>
                <div className="hidden sm:block flex-1" />
                <button type="submit" disabled={isProcessing}
                  className="flex w-full sm:w-auto items-center justify-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-6 py-2.5 rounded-xl text-sm transition disabled:opacity-70"
                  style={{ fontWeight: 600 }}>
                  {isProcessing
                    ? <><span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                    : <><CheckCircle2 className="size-4" /> Save to Master List</>}
                </button>
              </div>
            </form>
          </div>
        )}
        </div>
      </div>
    </PortalLayout>
  );
}
