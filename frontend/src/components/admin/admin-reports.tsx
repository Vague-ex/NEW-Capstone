import { useEffect, useMemo, useState } from 'react';
import {
  FileText, FileSpreadsheet, FileType2, Loader2, AlertCircle, Filter, Eye, X,
  Users, Briefcase, Wrench, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { fetchReport, ReportFilters, type ReportPayload } from '../../app/api-client';
import { exportCsv, exportPdf, exportXlsx } from '../../lib/report-export';

type ExportFormat = 'pdf' | 'xlsx' | 'csv';

interface ReportDef {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  formats: ExportFormat[];
  Icon: typeof Users;
  accent: string;
}

const REPORTS: ReportDef[] = [
  {
    id: 'batch-summary',
    title: 'Batch Summary',
    description:
      'Per-batch employment outcomes, employer feedback aggregates, cross-batch timeline (with chart in PDF), and common-themes word counts.',
    endpoint: 'batch-summary',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: Users,
    accent: 'text-blue-600 bg-blue-50',
  },
  {
    id: 'employment-outcomes',
    title: 'Employment Outcomes',
    description:
      'Status breakdown, sector mix, BSIS-aligned vs unrelated jobs, employer-verified counts.',
    endpoint: 'employment-outcomes',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: Briefcase,
    accent: 'text-emerald-600 bg-emerald-50',
  },
  {
    id: 'skills-inventory',
    title: 'Skills Inventory',
    description:
      'Top skills by frequency, skill-gap signal (training vs current job), and category coverage.',
    endpoint: 'skills-inventory',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: Wrench,
    accent: 'text-purple-600 bg-purple-50',
  },
  {
    id: 'data-quality',
    title: 'Data Quality',
    description:
      'Counts of unverified, unverifiable, and missing-field profiles. Helps prioritize follow-ups.',
    endpoint: 'data-quality',
    formats: ['pdf'],
    Icon: ShieldCheck,
    accent: 'text-slate-600 bg-slate-100',
  },
  {
    id: 'predictive-trend',
    title: 'Predictive Employability Trend',
    description:
      'Actual vs predicted employment rate and time-to-hire per past batch, plus a forward forecast for the next several years and a short narrative summary.',
    endpoint: 'predictive-trend',
    formats: ['pdf', 'xlsx'],
    Icon: TrendingUp,
    accent: 'text-emerald-600 bg-emerald-50',
  },
];

const DEFAULT_END = new Date().getFullYear();
const DEFAULT_START = DEFAULT_END - 5;

const STAMP_KEY = 'admin-reports.lastGen.v1';
const FILTERS_KEY = 'admin-reports.filters.v1';

function loadStamps(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(STAMP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveStamps(next: Record<string, string>) {
  try {
    sessionStorage.setItem(STAMP_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
}

function loadFilters(): ReportFilters {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return { batchStart: DEFAULT_START, batchEnd: DEFAULT_END, includeUnverified: false };
    const parsed = JSON.parse(raw) as Partial<ReportFilters>;
    return {
      batchStart: Number(parsed.batchStart) || DEFAULT_START,
      batchEnd: Number(parsed.batchEnd) || DEFAULT_END,
      includeUnverified: Boolean(parsed.includeUnverified),
    };
  } catch {
    return { batchStart: DEFAULT_START, batchEnd: DEFAULT_END, includeUnverified: false };
  }
}

function saveFilters(f: ReportFilters) {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

function relativeStamp(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: 'PDF',
  xlsx: 'Excel',
  csv: 'CSV',
};

const FORMAT_ICON: Record<ExportFormat, typeof FileText> = {
  pdf: FileType2,
  xlsx: FileSpreadsheet,
  csv: FileText,
};

export function AdminReports() {
  const [filters, setFilters] = useState<ReportFilters>(() => loadFilters());
  const [busy, setBusy] = useState<{ id: string; format: ExportFormat } | null>(null);
  const [stamps, setStamps] = useState<Record<string, string>>(() => loadStamps());
  const [error, setError] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ reportDef: ReportDef; payload: ReportPayload } | null>(null);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    const start = now - 15;
    const out: number[] = [];
    for (let y = now; y >= start; y--) out.push(y);
    return out;
  }, []);

  const batchRangeInvalid = filters.batchStart > filters.batchEnd;

  async function handlePreview(report: ReportDef) {
    if (batchRangeInvalid) {
      setError('Batch start year must be ≤ batch end year.');
      return;
    }
    setError(null);
    setPreviewLoadingId(report.id);
    try {
      const payload = await fetchReport(report.endpoint, filters);
      setPreview({ reportDef: report, payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleGenerate(format: ExportFormat) {
    if (!preview) return;
    const { reportDef, payload } = preview;
    setBusy({ id: reportDef.id, format });
    try {
      if (format === 'csv') exportCsv(payload);
      else if (format === 'xlsx') await exportXlsx(payload);
      else await exportPdf(payload);

      const next = { ...stamps, [reportDef.id]: new Date().toISOString() };
      setStamps(next);
      saveStamps(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="size-4 text-[#15803d]" />
          <h3 className="text-gray-800" style={{ fontWeight: 700 }}>
            Report Filters
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block" style={{ fontWeight: 600 }}>
              Earliest graduation year
            </label>
            <select
              value={filters.batchStart}
              onChange={(e) =>
                setFilters((f) => ({ ...f, batchStart: Number(e.target.value) }))
              }
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block" style={{ fontWeight: 600 }}>
              Latest graduation year
            </label>
            <select
              value={filters.batchEnd}
              onChange={(e) =>
                setFilters((f) => ({ ...f, batchEnd: Number(e.target.value) }))
              }
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.includeUnverified}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, includeUnverified: e.target.checked }))
                }
                className="size-4 accent-[#16a34a]"
              />
              <span>Include unverified alumni</span>
            </label>
          </div>
        </div>
        {batchRangeInvalid && (
          <p className="text-xs text-rose-600 mt-3">
            Batch start must be on or before batch end.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-2 items-start text-sm text-red-700">
          <AlertCircle className="size-4 mt-0.5" />
          <div>
            <p style={{ fontWeight: 600 }}>Could not generate report</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Report cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {REPORTS.map((r) => {
          const stamp = stamps[r.id];
          const Icon = r.Icon;
          const isLoading = previewLoadingId === r.id;
          return (
            <div
              key={r.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`flex size-10 items-center justify-center rounded-xl ${r.accent}`}>
                  <Icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-gray-900" style={{ fontWeight: 700 }}>
                    {r.title}
                  </h4>
                  <p className="text-gray-500 text-xs mt-0.5 leading-snug">{r.description}</p>
                </div>
              </div>

              <div className="mt-auto pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">
                  {stamp ? `Last generated ${relativeStamp(stamp)}` : 'Not generated yet'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                    {r.formats.map((fmt) => FORMAT_LABEL[fmt]).join(' · ')}
                  </span>
                  <button
                    onClick={() => handlePreview(r)}
                    disabled={isLoading || previewLoadingId !== null || batchRangeInvalid}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16a34a] text-white text-xs hover:bg-[#15803d] transition disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ fontWeight: 600 }}
                  >
                    {isLoading
                      ? <Loader2 className="size-3.5 animate-spin" />
                      : <Eye className="size-3.5" />}
                    Preview Report
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Reports preview against the current database state. Drop a branded header at{' '}
        <code className="px-1 py-0.5 bg-gray-100 rounded">/public/report-header.png</code> to
        appear at the top of every PDF.
      </p>

      {preview && (
        <PreviewModal
          report={preview.reportDef}
          payload={preview.payload}
          busy={busy}
          onClose={() => setPreview(null)}
          onGenerate={handleGenerate}
        />
      )}
    </div>
  );
}

// ── Preview modal (light-green theme) ────────────────────────────────────────

function PreviewModal({
  report,
  payload,
  busy,
  onClose,
  onGenerate,
}: {
  report: ReportDef;
  payload: ReportPayload;
  busy: { id: string; format: ExportFormat } | null;
  onClose: () => void;
  onGenerate: (format: ExportFormat) => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#16a34a] to-[#22c55e] text-white px-6 py-4 flex items-start justify-between">
          <div>
            <p className="text-emerald-100 text-xs uppercase tracking-wide" style={{ fontWeight: 600 }}>
              Report Preview
            </p>
            <h2 className="text-lg" style={{ fontWeight: 700 }}>{payload.title}</h2>
            <p className="text-emerald-100 text-xs mt-0.5">
              Batches {payload.filters.batch_start}–{payload.filters.batch_end}
              {' · '}
              {payload.filters.include_unverified ? 'Includes unverified' : 'Verified only'}
              {' · '}
              Generated {new Date(payload.generated_at).toLocaleString()}
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 bg-emerald-50/40">
          {payload.sections.length === 0 && (
            <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-6 text-center">
              <p className="text-sm text-gray-500">This report returned no sections for the current filters.</p>
            </div>
          )}
          {payload.sections.map((section, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-emerald-100 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
                <h3 className="text-sm text-[#15803d]" style={{ fontWeight: 700 }}>
                  {section.title}
                </h3>
              </div>
              <div className="overflow-x-auto">
                {section.rows.length === 0 ? (
                  <p className="p-4 text-xs text-gray-400 italic">No rows.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#16a34a] text-white">
                        {section.columns.map((col, i) => (
                          <th key={i} className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>
                            {col == null ? '' : String(col)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, rIdx) => (
                        <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-emerald-50/50'}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-3 py-2 text-gray-700 border-b border-emerald-50">
                              {cell == null ? '' : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer: generate buttons */}
        <div className="px-6 py-4 border-t border-emerald-100 bg-white flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Like what you see? Generate the report in your preferred format.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 transition"
              style={{ fontWeight: 600 }}>
              Cancel
            </button>
            {report.formats.map((fmt) => {
              const FmtIcon = FORMAT_ICON[fmt];
              const isBusy = busy?.id === report.id && busy?.format === fmt;
              const anyBusy = busy?.id === report.id;
              return (
                <button
                  key={fmt}
                  onClick={() => onGenerate(fmt)}
                  disabled={isBusy || anyBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#16a34a] text-white text-xs hover:bg-[#15803d] transition disabled:opacity-60"
                  style={{ fontWeight: 600 }}>
                  {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FmtIcon className="size-3.5" />}
                  Generate {FORMAT_LABEL[fmt]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
