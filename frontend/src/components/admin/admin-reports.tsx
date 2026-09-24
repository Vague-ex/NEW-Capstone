import { useEffect, useMemo, useState } from 'react';
import {
  FileText, FileSpreadsheet, FileType2, Loader2, AlertCircle, Filter, Eye, X,
  Users, Briefcase, Wrench, ShieldCheck, TrendingUp, GraduationCap,
} from 'lucide-react';
import { fetchReport, ReportFilters, type ReportPayload } from '../../app/api-client';
import {
  exportCsv, exportPdf, exportXlsx, formatFilters, formatTimestamp, LETTERHEAD, PDF_PAGE, SUBTITLE,
} from '../../lib/report-export';

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
      'Per-batch employment rate, time-to-hire and BSIS alignment, employer feedback ratings, a cross-batch timeline (charted in PDF), common themes, and curriculum alignment split into employer-verified and self-reported.',
    endpoint: 'batch-summary',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: Users,
    accent: 'text-blue-600 bg-blue-50',
  },
  {
    id: 'employment-outcomes',
    title: 'Employment Outcomes',
    description:
      'A roster of graduates with their employer, position, sector, time-to-hire, work location and whether the job is BSIS-aligned.',
    endpoint: 'employment-outcomes',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: Briefcase,
    accent: 'text-emerald-600 bg-emerald-50',
  },
  {
    id: 'skills-inventory',
    title: 'Skills Inventory',
    description:
      'The technical and soft skills graduates listed most, overall and per batch, with the share of graduates holding each.',
    endpoint: 'skills-inventory',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: Wrench,
    accent: 'text-purple-600 bg-purple-50',
  },
  {
    id: 'further-studies',
    title: 'Further Studies',
    description:
      "Status breakdown - went straight to work vs. currently enrolled vs. completed Master's / PhD - with top programs, schools, and completion durations.",
    endpoint: 'further-studies',
    formats: ['pdf', 'xlsx', 'csv'],
    Icon: GraduationCap,
    accent: 'text-emerald-600 bg-emerald-50',
  },
  {
    id: 'data-quality',
    title: 'Data Quality',
    description:
      'How complete graduate records are: coverage, which answers are missing (job questions only count for graduates they apply to), and completion rate per batch.',
    endpoint: 'data-quality',
    formats: ['pdf'],
    Icon: ShieldCheck,
    accent: 'text-slate-600 bg-slate-100',
  },
  {
    id: 'predictive-trend',
    title: 'Predictive Employability Trend',
    description:
      'Observed employment rates per batch with 95% intervals, time to first job, the expected range for the next batch (not a forecast), and the factors and acceptance checks of the active model.',
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 gt-stagger">
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
              <span>Include unverified graduates</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
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
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 sm:py-1.5 rounded-lg bg-[#16a34a] text-white text-xs hover:bg-[#15803d] transition disabled:opacity-50 disabled:cursor-not-allowed"
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
        Reports preview against the current database state. PDFs carry the College of Computer
        Studies letterhead on every page, as in the preview.
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

// ── Preview modal: the report as a page, laid out like the PDF ──────────────

// Letterhead sizes are container-query units of the page width (PDF points
// scaled to 100cqw), so it keeps the PDF's proportions on any screen width.
const pt = (n: number) => `${((n * 100) / PDF_PAGE.width).toFixed(3)}cqw`;
// Arial's baseline sits 0.847 em below the top of a line box when line-height is 1.
const ARIAL_BASELINE = 0.847;
const NUMERIC = /^[-+]?[\d,.]+%?$/;

function ReportLetterhead() {
  const L = LETTERHEAD;
  const m = PDF_PAGE.margin;
  const titleTop = L.title.baseline - ARIAL_BASELINE * L.title.capSize;
  return (
    <div
      role="img"
      aria-label="Carlos Hilado Memorial State University, College of Computer Studies"
      className="relative select-none"
      style={{ height: pt(L.bottom), fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 700 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- sized in cqw, which next/image cannot take */}
      <img src={L.logo.src} alt="" className="absolute"
        style={{ left: pt(m + L.logo.x), top: pt(L.logo.y), width: pt(L.logo.size), height: pt(L.logo.size) }} />
      <div className="absolute whitespace-pre"
        style={{ left: pt(m + L.title.x), top: pt(titleTop), fontSize: pt(L.title.capSize), lineHeight: 1 }}>
        {L.title.words.map((word, i) => (
          <span key={word}>
            <span style={{ color: L.colors.cap }}>{word[0]}</span>
            <span style={{ fontSize: pt(L.title.restSize), color: L.colors.rest }}>
              {word.slice(1)}{i < L.title.words.length - 1 ? '  ' : ''}
            </span>
          </span>
        ))}
        {/* The bar spans the name however wide the browser's font sets it. */}
        <span className="absolute"
          style={{ left: pt(L.bar.dx), right: 0, top: pt(L.bar.y - titleTop), height: pt(L.bar.height), background: L.colors.bar }} />
      </div>
      <p className="absolute"
        style={{
          left: pt(m + L.college.x), top: pt(L.college.baseline - ARIAL_BASELINE * L.college.size),
          fontSize: pt(L.college.size), lineHeight: 1, color: L.colors.college,
        }}>
        {L.college.text}
      </p>
      <div className="absolute inset-x-0" style={{ top: pt(L.band.y), height: pt(L.band.height), background: L.colors.band }} />
    </div>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-5xl xl:max-w-6xl max-h-[100dvh] sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3 border-b border-gray-200">
          <p className="min-w-0 truncate text-sm text-gray-700">
            <span style={{ fontWeight: 700 }}>Report Preview</span>
            <span className="text-gray-400">{' · '}{payload.title}</span>
          </p>
          <button onClick={onClose} className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        {/* The report as it will print */}
        <div className="flex-1 overflow-y-auto bg-gray-100 px-2 sm:px-6 py-3 sm:py-6">
          <article className="mx-auto w-full max-w-[794px] bg-white shadow-md" style={{ containerType: 'inline-size' }}>
            <ReportLetterhead />
            <div className="px-[6.72cqw] pt-6 pb-10 space-y-6">
              <header>
                <h2 className="text-[#047940] text-xl sm:text-2xl" style={{ fontWeight: 700 }}>{payload.title}</h2>
                <p className="text-sm text-gray-600 mt-1">{SUBTITLE}</p>
                <p className="text-xs text-gray-400 mt-2">Generated: {formatTimestamp(payload.generated_at)}</p>
                <p className="text-xs text-gray-400">Filters: {formatFilters(payload.filters)}</p>
              </header>
              {payload.sections.length === 0 && (
                <p className="text-sm text-gray-500">This report returned no sections for the current filters.</p>
              )}
              {payload.sections.map((section, idx) => (
                <section key={idx}>
                  <h3 className="text-sm text-[#047940] mb-2" style={{ fontWeight: 700 }}>{section.title}</h3>
                  {section.rows.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No rows.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr>
                            {section.columns.map((col, i) => (
                              <th key={i} className="px-2 py-1.5 text-left bg-[#047940] text-white border border-[#047940]" style={{ fontWeight: 700 }}>
                                {col == null ? '' : String(col)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row, rIdx) => (
                            <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-100'}>
                              {row.map((cell, cIdx) => {
                                const text = cell == null ? '' : String(cell);
                                return (
                                  <td key={cIdx}
                                    className={`px-2 py-1.5 text-gray-800 border border-gray-300 ${cIdx > 0 && NUMERIC.test(text.trim()) ? 'text-right' : ''}`}>
                                    {text}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </article>
        </div>

        {/* Footer: generate buttons */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-emerald-100 bg-white flex flex-wrap items-center justify-between gap-3">
          <p className="hidden sm:block text-xs text-gray-500">
            Like what you see? Generate the report in your preferred format.
          </p>
          <div className="grid grid-cols-2 w-full sm:w-auto sm:flex sm:flex-wrap gap-2">
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 transition"
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
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg bg-[#16a34a] text-white text-xs hover:bg-[#15803d] transition disabled:opacity-60"
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
