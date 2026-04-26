import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  LineChart, BarChart,
} from 'recharts';
import {
  TrendingUp, Clock, Zap, Brain, AlertCircle, Cpu, Table as TableIcon, Sparkles,
  Lightbulb, ArrowUpRight,
} from 'lucide-react';
import {
  fetchAnalyticsPredictions,
  AnalyticsPredictionsResponse,
  BatchPrediction,
  BatchForecast,
  SkillForecast,
} from '../../app/api-client';

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function AdminAnalyticsPredictions() {
  const [data, setData] = useState<AnalyticsPredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<number | 'all'>('all');
  const [projectionView, setProjectionView] = useState<'employment' | 'hire'>('employment');
  const [rawNumbersOpen, setRawNumbersOpen] = useState(false);
  const [horizon, setHorizon] = useState<1 | 2>(2);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnalyticsPredictions(selectedBatch === 'all' ? undefined : selectedBatch, horizon)
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
  }, [selectedBatch, horizon]);

  const perBatch: BatchPrediction[] = data?.per_batch ?? [];
  const forecastList: BatchForecast[] = data?.forecast ?? [];
  const skillForecast: SkillForecast[] = data?.skill_forecast ?? [];
  const overall = data?.overall;
  const [distributionYearIdx, setDistributionYearIdx] = useState<number>(-1);

  type EmpRow = {
    year: string;
    actual: number | null;
    forecast: number | null;
    forecastBand: [number, number] | null;
  };
  type HireRow = {
    year: string;
    actual: number | null;
    forecast: number | null;
    forecastBand: [number, number] | null;
  };

  const employmentSeries = useMemo<EmpRow[]>(() => {
    const historical: EmpRow[] = perBatch.map((c) => ({
      year: String(c.batch),
      actual: +(c.actual_employment_rate * 100).toFixed(1),
      forecast: null,
      forecastBand: null,
    }));
    const forecast: EmpRow[] = forecastList.map((f) => ({
      year: String(f.batch),
      actual: null,
      forecast: +(f.predicted_employment_rate * 100).toFixed(1),
      forecastBand: [
        +(f.employment_rate_lo * 100).toFixed(1),
        +(f.employment_rate_hi * 100).toFixed(1),
      ],
    }));
    if (perBatch.length > 0 && forecast.length > 0) {
      historical[historical.length - 1] = {
        ...historical[historical.length - 1],
        forecast: historical[historical.length - 1].actual,
      };
    }
    return [...historical, ...forecast];
  }, [perBatch, forecastList]);

  const hireSeries = useMemo<HireRow[]>(() => {
    const historical: HireRow[] = perBatch.map((c) => ({
      year: String(c.batch),
      actual: +c.actual_mean_time_to_hire_months.toFixed(2),
      forecast: null,
      forecastBand: null,
    }));
    const forecast: HireRow[] = forecastList.map((f) => ({
      year: String(f.batch),
      actual: null,
      forecast: +f.predicted_mean_time_to_hire_months.toFixed(2),
      forecastBand: [
        +f.time_to_hire_lo.toFixed(2),
        +f.time_to_hire_hi.toFixed(2),
      ],
    }));
    if (perBatch.length > 0 && forecast.length > 0) {
      historical[historical.length - 1] = {
        ...historical[historical.length - 1],
        forecast: historical[historical.length - 1].actual,
      };
    }
    return [...historical, ...forecast];
  }, [perBatch, forecastList]);

  const bsisObservedSeries = useMemo(
    () =>
      perBatch.map((c) => ({
        year: String(c.batch),
        firstJob: +(c.actual_bsis_first_rate * 100).toFixed(1),
        currentJob: +(c.actual_bsis_current_rate * 100).toFixed(1),
      })),
    [perBatch],
  );

  const distributionSource = useMemo(() => {
    if (distributionYearIdx >= 0 && forecastList[distributionYearIdx]) {
      return {
        label: `Forecast ${forecastList[distributionYearIdx].batch}`,
        dist: forecastList[distributionYearIdx].time_to_hire_distribution,
      };
    }
    return {
      label: 'Observed (all batches)',
      dist: overall?.time_to_hire_distribution ?? {},
    };
  }, [distributionYearIdx, forecastList, overall]);

  const distribution = useMemo(
    () => Object.entries(distributionSource.dist).map(([bucket, n]) => ({ bucket, n })),
    [distributionSource],
  );

  const batches = perBatch.map((c) => c.batch);
  const observedHire = overall?.actual_mean_time_to_hire_months ?? 0;
  const observedEmp = overall?.actual_employment_rate ?? 0;
  const nextForecast = forecastList[0];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-[#1B3A6B] to-[#2c5599] rounded-2xl p-5 text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              <Brain className="size-5" /> Employability Prediction Trend
            </h2>
            <p className="text-white/75 text-xs mt-1">
              Predicted employability and skill demand for the next {horizon}{' '}
              graduating {horizon === 1 ? 'batch' : 'batches'}, based on historical
              alumni outcomes.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-white/70" style={{ fontWeight: 600 }}>Forecast:</span>
            <div className="flex gap-1 bg-white/10 rounded-lg p-1">
              {([1, 2] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`px-2.5 py-1 rounded-lg transition ${
                    horizon === h
                      ? 'bg-white text-[#1B3A6B]'
                      : 'text-white/80 hover:text-white'
                  }`}
                  style={{ fontWeight: horizon === h ? 700 : 500 }}
                >
                  Next {h} {h === 1 ? 'batch' : 'batches'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span style={{ fontWeight: 600 }}>Batch:</span>
          <select
            value={selectedBatch}
            onChange={(e) =>
              setSelectedBatch(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
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
        {data?.model_metadata && (
          <p className="text-xs text-gray-400">
            Model trained {new Date(data.model_metadata.trained_at).toLocaleString()} · n=
            {data.model_metadata.n_samples} · {data.model_metadata.n_features} features
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-2 items-start text-sm text-red-700">
          <AlertCircle className="size-4 mt-0.5" />
          <div>
            <p style={{ fontWeight: 600 }}>Unable to load predictions</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Observed Employment Rate',
            value: pct(observedEmp),
            sub: `${overall?.n_alumni ?? 0} alumni in sample`,
            icon: TrendingUp,
            bg: 'bg-emerald-50',
            color: 'text-emerald-600',
            trend: '',
          },
          {
            label: 'Observed Time-to-Hire',
            value: `${observedHire.toFixed(1)}mo`,
            sub: 'Mean across employed alumni',
            icon: Clock,
            bg: 'bg-blue-50',
            color: 'text-blue-600',
            trend: '',
          },
          {
            label: nextForecast
              ? `Forecast Employment (${nextForecast.batch})`
              : 'Forecast Employment',
            value: nextForecast ? pct(nextForecast.predicted_employment_rate) : '—',
            sub: nextForecast
              ? `80% PI: ${pct(nextForecast.employment_rate_lo)}–${pct(nextForecast.employment_rate_hi)}`
              : 'Need ≥2 batches to forecast',
            icon: Sparkles,
            bg: 'bg-violet-50',
            color: 'text-violet-600',
            trend: '',
          },
          {
            label: nextForecast
              ? `Forecast Time-to-Hire (${nextForecast.batch})`
              : 'Forecast Time-to-Hire',
            value: nextForecast
              ? `${nextForecast.predicted_mean_time_to_hire_months.toFixed(1)}mo`
              : '—',
            sub: nextForecast
              ? `80% PI: ${nextForecast.time_to_hire_lo.toFixed(1)}–${nextForecast.time_to_hire_hi.toFixed(1)}mo`
              : 'Need ≥2 batches to forecast',
            icon: Sparkles,
            bg: 'bg-amber-50',
            color: 'text-amber-600',
            trend: '',
          },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${k.bg}`}>
                <k.icon className={`size-5 ${k.color}`} />
              </div>
              {k.trend && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-600"
                  style={{ fontWeight: 600 }}
                >
                  {k.trend}
                </span>
              )}
            </div>
            <p
              className="text-gray-900"
              style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1 }}
            >
              {k.value}
            </p>
            <p className="text-gray-500 text-sm mt-1" style={{ fontWeight: 500 }}>
              {k.label}
            </p>
            <p className="text-gray-400 text-xs mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Zap className="size-4 text-[#1B3A6B]" /> Batch Trend & Forecast
          </h3>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(['employment', 'hire'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setProjectionView(v)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs transition ${
                    projectionView === v
                      ? 'bg-white shadow-sm text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  style={{ fontWeight: projectionView === v ? 600 : 400 }}
                >
                  {v === 'hire' ? 'Time-to-Hire' : 'Employment'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setRawNumbersOpen(true)}
              disabled={perBatch.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ fontWeight: 600 }}
            >
              <TableIcon className="size-3.5" /> View raw numbers
            </button>
          </div>
        </div>

        {projectionView === 'employment' && (
          <>
            <p className="text-gray-500 text-xs mb-4">
              Observed employment rate per batch with forecast (shaded 80% PI)
              for the next {forecastList.length || horizon} {forecastList.length === 1 || horizon === 1 ? 'batch' : 'batches'}. Forecast model:{' '}
              {data?.model_metadata.best_models.employment_status ?? '—'}.
            </p>
            {employmentSeries.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
                {loading ? 'Loading predictions...' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={employmentSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip
                    formatter={(v: number | [number, number]) =>
                      Array.isArray(v) ? `${v[0]}% – ${v[1]}%` : `${v}%`
                    }
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="forecastBand"
                    name="Forecast 80% PI"
                    stroke="none"
                    fill="#8b5cf6"
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Observed"
                    stroke="#1B3A6B"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#1B3A6B' }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    name="Forecast"
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                    dot={{ r: 4, fill: '#8b5cf6' }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </>
        )}

        {projectionView === 'hire' && (
          <>
            <p className="text-gray-500 text-xs mb-4">
              Observed mean time-to-hire (months) with forecast (shaded 80% PI)
              for the next {forecastList.length || horizon} {forecastList.length === 1 || horizon === 1 ? 'batch' : 'batches'}. Forecast model:{' '}
              {data?.model_metadata.best_models.time_to_hire ?? '—'}.
            </p>
            {hireSeries.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">
                {loading ? 'Loading predictions...' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={hireSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="mo" />
                  <Tooltip
                    formatter={(v: number | [number, number]) =>
                      Array.isArray(v) ? `${v[0]} – ${v[1]} mo` : `${v} months`
                    }
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="forecastBand"
                    name="Forecast 80% PI"
                    stroke="none"
                    fill="#8b5cf6"
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Observed"
                    stroke="#1B3A6B"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#1B3A6B' }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast"
                    name="Forecast"
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                    dot={{ r: 4, fill: '#8b5cf6' }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Clock className="size-4 text-[#1B3A6B]" /> Time-to-Hire Distribution ·{' '}
            <span className="text-gray-500 text-xs" style={{ fontWeight: 500 }}>
              {distributionSource.label}
            </span>
          </h3>
          {forecastList.length > 0 && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 self-start sm:self-auto">
              <button
                onClick={() => setDistributionYearIdx(-1)}
                className={`px-2.5 py-1 rounded-lg text-xs transition ${
                  distributionYearIdx === -1
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                style={{ fontWeight: distributionYearIdx === -1 ? 600 : 400 }}
              >
                Observed
              </button>
              {forecastList.map((f, i) => (
                <button
                  key={f.batch}
                  onClick={() => setDistributionYearIdx(i)}
                  className={`px-2.5 py-1 rounded-lg text-xs transition ${
                    distributionYearIdx === i
                      ? 'bg-white shadow-sm text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  style={{ fontWeight: distributionYearIdx === i ? 600 : 400 }}
                >
                  Forecast {f.batch}
                </button>
              ))}
            </div>
          )}
        </div>
        {distribution.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Loading...' : 'No data'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={distribution} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ttDistFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1B3A6B" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#1B3A6B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [`${v} alumni`, 'Count']} />
              <Line
                type="monotone"
                dataKey="n"
                name="Alumni count"
                stroke="#1B3A6B"
                strokeWidth={2.5}
                dot={{ r: 5, fill: '#1B3A6B' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Top Skills Forecast ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Lightbulb className="size-4 text-[#1B3A6B]" /> Top Skills for Next Batches
            </h3>
            <p className="text-gray-500 text-xs mt-1">
              Ranked by projected demand share, employment-lift (alumni holding the
              skill are more likely to be employed), and growth slope. Use this to
              advise current students on which skills to double down on.
            </p>
          </div>
        </div>
        {skillForecast.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Loading...' : 'Need ≥2 batches of skill data to forecast'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['#', 'Skill', 'Type', 'Current', 'Forecast', 'Lift', 'Trend'].map((h) => (
                    <th
                      key={h}
                      className="text-left text-gray-400 text-xs pb-2 pr-4"
                      style={{ fontWeight: 600 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {skillForecast.map((s, idx) => {
                  const next = s.projections[0];
                  const last = s.projections[s.projections.length - 1];
                  const liftPct = (s.lift * 100).toFixed(1);
                  const liftPositive = s.lift > 0.01;
                  const liftNegative = s.lift < -0.01;
                  return (
                    <tr key={s.skill}>
                      <td className="py-2.5 pr-4">
                        <span className="text-gray-400 text-xs" style={{ fontWeight: 600 }}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                          {s.skill}
                        </span>
                        <p className="text-gray-400 text-[11px] mt-0.5">
                          {s.holders_total} alumni hold this
                        </p>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full ${
                            s.kind === 'technical'
                              ? 'bg-blue-50 text-blue-600'
                              : 'bg-emerald-50 text-emerald-600'
                          }`}
                          style={{ fontWeight: 600 }}
                        >
                          {s.kind}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="text-gray-600 text-xs">
                          {pct(s.current_share)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="text-violet-600 text-xs" style={{ fontWeight: 600 }}>
                          {next ? pct(next.projected_share) : '—'}
                        </span>
                        {last && last !== next && (
                          <span className="text-gray-400 text-[11px] ml-1">
                            → {pct(last.projected_share)} ({last.batch})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`text-xs ${
                            liftPositive
                              ? 'text-emerald-600'
                              : liftNegative
                                ? 'text-red-500'
                                : 'text-gray-400'
                          }`}
                          style={{ fontWeight: 600 }}
                        >
                          {s.lift > 0 ? '+' : ''}
                          {liftPct} pp
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            s.slope_per_year > 0.005
                              ? 'text-emerald-600'
                              : s.slope_per_year < -0.005
                                ? 'text-red-500'
                                : 'text-gray-400'
                          }`}
                          style={{ fontWeight: 600 }}
                        >
                          <ArrowUpRight
                            className="size-3"
                            style={{
                              transform:
                                s.slope_per_year < 0
                                  ? 'rotate(90deg)'
                                  : s.slope_per_year < 0.005
                                    ? 'rotate(45deg)'
                                    : 'none',
                            }}
                          />
                          {(s.slope_per_year * 100).toFixed(2)}%/yr
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── BSIS Alignment (Observed Only — Subordinate) ─────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-gray-800 flex items-center gap-2" style={{ fontWeight: 700 }}>
              <Cpu className="size-4 text-[#1B3A6B]" /> BSIS-Aligned Employment (Observed)
            </h3>
            <p className="text-gray-500 text-xs mt-1">
              Share of alumni whose first / current job aligns with the BSIS program.
              Observed values only — no model prediction.
            </p>
          </div>
        </div>
        {bsisObservedSeries.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Loading...' : 'No data'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bsisObservedSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="firstJob" name="First Job" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="currentJob" name="Current Job" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Raw numbers modal ────────────────────────────────────────────── */}
      {rawNumbersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setRawNumbersOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-gray-900" style={{ fontWeight: 700 }}>
                Per-Batch Raw Numbers
              </h3>
              <button
                onClick={() => setRawNumbersOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-400 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {[
                        'Batch',
                        'N',
                        'Employment Rate',
                        'Time-to-Hire (mo)',
                        'BSIS 1st Job',
                        'BSIS Current',
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-gray-400 text-xs pb-2 pr-4"
                          style={{ fontWeight: 600 }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {perBatch.map((c) => (
                      <tr key={c.batch}>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                            {c.batch}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-600 text-xs">{c.n_alumni}</span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-700 text-xs" style={{ fontWeight: 600 }}>
                            {pct(c.actual_employment_rate)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-700 text-xs" style={{ fontWeight: 600 }}>
                            {c.actual_mean_time_to_hire_months.toFixed(1)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-purple-600 text-xs" style={{ fontWeight: 600 }}>
                            {pct(c.actual_bsis_first_rate)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-amber-600 text-xs" style={{ fontWeight: 600 }}>
                            {pct(c.actual_bsis_current_rate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {perBatch.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-gray-400 text-xs">
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
