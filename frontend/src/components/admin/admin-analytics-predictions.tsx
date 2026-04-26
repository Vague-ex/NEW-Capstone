import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, RadarChart,
  Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import {
  TrendingUp, Clock, Zap, BarChart2, Brain, AlertCircle, Cpu, Table as TableIcon,
} from 'lucide-react';
import {
  fetchAnalyticsPredictions,
  AnalyticsPredictionsResponse,
  CohortPrediction,
} from '../../app/api-client';

const TARGET_LABELS: Record<string, string> = {
  time_to_hire: 'Time-to-Hire',
  employment_status: 'Employment Status',
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function AdminAnalyticsPredictions() {
  const [data, setData] = useState<AnalyticsPredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCohort, setSelectedCohort] = useState<number | 'all'>('all');
  const [projectionView, setProjectionView] = useState<'employment' | 'hire'>('employment');
  const [rawNumbersOpen, setRawNumbersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnalyticsPredictions(selectedCohort === 'all' ? undefined : selectedCohort)
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
  }, [selectedCohort]);

  const perCohort: CohortPrediction[] = data?.per_cohort ?? [];
  const overall = data?.overall;

  const employmentSeries = useMemo(
    () =>
      perCohort.map((c) => ({
        year: String(c.cohort),
        actual: +(c.actual_employment_rate * 100).toFixed(1),
        predicted: +(c.predicted_employment_rate * 100).toFixed(1),
      })),
    [perCohort],
  );

  const hireSeries = useMemo(
    () =>
      perCohort.map((c) => ({
        year: String(c.cohort),
        actual: +c.actual_mean_time_to_hire_months.toFixed(2),
        predicted: +c.predicted_mean_time_to_hire_months.toFixed(2),
      })),
    [perCohort],
  );

  const bsisObservedSeries = useMemo(
    () =>
      perCohort.map((c) => ({
        year: String(c.cohort),
        firstJob: +(c.actual_bsis_first_rate * 100).toFixed(1),
        currentJob: +(c.actual_bsis_current_rate * 100).toFixed(1),
      })),
    [perCohort],
  );

  const distribution = useMemo(() => {
    const dist = overall?.time_to_hire_distribution ?? {};
    return Object.entries(dist).map(([bucket, n]) => ({ bucket, n }));
  }, [overall]);

  const modelHealth = useMemo(() => {
    if (!data?.model_metadata) return [];
    return Object.entries(data.model_metadata.targets)
      .filter(([key]) => key in TARGET_LABELS)
      .map(([key, t]) => {
        const m = t.metrics as Record<string, unknown>;
        const score =
          typeof m.cv_mean === 'number'
            ? Math.max(0, Math.min(100, Math.round((m.cv_mean as number) * 100)))
            : 0;
        return { subject: TARGET_LABELS[key] ?? key, A: score };
      });
  }, [data]);

  const cohorts = perCohort.map((c) => c.cohort);
  const avgHire = overall?.predicted_mean_time_to_hire_months ?? 0;
  const predEmp = overall?.predicted_employment_rate ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Brain className="size-4 text-[#1B3A6B]" />
          <span style={{ fontWeight: 600 }}>Cohort:</span>
          <select
            value={selectedCohort}
            onChange={(e) =>
              setSelectedCohort(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
          >
            <option value="all">All cohorts</option>
            {cohorts.map((c) => (
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          {
            label: 'Predicted Employment Rate',
            value: pct(predEmp),
            sub: `${overall?.n_alumni ?? 0} alumni in sample`,
            icon: TrendingUp,
            bg: 'bg-emerald-50',
            color: 'text-emerald-600',
            trend: overall ? `Actual: ${pct(overall.actual_employment_rate)}` : '',
          },
          {
            label: 'Predicted Time-to-Hire',
            value: `${avgHire.toFixed(1)}mo`,
            sub: overall ? `Actual: ${overall.actual_mean_time_to_hire_months.toFixed(1)}mo` : '',
            icon: Clock,
            bg: 'bg-blue-50',
            color: 'text-blue-600',
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
            <Zap className="size-4 text-[#1B3A6B]" /> Model vs Actual by Cohort
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
              disabled={perCohort.length === 0}
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
              Predicted vs actual employment rate per cohort. Best model:{' '}
              {data?.model_metadata.best_models.employment_status ?? '—'}.
            </p>
            {employmentSeries.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                {loading ? 'Loading predictions...' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={employmentSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="actual" name="Actual" fill="#1B3A6B" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="predicted" name="Predicted" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </>
        )}

        {projectionView === 'hire' && (
          <>
            <p className="text-gray-500 text-xs mb-4">
              Predicted vs actual mean time-to-hire (months). Best model:{' '}
              {data?.model_metadata.best_models.time_to_hire ?? '—'}.
            </p>
            {hireSeries.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                {loading ? 'Loading predictions...' : 'No data'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={hireSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="mo" />
                  <Tooltip formatter={(v: number) => `${v} months`} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Actual"
                    stroke="#1B3A6B"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    name="Predicted"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <Clock className="size-4 text-[#1B3A6B]" /> Predicted Time-to-Hire Distribution
          </h3>
          {distribution.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-gray-400 text-sm">
              {loading ? 'Loading...' : 'No data'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="n" radius={[3, 3, 0, 0]}>
                  {distribution.map((_, i) => (
                    <Cell
                      key={i}
                      fill={['#10b981', '#3b82f6', '#f59e0b', '#ef4444'][i] ?? '#1B3A6B'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-gray-800 mb-4 flex items-center gap-2" style={{ fontWeight: 700 }}>
            <BarChart2 className="size-4 text-[#1B3A6B]" /> Model Health (CV score)
          </h3>
          <p className="text-gray-500 text-xs mb-2">
            5-fold cross-validation score per target (R² for regression, F1 for
            classification). Scaled to 0–100.
          </p>
          {modelHealth.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-gray-400 text-sm">
              {loading ? 'Loading...' : 'No data'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={modelHealth}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar
                  dataKey="A"
                  stroke="#1B3A6B"
                  fill="#1B3A6B"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>
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
                Per-Cohort Raw Numbers
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
                        'Cohort',
                        'N',
                        'Employed (act / pred)',
                        'Time-to-hire (act / pred)',
                        'BSIS 1st (obs)',
                        'BSIS Current (obs)',
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
                    {perCohort.map((c) => (
                      <tr key={c.cohort}>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-800 text-xs" style={{ fontWeight: 600 }}>
                            {c.cohort}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-600 text-xs">{c.n_alumni}</span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-600 text-xs">
                            {pct(c.actual_employment_rate)} /{' '}
                            <span className="text-emerald-600" style={{ fontWeight: 600 }}>
                              {pct(c.predicted_employment_rate)}
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-gray-600 text-xs">
                            {c.actual_mean_time_to_hire_months.toFixed(1)}mo /{' '}
                            <span className="text-emerald-600" style={{ fontWeight: 600 }}>
                              {c.predicted_mean_time_to_hire_months.toFixed(1)}mo
                            </span>
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
                    {perCohort.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-gray-400 text-xs">
                          No cohort data available
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
