import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, ErrorBar,
} from 'recharts';
import {
  TrendingUp, Clock, Brain, AlertCircle, AlertTriangle, Cpu, Table as TableIcon,
  Lightbulb, Users, Target, ShieldCheck, Check, X, Info,
} from 'lucide-react';
import {
  fetchAnalyticsPredictions,
  AnalyticsPredictionsResponse,
  BatchIndicators,
  ModelFactor,
  RateEstimate,
  SkillRow,
  SkillsByBatch,
} from '../../app/api-client';

function pct(v: number | null | undefined, digits = 1): string {
  // Null means no data or a hidden small group. Rendering it as 0% would
  // assert a rate that nobody reported.
  if (v == null) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** Chart point in percent: null leaves a gap instead of plotting a false 0. */
function point(v: number | null | undefined): number | null {
  return v == null ? null : +(v * 100).toFixed(1);
}

function rateValue(r: RateEstimate | undefined): string {
  if (!r || r.n === 0) return '—';
  if (r.suppressed) return 'Hidden';
  return pct(r.rate);
}

function rateDetail(r: RateEstimate | undefined, population: string): string {
  if (!r || r.n === 0) return `No graduates ${population} yet`;
  if (r.suppressed) return `Only ${r.n} ${population}; groups under 5 are hidden`;
  return `Likely between ${pct(r.ci_low, 0)} and ${pct(r.ci_high, 0)} · ${r.n} ${population}`;
}

function rateCell(r: RateEstimate): string {
  if (r.n === 0) return '—';
  if (r.suppressed) return `hidden (n=${r.n})`;
  return `${pct(r.rate)} (${pct(r.ci_low, 0)}–${pct(r.ci_high, 0)})`;
}

/** "18 (20%)" — whole-number count first, share in brackets. */
function countPct(k: number, n: number): string {
  return `${k} (${Math.round((k / n) * 100)}%)`;
}

/** Plain-language summary of one batch's first vs current job alignment. */
function alignmentSentence(b: BatchIndicators): string {
  const first = b.bsis_aligned_first_job;
  const current = b.bsis_aligned_current_job;
  const firstShown = first.n > 0 && first.k != null;
  const currentShown = current.n > 0 && current.k != null;
  // Some respondents never had a job, so the question's base can be smaller than the batch.
  const base = (r: RateEstimate) => (r.n === b.respondents ? '' : ` of the ${r.n} who answered`);
  const lead = `Of Batch ${b.batch}'s ${b.respondents} respondents,`;

  if (!firstShown && !currentShown) {
    return `${lead} too few answered the job alignment questions to show.`;
  }
  if (firstShown && !currentShown) {
    return `${lead} ${countPct(first.k!, first.n)}${base(first)} had a first job aligned with IS.`;
  }
  if (!firstShown && currentShown) {
    return `${lead} ${countPct(current.k!, current.n)}${base(current)} have a current job aligned with IS.`;
  }
  const firstShare = first.k! / first.n;
  const currentShare = current.k! / current.n;
  const move =
    Math.round(currentShare * 100) === Math.round(firstShare * 100)
      ? 'holding at'
      : currentShare > firstShare
        ? 'up to'
        : 'down to';
  return `${lead} ${countPct(first.k!, first.n)}${base(first)} had a first job aligned with IS, ${move} ${countPct(current.k!, current.n)}${base(current)} for their current job.`;
}

function factorReading(f: ModelFactor): string {
  if (!f.clear) return 'No clear link';
  return f.odds_ratio >= 1
    ? `${f.odds_ratio.toFixed(1)}× the odds of finding work within a year`
    : `${(1 / f.odds_ratio).toFixed(1)}× lower odds of finding work within a year`;
}

function skillReading(s: SkillRow, minGroup: number): { text: string; tone: string } {
  const c = s.comparison;
  if (!c) return { text: `Too few graduates to compare (each group needs ${minGroup})`, tone: 'text-gray-400' };
  const points = Math.abs(Math.round(c.difference_points));
  if (!c.clear) return { text: 'No clear difference; the gap could be chance', tone: 'text-gray-500' };
  return c.difference_points > 0
    ? { text: `Employed ${points} points more often`, tone: 'text-emerald-600' }
    : { text: `Employed ${points} points less often`, tone: 'text-red-500' };
}

type TrendView = 'employment' | 'within12';

type TrendRow = {
  year: string;
  observed: number | null;
  observedError: [number, number] | null;
  next: number | null;
  nextError: [number, number] | null;
  detail: string;
};

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendRow }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs max-w-[240px]">
      <p className="text-gray-900" style={{ fontWeight: 700 }}>{row.year}</p>
      <p className="text-gray-600 mt-0.5 leading-relaxed">{row.detail}</p>
    </div>
  );
}

export function AdminAnalyticsPredictions() {
  const [data, setData] = useState<AnalyticsPredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<number | 'all'>('all');
  const [trendView, setTrendView] = useState<TrendView>('employment');
  const [skillKind, setSkillKind] = useState<'technical' | 'soft'>('technical');
  const [rawNumbersOpen, setRawNumbersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // No horizon: the backend projects through next calendar year.
    fetchAnalyticsPredictions(selectedBatch === 'all' ? undefined : selectedBatch)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load analytics');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBatch]);

  const perBatch: BatchIndicators[] = data?.per_batch ?? [];
  // Batches nobody from has answered (e.g. an old masterlist year) only add empty columns.
  const answeredBatches = useMemo(
    () => perBatch.filter((b) => b.respondents > 0).sort((a, b) => a.batch - b.batch),
    [perBatch],
  );
  const overall = data?.overall;
  const outlook = data?.outlook;
  const model = data?.model;
  const activeModel = model?.status === 'active' ? model : null;
  const skills = data?.skills;
  const skillsByBatch: SkillsByBatch | undefined = data?.skills_by_batch;
  const heatmapRows = skillsByBatch ? skillsByBatch[skillKind] : [];
  const rateByBatch = new Map(perBatch.map((b) => [b.batch, b.employment_rate]));
  const futureGraduation = data?.data_issues?.future_graduation ?? 0;
  const simulatedSource = data?.data_source === 'simulated';
  const modelFromSimulation = activeModel?.source === 'simulated' || activeModel?.source === 'simulated-accounts';
  const nextRanges = useMemo(() => (outlook?.available ? outlook.years : []), [outlook]);
  const nextRange = nextRanges[0];

  const trendSeries = useMemo<TrendRow[]>(() => {
    const label = trendView === 'employment' ? 'employed' : 'found work within 12 months';
    const rows: TrendRow[] = answeredBatches.map((b) => {
      const r = trendView === 'employment' ? b.employment_rate : b.employed_within_12_months;
      const value = point(r.rate);
      const low = point(r.ci_low);
      const high = point(r.ci_high);
      const shown = value != null && low != null && high != null;
      return {
        year: String(b.batch),
        observed: shown ? value : null,
        observedError: shown ? ([value - low, high - value] as [number, number]) : null,
        next: null,
        nextError: null,
        detail: shown
          ? `${pct(r.rate, 0)} ${label}. With ${r.n} graduates, the true rate is likely between ${pct(r.ci_low, 0)} and ${pct(r.ci_high, 0)}.`
          : r.n === 0
            ? 'No answers yet.'
            : `Only ${r.n} graduates answered, too few to show.`,
      };
    });
    if (trendView === 'employment') {
      nextRanges.forEach((range, i) => {
        const centre = point(range.centre) ?? 0;
        rows.push({
          year: String(range.batch),
          observed: null,
          observedError: null,
          next: centre,
          nextError: [centre - (point(range.low) ?? 0), (point(range.high) ?? 0) - centre],
          detail: `If this batch does about as well as recent batches, expect ${pct(range.low, 0)} to ${pct(range.high, 0)} employed.${
            i > 0 ? ' The range is wider because it is further ahead.' : ''
          } This is a range, not a prediction.`,
        });
      });
    }
    return rows;
  }, [answeredBatches, nextRanges, trendView]);

  const timeBands = useMemo(
    () => (overall?.time_to_first_job.bands ?? []).map((b) => ({ band: b.label, graduates: b.count })),
    [overall],
  );

  const bsisSeries = useMemo(
    () =>
      answeredBatches.map((b) => ({
        year: String(b.batch),
        firstJob: point(b.bsis_aligned_first_job.rate),
        currentJob: point(b.bsis_aligned_current_job.rate),
        firstJobK: b.bsis_aligned_first_job.k,
        firstJobN: b.bsis_aligned_first_job.n,
        currentJobK: b.bsis_aligned_current_job.k,
        currentJobN: b.bsis_aligned_current_job.n,
      })),
    [answeredBatches],
  );

  const batches = answeredBatches.map((b) => b.batch);
  const expected = overall?.model_expected_within_12_months;
  const checks = activeModel?.checks ?? [];
  const factors = activeModel?.factors ?? [];
  const tfj = overall?.time_to_first_job;

  const cards = [
    {
      label: 'Employment Rate',
      value: rateValue(overall?.employment_rate),
      sub: rateDetail(overall?.employment_rate, 'working or looking for work'),
      icon: TrendingUp,
      bg: 'bg-emerald-50',
      color: 'text-emerald-600',
    },
    {
      label: 'Found Work Within 12 Months',
      value: rateValue(overall?.employed_within_12_months),
      sub:
        rateDetail(overall?.employed_within_12_months, 'with a known answer') +
        (expected?.rate != null ? ` · model expects ${pct(expected.rate, 0)}` : ''),
      icon: Clock,
      bg: 'bg-blue-50',
      color: 'text-blue-600',
    },
    {
      label: 'Response Rate',
      value: pct(overall?.response_rate, 0),
      sub: !overall
        ? '—'
        : overall.masterlist_incomplete
          ? `${overall.respondents} answered, but the masterlist lists only ${overall.graduates}; add the missing graduates`
          : `${overall.respondents} of ${overall.graduates ?? '—'} graduates on the masterlist answered`,
      icon: Users,
      bg: 'bg-green-50',
      color: 'text-green-600',
    },
    {
      label: nextRange ? `Likely Range for Batch ${nextRange.batch}` : 'Likely Range for Next Batches',
      value: nextRange ? `${pct(nextRange.low, 0)}–${pct(nextRange.high, 0)}` : '—',
      sub: nextRange
        ? [
            ...nextRanges.slice(1).map((r) => `Batch ${r.batch}: ${pct(r.low, 0)}–${pct(r.high, 0)}`),
            'Employment if batches do about as well as recent ones. Not a prediction.',
          ].join(' · ')
        : outlook?.reason ?? 'Not enough batches yet',
      icon: Target,
      bg: 'bg-amber-50',
      color: 'text-amber-600',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-[#166534] to-[#14532d] rounded-2xl p-5 text-white">
        <h2 className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
          <Brain className="size-5" /> Employability Trend Analysis
        </h2>
        <p className="text-white/75 text-xs mt-1">
          What graduates reported for each batch and how sure those numbers are, a likely range for the coming
          batches, and the answers at graduation linked with finding work within a year.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span style={{ fontWeight: 600 }}>Summary for batch:</span>
            <select
              value={selectedBatch}
              onChange={(e) => setSelectedBatch(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
            >
              <option value="all">All batches</option>
              {batches.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {loading && <span className="text-gray-400 text-xs">Loading...</span>}
          </div>
          <p className="text-[11px] text-gray-400">
            Changes the summary cards and the time-to-first-job chart. The batch trend always shows every batch.
          </p>
        </div>
        {activeModel ? (
          <p className="text-xs text-gray-400">
            Model {activeModel.version} · trained{' '}
            {activeModel.trained_at ? new Date(activeModel.trained_at).toLocaleDateString() : '—'} ·{' '}
            {modelFromSimulation ? 'simulated graduates' : 'graduate records'} · n ={' '}
            {activeModel.metrics?.n ?? '—'}
          </p>
        ) : model ? (
          <p className="text-xs text-gray-400">No model has passed the acceptance checks yet</p>
        ) : null}
      </div>

      {futureGraduation > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-2.5 items-start">
          <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <p style={{ fontWeight: 700 }}>
              {futureGraduation} graduate {futureGraduation === 1 ? 'record has' : 'records have'} a graduation date
              in the future
            </p>
            <p className="mt-0.5">
              They are left out of every figure on this page. Correct their graduation dates in Verified Graduates;
              new registrations can no longer enter a future date.
            </p>
          </div>
        </div>
      )}

      {/* {overall && overall.sample_accounts > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-2.5 items-start">
          <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <p style={{ fontWeight: 700 }}>
              {overall.sample_accounts} of {overall.respondents} records are seeded sample accounts
            </p>
            <p className="mt-0.5">
              These figures include demonstration graduates, so treat them as a demonstration rather than real
              outcomes. Sample accounts are never used to train the model.
            </p>
          </div>
        </div>
      )} */}

      {modelFromSimulation && !simulatedSource && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-2.5 items-start">
          <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <p style={{ fontWeight: 700 }}>The active model was trained on simulated graduates</p>
            <p className="mt-0.5">
              Its factors show how the method works, not what drives employment for CHMSU graduates. Retrain on
              graduate records once enough responses are collected.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-2 items-start text-sm text-red-700">
          <AlertCircle className="size-4 mt-0.5" />
          <div>
            <p style={{ fontWeight: 600 }}>Unable to load analytics</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 gt-stagger">
        {cards.map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${k.bg}`}>
                <k.icon className={`size-5 ${k.color}`} />
              </div>
            </div>
            <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1 }}>
              {k.value}
            </p>
            <p className="text-gray-500 text-sm mt-1" style={{ fontWeight: 500 }}>
              {k.label}
            </p>
            <p className="text-gray-400 text-xs mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-500 -mt-1 leading-relaxed flex gap-1.5">
        <Info className="size-3.5 shrink-0 mt-0.5 text-gray-400" />
        <div className="space-y-1">
          <p>
            <span style={{ fontWeight: 600 }}>Why ranges?</span> Only some graduates answer, so every rate is an
            estimate. &ldquo;Likely between&rdquo; is the 95% range: with this many answers, the true rate is very
            probably inside it. Fewer answers means a wider range.
          </p>
          <p>
            <span style={{ fontWeight: 600 }}>Hidden</span> means fewer than 5 graduates answered. The number is not
            shown, because it would be unreliable and could point to individual people. It is never shown as 0%.
          </p>
        </div>
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        <div className="min-w-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <TrendingUp className="size-4 text-[#166534]" /> Batch Trend
            </h3>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                {(['employment', 'within12'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTrendView(v)}
                    className={`px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs transition ${
                      trendView === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                    }`}
                    style={{ fontWeight: trendView === v ? 600 : 400 }}
                  >
                    {v === 'employment' ? 'Employment' : 'Within 12 months'}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setRawNumbersOpen(true)}
                disabled={perBatch.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ fontWeight: 600 }}
              >
                <TableIcon className="size-3.5" /> View raw numbers
              </button>
            </div>
          </div>

          <p className="text-gray-500 text-xs mb-4 leading-relaxed">
            {trendView === 'employment'
              ? 'Each dot is the share of a batch that is employed, among graduates working or looking for work. The line through it is the likely range. The orange marks are the likely ranges for the coming batches if they do about as well as recent batches; each year further ahead is wider.'
              : 'Each dot is the share of a batch that found a first job within 12 months of graduating. The line through it is the likely range.'}{' '}
            Hover a dot for details.
          </p>
          {trendSeries.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
              {loading ? 'Loading...' : 'No data'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={trendSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip content={<TrendTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="linear"
                  dataKey="observed"
                  name="Reported rate (line = likely range)"
                  stroke="#166534"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#166534' }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  isAnimationActive={false}
                >
                  <ErrorBar dataKey="observedError" width={6} strokeWidth={1.5} stroke="#166534" direction="y" />
                </Line>
                {trendView === 'employment' && (
                  <Line
                    type="linear"
                    dataKey="next"
                    name="Likely range for coming batches"
                    stroke="#f59e0b"
                    strokeWidth={0}
                    dot={{ r: 5, fill: '#f59e0b' }}
                    connectNulls={false}
                    isAnimationActive={false}
                  >
                    <ErrorBar dataKey="nextError" width={8} strokeWidth={2} stroke="#f59e0b" direction="y" />
                  </Line>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="min-w-0 flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <h3 className="text-gray-800 flex items-center gap-2 mb-1" style={{ fontWeight: 700 }}>
            <Clock className="size-4 text-[#166534]" /> Time to First Job ·{' '}
            <span className="text-gray-500 text-xs" style={{ fontWeight: 500 }}>
              {selectedBatch === 'all' ? 'All batches' : `Batch ${selectedBatch}`}
            </span>
          </h3>
          <p className="text-gray-500 text-xs mb-4">
            How long graduates who have had a job took to get their first one{tfj ? ` (${tfj.n} graduates)` : ''}.
            These are their answers, not a prediction.
          </p>
          {/* flex-1 so the chart fills the card, which stretches to match the
              taller trend card beside it; min-h keeps it readable when stacked. */}
          {!tfj || tfj.n === 0 ? (
            <div className="flex-1 min-h-[260px] flex items-center justify-center text-gray-400 text-sm">
              {loading ? 'Loading...' : 'No graduates have reported a first job yet'}
            </div>
          ) : tfj.suppressed ? (
            <div className="flex-1 min-h-[260px] flex items-center justify-center text-gray-400 text-sm text-center px-6">
              Only {tfj.n} graduates reported a first job; groups under 5 are hidden.
            </div>
          ) : (
            <div className="flex-1 min-h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeBands} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="band" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [`${v} graduates`, 'Count']} />
                  <Bar dataKey="graduates" name="Graduates" fill="#166534" radius={[3, 3, 0, 0]} maxBarSize={96} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Factors from the active model ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
          <ShieldCheck className="size-4 text-[#166534]" /> What Is Linked with Finding Work Within a Year
        </h3>
        <p className="text-gray-500 text-xs mt-1 mb-4 leading-relaxed">
          Compares graduates by four answers known at graduation: Latin honors, work experience before graduating, a
          portfolio, and a scholarship. Shown only once a model passes every acceptance check. &ldquo;2× the
          odds&rdquo; means graduates with that answer were twice as likely, in odds terms, to find work within a
          year. It is a link, not proof of cause.
        </p>

        {factors.length === 0 ? (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-xs text-gray-600 leading-relaxed">
            {loading
              ? 'Loading...'
              : 'No model has passed the acceptance checks yet, so no factors are shown. This is expected until enough graduates have answered: with too few answers, any "factor" would likely be chance.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Answer at graduation', 'Odds ratio', 'Likely range', 'What it means'].map((h) => (
                    <th key={h} className="text-left text-gray-400 text-xs pb-2 pr-4" style={{ fontWeight: 600 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {factors.map((f) => (
                  <tr key={f.feature}>
                    <td className="py-2.5 pr-4 text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                      {f.label}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-700 text-xs">{f.odds_ratio.toFixed(2)}</td>
                    <td className="py-2.5 pr-4 text-gray-500 text-xs whitespace-nowrap">
                      {f.ci_low.toFixed(2)}–{f.ci_high.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      <span
                        className={!f.clear ? 'text-gray-400' : f.odds_ratio >= 1 ? 'text-emerald-600' : 'text-red-500'}
                        style={{ fontWeight: 600 }}
                      >
                        {factorReading(f)}
                      </span>
                      {f.clear && !f.stable && <span className="ml-2 text-[11px] text-amber-600">unstable</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {checks.length > 0 && (
          <details className="mt-4 rounded-xl border border-gray-100 p-3">
            <summary className="cursor-pointer text-xs text-gray-600" style={{ fontWeight: 600 }}>
              Acceptance checks: {checks.filter((c) => c.passed).length} of {checks.length} passed
            </summary>
            <ul className="mt-3 space-y-2">
              {checks.map((c) => (
                <li key={c.key} className="flex gap-2 text-xs">
                  {c.passed ? (
                    <Check className="size-4 text-emerald-600 shrink-0" />
                  ) : (
                    <X className="size-4 text-red-500 shrink-0" />
                  )}
                  <div>
                    <p className="text-gray-800" style={{ fontWeight: 600 }}>
                      {c.label}
                    </p>
                    <p className="text-gray-600">{c.value}</p>
                    <p className="text-gray-400">Rule: {c.rule}</p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* ── Skills by Batch ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Users className="size-4 text-[#166534]" /> Skills by Batch
            </h3>
            <p className="text-gray-500 text-xs mt-1 leading-relaxed max-w-2xl">
              What share of each batch listed each skill, beside the batch&apos;s employment rate. Darker cells mean more
              of that batch listed the skill. Read it as a trend: batches also differ in job market and years since
              graduating, and graduates list the skills they have now, including ones learned at work.
            </p>
          </div>
          <div className="inline-flex shrink-0 rounded-lg border border-gray-200 p-0.5">
            {(['technical', 'soft'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setSkillKind(kind)}
                className={`px-3 py-1.5 rounded-md text-xs transition ${skillKind === kind ? 'bg-[#166534] text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                style={{ fontWeight: 600 }}
              >
                {kind === 'technical' ? 'Technical' : 'Soft'}
              </button>
            ))}
          </div>
        </div>

        {!skillsByBatch || skillsByBatch.batches.length === 0 || heatmapRows.length === 0 ? (
          <div className="h-[140px] flex items-center justify-center text-gray-400 text-sm text-center px-6">
            {loading
              ? 'Loading...'
              : `No ${skillKind} skill has been listed by at least ${skillsByBatch?.min_group ?? 5} graduates yet.`}
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs border-separate" style={{ borderSpacing: '3px' }}>
              <thead>
                <tr>
                  <th className="text-left text-gray-400 pb-1 pr-3 whitespace-nowrap" style={{ fontWeight: 600 }}>
                    Skill
                  </th>
                  {skillsByBatch.batches.map((c) => {
                    const picked = selectedBatch === c.batch;
                    return (
                      <th
                        key={c.batch}
                        className={`pb-1 px-1 whitespace-nowrap rounded-t-md ${picked ? 'text-[#166534] bg-[#166534]/10' : 'text-gray-500'}`}
                        style={{ fontWeight: picked ? 700 : 600 }}
                      >
                        {c.batch}
                        <span className="block text-[10px] text-gray-400" style={{ fontWeight: 400 }}>
                          {c.respondents} {c.respondents === 1 ? 'grad' : 'grads'}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {heatmapRows.map((row) => (
                  <tr key={row.skill}>
                    <td className="pr-3 py-1 text-gray-800 whitespace-nowrap" style={{ fontWeight: 600 }}>
                      {row.skill}
                    </td>
                    {row.cells.map((cell) => {
                      const picked = selectedBatch === cell.batch;
                      if (cell.share == null) {
                        return (
                          <td
                            key={cell.batch}
                            title={`Fewer than ${skillsByBatch.min_group} graduates in this batch listed skills`}
                            className={`text-center py-2 rounded-md text-gray-300 bg-gray-50 ${picked ? 'ring-2 ring-[#166534]' : ''}`}
                          >
                            —
                          </td>
                        );
                      }
                      const strong = cell.share >= 0.45;
                      return (
                        <td
                          key={cell.batch}
                          title={`${cell.count} of ${skillsByBatch.batches.find((b) => b.batch === cell.batch)?.respondents ?? 0} graduates in ${cell.batch} listed ${row.skill}`}
                          className={`text-center py-2 rounded-md ${picked ? 'ring-2 ring-[#166534]' : ''}`}
                          style={{
                            backgroundColor: `rgba(22, 101, 52, ${(0.06 + cell.share * 0.85).toFixed(2)})`,
                            color: strong ? '#ffffff' : '#14532d',
                            fontWeight: 600,
                          }}
                        >
                          {pct(cell.share, 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="pr-3 pt-3 text-gray-800 whitespace-nowrap border-t border-gray-100" style={{ fontWeight: 700 }}>
                    Employment rate
                  </td>
                  {skillsByBatch.batches.map((c) => {
                    const picked = selectedBatch === c.batch;
                    const rate = rateByBatch.get(c.batch);
                    return (
                      <td
                        key={c.batch}
                        className={`text-center pt-3 border-t border-gray-100 whitespace-nowrap ${picked ? 'text-[#166534]' : 'text-gray-700'}`}
                        style={{ fontWeight: 700 }}
                      >
                        {rateValue(rate)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            <p className="text-[11px] text-gray-400 mt-3">
              Hover a cell for counts. A batch where fewer than {skillsByBatch.min_group} graduates listed skills is shown
              as &quot;—&quot;.{selectedBatch !== 'all' && ` Batch ${selectedBatch} is outlined.`} For whether a skill goes
              with being employed, see the with vs without comparison in the next table.
            </p>
          </div>
        )}
      </div>

      {/* ── Skills ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
          <Lightbulb className="size-4 text-[#166534]" /> Skills Graduates Listed
        </h3>
        <p className="text-gray-500 text-xs mt-1 leading-relaxed">
          The most common skills among the {skills?.respondents ?? 0} graduates who filled in the skills checklist.
          The last two columns compare graduates who listed the skill with those who did not, among graduates working
          or looking for work. A difference is a link, not proof the skill got them hired; graduates also learn
          skills on the job.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 mb-4 text-[11px] text-gray-500">
          <p className="rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-gray-700" style={{ fontWeight: 600 }}>Listed by:</span> share of graduates who
            ticked the skill.
          </p>
          <p className="rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-gray-700" style={{ fontWeight: 600 }}>Employed, with vs without:</span> employment
            rate of graduates who listed it, then of those who did not.
          </p>
          <p className="rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-gray-700" style={{ fontWeight: 600 }}>Points:</span> the gap between those two
            rates. 80% vs 70% is 10 points.
          </p>
        </div>
        {!skills || skills.skills.length === 0 ? (
          <div className="h-[140px] flex items-center justify-center text-gray-400 text-sm text-center px-6">
            {loading
              ? 'Loading...'
              : `No skill has been listed by at least ${skills?.min_group ?? 5} graduates yet.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Skill', 'Type', 'Listed by', 'Employed, with vs without', 'What it means'].map((h) => (
                    <th key={h} className="text-left text-gray-400 text-xs pb-2 pr-4 whitespace-nowrap" style={{ fontWeight: 600 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {skills.skills.map((s) => {
                  const reading = skillReading(s, skills.min_group);
                  return (
                    <tr key={s.skill}>
                      <td className="py-2.5 pr-4 text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                        {s.skill}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full ${
                            s.kind === 'technical' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                          }`}
                          style={{ fontWeight: 600 }}
                        >
                          {s.kind}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                        <span className="text-gray-700" style={{ fontWeight: 600 }}>{pct(s.share, 0)}</span>
                        <span className="text-gray-400 ml-1">
                          ({s.graduates} of {skills.respondents})
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                        {s.comparison ? (
                          <>
                            <span className="text-gray-700" style={{ fontWeight: 600 }}>
                              {pct(s.comparison.with_rate, 0)} vs {pct(s.comparison.without_rate, 0)}
                            </span>
                            <span className="text-gray-400 ml-1">
                              ({s.comparison.with_n} vs {s.comparison.without_n})
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={`py-2.5 pr-4 text-xs ${reading.tone}`} style={{ fontWeight: 600 }}>
                        {reading.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {skills && skills.hidden_skills > 0 && (
          <p className="text-[11px] text-gray-400 mt-3">
            {skills.hidden_skills} other {skills.hidden_skills === 1 ? 'skill was' : 'skills were'} listed by fewer
            than {skills.min_group} graduates and {skills.hidden_skills === 1 ? 'is' : 'are'} not shown.
          </p>
        )}
      </div>

      {/* ── BSIS Alignment (Observed) ───────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
        <div className="mb-3">
          <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Cpu className="size-4 text-[#166534]" /> Jobs Related to BSIS
          </h3>
          <p className="text-gray-500 text-xs mt-1">
            How many graduates in each batch said their first and current job is aligned with IS. Batches with fewer
            than 5 answers are left blank.
          </p>
        </div>
        {bsisSeries.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Loading...' : 'No data'}
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bsisSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  formatter={(v: number, _name, item) => {
                    const row = item.payload as (typeof bsisSeries)[number];
                    const isFirst = item.dataKey === 'firstJob';
                    const k = isFirst ? row.firstJobK : row.currentJobK;
                    const n = isFirst ? row.firstJobN : row.currentJobN;
                    return k == null ? `${v}%` : `${k} of ${n} (${Math.round(v)}%)`;
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="firstJob" name="First Job" fill="#166534" radius={[3, 3, 0, 0]} />
                <Bar dataKey="currentJob" name="Current Job" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {answeredBatches.map((b) => (
                <div key={b.batch} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-gray-800 text-sm" style={{ fontWeight: 700 }}>
                      Batch {b.batch}
                    </span>
                    <span className="text-gray-400 text-[11px]">{b.respondents} respondents</span>
                  </div>
                  <p className="text-gray-600 text-xs mt-1 leading-relaxed">{alignmentSentence(b)}</p>
                  <div className="mt-2.5 space-y-2">
                    {(
                      [
                        ['First job', b.bsis_aligned_first_job, 'bg-[#166534]'],
                        ['Current job', b.bsis_aligned_current_job, 'bg-[#f59e0b]'],
                      ] as const
                    ).map(([label, r, fill]) => (
                      <div key={label}>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500" style={{ fontWeight: 600 }}>
                            {label}
                          </span>
                          {r.n === 0 ? (
                            <span className="text-gray-400">No answers</span>
                          ) : r.k == null ? (
                            <span className="text-gray-400">Only {r.n} answered, hidden</span>
                          ) : (
                            <span className="text-gray-600">
                              <span style={{ fontWeight: 600 }}>{countPct(r.k, r.n)}</span> aligned ·{' '}
                              {countPct(r.n - r.k, r.n)} not
                            </span>
                          )}
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                          {r.k != null && r.n > 0 && (
                            <div className={`h-full ${fill}`} style={{ width: `${(r.k / r.n) * 100}%` }} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Raw numbers modal ────────────────────────────────────────────── */}
      {rawNumbersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setRawNumbersOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
                Per-Batch Numbers
              </h3>
              <button
                onClick={() => setRawNumbersOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-400 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-gray-500 mb-3">Values in brackets are the likely (95%) range.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {[
                        'Batch',
                        'Graduates',
                        'Answered',
                        'Response',
                        'Employed',
                        'Work within 12 mo',
                        'BSIS first job',
                        'BSIS current job',
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-gray-400 text-xs pb-2 pr-4 whitespace-nowrap"
                          style={{ fontWeight: 600 }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {perBatch.map((b) => (
                      <tr key={b.batch}>
                        <td className="py-2.5 pr-4 text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                          {b.batch}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600 text-xs">{b.graduates ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-gray-600 text-xs">{b.respondents}</td>
                        <td className="py-2.5 pr-4 text-gray-600 text-xs">
                          {b.masterlist_incomplete ? 'masterlist incomplete' : pct(b.response_rate, 0)}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-700 text-xs whitespace-nowrap" style={{ fontWeight: 600 }}>
                          {rateCell(b.employment_rate)}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-700 text-xs whitespace-nowrap" style={{ fontWeight: 600 }}>
                          {rateCell(b.employed_within_12_months)}
                        </td>
                        <td className="py-2.5 pr-4 text-purple-600 text-xs whitespace-nowrap">
                          {rateCell(b.bsis_aligned_first_job)}
                        </td>
                        <td className="py-2.5 pr-4 text-amber-600 text-xs whitespace-nowrap">
                          {rateCell(b.bsis_aligned_current_job)}
                        </td>
                      </tr>
                    ))}
                    {perBatch.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-gray-400 text-xs">
                          No batch data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
