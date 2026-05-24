import { useState, useRef } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { MASTER_LIST } from '../../data/app-data';
import { createMasterlistEntries } from '../../app/api-client';
import {
  Upload, CheckCircle2, AlertCircle, FileText, Plus, Trash2,
  Download, Info, Save, X,
} from 'lucide-react';

interface BatchEntry {
  name: string;
  graduationYear: string;
}

const currentYear = new Date().getFullYear();
const YEAR_RANGE = Array.from({ length: currentYear - 2019 }, (_, i) => 2020 + i);

const TEMPLATE_CSV = `name,graduationYear
Juan dela Cruz,2024
Maria Reyes,2024
Pedro Santos,2025`;

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
  const [csvError, setCsvError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [manualEntries, setManualEntries] = useState<BatchEntry[]>([
    { name: '', graduationYear: '' },
  ]);
  const [manualSaved, setManualSaved] = useState(false);
  const [manualError, setManualError] = useState('');

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

        const startIdx = nameIdx >= 0 ? 1 : 0;
        const entries: BatchEntry[] = [];
        const errors: string[] = [];

        for (let i = startIdx; i < rawLines.length; i++) {
          const cols = parseCsvLine(rawLines[i]);
          const name = (nameIdx >= 0 ? cols[nameIdx] : cols[0]) ?? '';
          const graduationYear = (yearIdx >= 0 ? cols[yearIdx] : cols[1]) ?? '';
          if (!name.trim()) { errors.push(`Row ${i + 1}: missing name`); continue; }
          if (!graduationYear.trim() || Number.isNaN(Number(graduationYear))) {
            errors.push(`Row ${i + 1}: invalid graduation year`); continue;
          }
          entries.push({ name: name.trim(), graduationYear: graduationYear.trim() });
        }

        if (entries.length === 0) {
          setCsvError(errors.length ? `No valid rows. ${errors.slice(0, 3).join('; ')}` : 'No valid rows found.');
          setIsProcessing(false);
          return;
        }

        setImportedEntries(entries);
        setImportedCount(entries.length);
        setCsvStage('review');
        setSavedSummary(null);
        if (errors.length > 0) {
          setCsvError(`Parsed ${entries.length} rows. Skipped ${errors.length}: ${errors.slice(0, 3).join('; ')}`);
        }
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

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CHMSU_BSIS_Batch_Template.csv';
    a.click();
    URL.revokeObjectURL(url);
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

  /** Persist the (possibly edited) preview rows to the masterlist DB. */
  const saveImportedToDb = async () => {
    setCsvError('');
    // Validate each row before sending.
    const cleaned: { name: string; graduation_year: number }[] = [];
    const errors: string[] = [];
    importedEntries.forEach((entry, i) => {
      const name = entry.name.trim();
      const yearStr = entry.graduationYear.trim();
      if (!name) { errors.push(`Row ${i + 1}: missing name`); return; }
      const yearNum = Number(yearStr);
      if (!yearStr || Number.isNaN(yearNum)) { errors.push(`Row ${i + 1}: invalid year`); return; }
      cleaned.push({ name, graduation_year: yearNum });
    });
    if (cleaned.length === 0) {
      setCsvError(errors.join('; ') || 'No valid rows to save.');
      return;
    }
    setIsProcessing(true);
    try {
      const res = await createMasterlistEntries(cleaned);
      const created = typeof res?.created === 'number' ? res.created : cleaned.length;
      const skipped = cleaned.length - created;
      setSavedSummary({ created, skipped });
      setCsvStage('saved');
      if (errors.length) {
        setCsvError(`${errors.length} row(s) skipped before send: ${errors.slice(0, 3).join('; ')}`);
      }
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setIsProcessing(false);
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
    const invalid = manualEntries.find(entry => !entry.name.trim() || !entry.graduationYear);
    if (invalid) {
      setManualError('All rows must have a full name and graduation year.');
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
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm placeholder-gray-400 outline-none transition focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/15 focus:bg-white';

  return (
    <PortalLayout role="admin" pageTitle="Batch Upload" pageSubtitle="Register new graduating batch records to the master list">
      <div className="max-w-4xl mx-auto space-y-5">

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
            <div className="text-right">
              <p className="text-[#166534]" style={{ fontWeight: 800, fontSize: '1.8rem', lineHeight: 1 }}>{MASTER_LIST.length}</p>
              <p className="text-gray-400 text-xs">total entries</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {YEAR_RANGE.map(yr => {
              const count = MASTER_LIST.filter(m => m.graduationYear === yr).length;
              return (
                <div key={yr} className="bg-gray-50 border border-gray-100 rounded-xl p-2 text-center">
                  <p className="text-gray-700 text-xs" style={{ fontWeight: 700 }}>{count}</p>
                  <p className="text-gray-400 text-xs">Batch {yr}</p>
                </div>
              );
            })}
          </div>
        </div>

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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-gray-800" style={{ fontWeight: 700 }}>CSV Batch Upload</h3>
                <p className="text-gray-500 text-xs mt-0.5">Write each row as <span className="font-mono">First Middle Last,Year</span>. The surname is the last word and is matched case-insensitively at sign-up.</p>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 text-[#166534] bg-[#166534]/5 hover:bg-[#166534]/15 text-xs px-3 py-2 rounded-lg transition"
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
                  className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center cursor-pointer hover:border-[#166534]/40 hover:bg-[#166534]/3 transition">
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
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
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
                                className="text-amber-700 hover:text-red-600 transition"
                                title="Remove row"
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

                <div className="mt-5 flex items-center justify-between gap-3">
                  <button
                    onClick={resetCsvFlow}
                    disabled={isProcessing}
                    className="text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-sm px-4 py-2 rounded-lg transition"
                    style={{ fontWeight: 600 }}>
                    Discard and upload a different file
                  </button>
                  <button
                    onClick={saveImportedToDb}
                    disabled={isProcessing || importedEntries.length === 0}
                    className="flex items-center gap-2 bg-[#166534] hover:bg-[#14532d] disabled:opacity-50 text-white text-sm px-5 py-2.5 rounded-lg transition"
                    style={{ fontWeight: 600 }}>
                    {isProcessing ? (
                      <>
                        <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="size-4" />
                        Save {importedEntries.length} row{importedEntries.length !== 1 ? 's' : ''} to Master List
                      </>
                    )}
                  </button>
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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
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
                      {YEAR_RANGE.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button type="button" onClick={() => removeRow(i)} disabled={manualEntries.length === 1}
                      className="flex size-9 items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition disabled:opacity-30">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={addRow}
                  className="flex items-center gap-2 border border-dashed border-gray-300 hover:border-[#166534]/50 text-gray-500 hover:text-[#166534] px-4 py-2.5 rounded-xl text-sm transition"
                  style={{ fontWeight: 500 }}>
                  <Plus className="size-4" /> Add Row
                </button>
                <div className="flex-1" />
                <button type="submit" disabled={isProcessing}
                  className="flex items-center gap-2 bg-[#166534] hover:bg-[#14532d] text-white px-6 py-2.5 rounded-xl text-sm transition disabled:opacity-70"
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
    </PortalLayout>
  );
}
