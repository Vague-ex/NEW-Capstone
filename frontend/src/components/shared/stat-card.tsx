import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  iconBg?: string;
  iconColor?: string;
  trend?: string;
  trendUp?: boolean;
}

export function StatCard({ label, value, sub, icon: Icon, iconBg = 'bg-blue-50', iconColor = 'text-blue-600', trend, trendUp }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`flex size-10 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`size-5 ${iconColor}`} />
        </div>
        {trend && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}
            style={{ fontWeight: 600 }}>
            {trend}
          </span>
        )}
      </div>
      <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.7rem', lineHeight: 1 }}>{value}</p>
      <p className="text-gray-500 text-sm mt-1" style={{ fontWeight: 500 }}>{label}</p>
      {sub && <p className="text-gray-400 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}
