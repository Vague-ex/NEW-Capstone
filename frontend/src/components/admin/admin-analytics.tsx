import { lazy, Suspense, useState } from 'react';
import { BarChart2, FileDown } from 'lucide-react';
import { PortalLayout } from '../shared/portal-layout';
import { AdminAnalyticsPredictions } from './admin-analytics-predictions';

const AdminReports = lazy(() =>
  import('./admin-reports').then((m) => ({ default: m.AdminReports })),
);

type Tab = 'analytics' | 'reports';

const TABS: { id: Tab; label: string; Icon: typeof BarChart2 }[] = [
  { id: 'analytics', label: 'Analytics', Icon: BarChart2 },
  { id: 'reports', label: 'Reports', Icon: FileDown },
];

export function AdminAnalytics() {
  const [tab, setTab] = useState<Tab>('analytics');

  return (
    <PortalLayout
      role="admin"
      pageTitle="Analytics & Reports"
      pageSubtitle="Predictive Employability Trend"
    >
      <div className="space-y-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6" aria-label="Analytics tabs">
            {TABS.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm transition ${
                    active
                      ? 'border-[#1B3A6B] text-[#1B3A6B]'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={{ fontWeight: active ? 700 : 500 }}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>

        {tab === 'analytics' ? (
          <AdminAnalyticsPredictions />
        ) : (
          <Suspense
            fallback={
              <div className="py-16 text-center text-sm text-gray-400">Loading reports…</div>
            }
          >
            <AdminReports />
          </Suspense>
        )}
      </div>
    </PortalLayout>
  );
}
