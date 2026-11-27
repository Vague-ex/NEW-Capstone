/**
 * The hover card used on every per-batch chart.
 *
 * A percentage alone hides how it was reached: 50% of 4 and 50% of 86 look
 * identical on a line, and "employed" never said how many were not. So the
 * card gives the headcounts, their total, and -- where the masterlist lists
 * the batch -- the size of the whole batch, which is what says how much of it
 * answered at all.
 *
 * Lives here rather than beside one chart because the analytics batch trend
 * and the dashboard's two batch charts are the same question asked three
 * times, and a hover that explains the number on one screen and not the
 * others is how two screens start disagreeing.
 */

export type BatchTooltipRow = {
  year: string;
  /** One sentence under the figures: what the percentage is a share of. */
  detail: string;
  /** Exact headcounts behind the percentage. */
  counts: { yesLabel: string; yes: number; noLabel: string; no: number } | null;
  /**
   * The whole batch, from the masterlist. Null -- not zero -- for a future
   * batch and for one the masterlist does not list yet: a missing row is not
   * a batch of nobody, and showing it as 0 is what made the old dashboard
   * line dive to the axis for 2025.
   */
  graduates: number | null;
};

export function BatchTrendTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: BatchTooltipRow }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs max-w-[240px]">
      <p className="text-gray-900" style={{ fontWeight: 700 }}>{row.year}</p>
      {row.counts && (
        <dl className="mt-1 mb-1.5 space-y-0.5 text-gray-700">
          <div className="flex justify-between gap-4">
            <dt>{row.counts.yesLabel}</dt>
            <dd style={{ fontWeight: 700 }}>{row.counts.yes}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{row.counts.noLabel}</dt>
            <dd style={{ fontWeight: 700 }}>{row.counts.no}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-gray-200 pt-0.5 text-gray-500">
            <dt>Total respondents</dt>
            <dd>{row.counts.yes + row.counts.no}</dd>
          </div>
          {/* The batch itself, under the respondents, so the hover shows how
              much of it answered rather than only the percentage. */}
          {row.graduates != null && (
            <div className="flex justify-between gap-4 text-gray-500">
              <dt>Total graduates</dt>
              <dd>{row.graduates}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-gray-600 mt-0.5 leading-relaxed">{row.detail}</p>
    </div>
  );
}
