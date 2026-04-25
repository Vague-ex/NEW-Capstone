/**
 * Client-side report exporters.
 *
 * Each exporter takes the structured ReportPayload returned by
 * `fetchReport(...)` and produces a downloadable artifact:
 *
 *   - exportCsv  → multi-section CSV (sections separated by blank rows)
 *   - exportXlsx → workbook with one sheet per section + a "Filters" sheet
 *   - exportPdf  → A4 portrait, optional `/report-header.png` band, then a
 *                   `jspdf-autotable` per section
 *
 * Keeping export logic in the browser means the backend stays dependency-free
 * (no openpyxl / reportlab / weasyprint) and lets us preview the JSON before
 * the user hits "Generate".
 */

import type { ReportPayload } from '../app/api-client';

type Cell = string | number | null | undefined;

const SUBTITLE = 'Predictive Employability Trend';

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatFilters(filters: ReportPayload['filters']): string {
  const parts: string[] = [];
  parts.push(`Cohorts ${filters.cohort_start}–${filters.cohort_end}`);
  parts.push(filters.include_unverified ? 'Includes unverified' : 'Verified only');
  return parts.join('  ·  ');
}

function safeFilename(title: string, ext: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${slug}_${stamp}.${ext}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── CSV ────────────────────────────────────────────────────────────────────

function csvEscape(value: Cell): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(cells: Cell[]): string {
  return cells.map(csvEscape).join(',');
}

export function exportCsv(payload: ReportPayload): void {
  const lines: string[] = [];
  lines.push(csvRow([payload.title]));
  lines.push(csvRow([SUBTITLE]));
  lines.push(csvRow([`Generated ${formatTimestamp(payload.generated_at)}`]));
  lines.push(csvRow([formatFilters(payload.filters)]));
  lines.push('');

  for (const section of payload.sections) {
    lines.push(csvRow([section.title]));
    lines.push(csvRow(section.columns));
    for (const row of section.rows) {
      lines.push(csvRow(row));
    }
    lines.push('');
  }

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, safeFilename(payload.title, 'csv'));
}

// ── XLSX ───────────────────────────────────────────────────────────────────

export async function exportXlsx(payload: ReportPayload): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const summary = [
    [payload.title],
    [SUBTITLE],
    [`Generated`, formatTimestamp(payload.generated_at)],
    ['Cohort start', payload.filters.cohort_start],
    ['Cohort end', payload.filters.cohort_end],
    ['Include unverified', payload.filters.include_unverified ? 'Yes' : 'No'],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Filters');

  const used = new Set<string>(['Filters']);
  for (const section of payload.sections) {
    let sheetName = section.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Section';
    let counter = 2;
    while (used.has(sheetName)) {
      const suffix = ` (${counter++})`;
      sheetName = (section.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31 - suffix.length) + suffix).trim();
    }
    used.add(sheetName);

    const aoa: Cell[][] = [section.columns, ...section.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, safeFilename(payload.title, 'xlsx'));
}

// ── PDF ────────────────────────────────────────────────────────────────────

async function loadHeaderImage(): Promise<HTMLImageElement | null> {
  // The user can drop a header image at frontend/public/report-header.png at
  // any time to brand the PDFs. We probe with HEAD first so the failure case
  // is silent (no console 404 spam, no broken-image substitution).
  try {
    const head = await fetch('/report-header.png', { method: 'HEAD' });
    if (!head.ok) return null;
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/report-header.png';
  });
}

export async function exportPdf(payload: ReportPayload): Promise<void> {
  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = (autoTableModule as unknown as { default: (doc: unknown, opts: unknown) => unknown }).default;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  let cursorY = margin;

  const headerImg = await loadHeaderImage();
  if (headerImg && headerImg.width && headerImg.height) {
    const targetWidth = pageWidth - margin * 2;
    const ratio = headerImg.height / headerImg.width;
    const targetHeight = Math.min(80, targetWidth * ratio);
    doc.addImage(headerImg, 'PNG', margin, cursorY, targetWidth, targetHeight);
    cursorY += targetHeight + 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(27, 58, 107); // #1B3A6B
  doc.text(payload.title, margin, cursorY);
  cursorY += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(SUBTITLE, margin, cursorY);
  cursorY += 16;

  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated: ${formatTimestamp(payload.generated_at)}`, margin, cursorY);
  cursorY += 12;
  doc.text(`Filters: ${formatFilters(payload.filters)}`, margin, cursorY);
  cursorY += 18;

  for (const section of payload.sections) {
    if (cursorY > 740) {
      doc.addPage();
      cursorY = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(27, 58, 107);
    doc.text(section.title, margin, cursorY);
    cursorY += 6;

    autoTable(doc, {
      startY: cursorY + 4,
      head: [section.columns],
      body: section.rows.map((r) => r.map((c) => (c == null ? '' : String(c)))),
      theme: 'striped',
      headStyles: { fillColor: [27, 58, 107], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8.5, textColor: 40 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: margin, right: margin },
      didDrawPage: () => {
        const pageNum = doc.getCurrentPageInfo().pageNumber;
        const totalPages = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          `Page ${pageNum} of ${totalPages}  ·  ${SUBTITLE}`,
          margin,
          doc.internal.pageSize.getHeight() - 18,
        );
      },
    });

    // jspdf-autotable mutates lastAutoTable on the doc instance.
    const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    cursorY = (last?.finalY ?? cursorY) + 22;
  }

  doc.save(safeFilename(payload.title, 'pdf'));
}
