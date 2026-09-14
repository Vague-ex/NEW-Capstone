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
    <div className="min-w-0 bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`size-5 ${iconColor}`} />
        </div>
        {trend && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}
            style={{ fontWeight: 600 }}>
            {trend}
          </span>
        )}
      </div>
      {/* Scales with the screen: a fixed 1.7rem pushed a word like "Unemployed"
          out of a half-width card on phones. Wrapping inside the word is only a
          last resort for the narrowest screens. */}
      <p className="text-gray-900 [overflow-wrap:anywhere]" style={{ fontWeight: 800, fontSize: 'clamp(0.9rem, 4.5vw, 1.7rem)', lineHeight: 1.1 }}>{value}</p>
      <p className="text-gray-500 text-sm mt-1" style={{ fontWeight: 500 }}>{label}</p>
      {sub && <p className="text-gray-400 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}
