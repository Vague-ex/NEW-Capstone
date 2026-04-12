import { useState } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { EMPLOYER_ACCOUNTS, VALID_ALUMNI } from '../../data/app-data';
import {
  Building2, CheckCircle2, XCircle, Clock, AlertTriangle,
  Mail, User, Globe, FileText, Phone,
} from 'lucide-react';

export function AdminEmployerRequests() {
  const [employers, setEmployers] = useState(EMPLOYER_ACCOUNTS);
  const [loading, setLoading] = useState<string | null>(null);
  const [reviewModal, setReviewModal] = useState<typeof EMPLOYER_ACCOUNTS[0] | null>(null);

  const pending = EMPLOYER_ACCOUNTS.filter(e => e.status === 'pending');
  const pendingCount = VALID_ALUMNI.filter(a => a.verificationStatus === 'pending').length;

  const handleAction = async (id: string, action: 'approved' | 'rejected') => {
    setLoading(`${id}-${action}`);
    await new Promise(r => setTimeout(r, 800));
    setEmployers(prev => prev.map(e => e.id === id ? { ...e, status: action } : e));
    setReviewModal(null);
    setLoading(null);
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      approved: 'bg-emerald-50 text-emerald-700',
      pending: 'bg-amber-50 text-amber-700',
      rejected: 'bg-red-50 text-red-600',
    };
    return (
      <span className={`text-xs px-2.5 py-0.5 rounded-full capitalize ${map[status] ?? 'bg-gray-100 text-gray-600'}`}
        style={{ fontWeight: 600 }}>
        {status}
      </span>
    );
  };

  return (
    <PortalLayout
      role="admin"
      pageTitle="Employer Access Requests"
      pageSubtitle="Review and manage company access applications"
      notificationCount={pendingCount}
    >
      <div className="space-y-5">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Approved', value: employers.filter(e => e.status === 'approved').length, icon: CheckCircle2, bg: 'bg-emerald-50', color: 'text-emerald-600' },
            { label: 'Pending', value: employers.filter(e => e.status === 'pending').length, icon: Clock, bg: 'bg-amber-50', color: 'text-amber-600' },
            { label: 'Rejected', value: employers.filter(e => e.status === 'rejected').length, icon: XCircle, bg: 'bg-red-50', color: 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${s.bg} shrink-0`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.4rem', lineHeight: 1 }}>{s.value}</p>
                <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Pending section */}
        {employers.filter(e => e.status === 'pending').length > 0 && (
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-100 px-4 py-3">
              <AlertTriangle className="size-4 text-amber-500" />
              <p className="text-amber-800 text-sm" style={{ fontWeight: 600 }}>
                {employers.filter(e => e.status === 'pending').length} pending applications — action required
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {employers.filter(e => e.status === 'pending').map(emp => (
                <div key={emp.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 hover:bg-gray-50/50 transition">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-violet-100 shrink-0">
                      <Building2 className="size-5 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-gray-900 text-sm" style={{ fontWeight: 700 }}>{emp.company}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{emp.industry}</p>
                      <p className="text-gray-400 text-xs mt-0.5">{emp.contact} · {emp.email}</p>
                      <p className="text-gray-300 text-xs">Applied: {new Date(emp.date).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setReviewModal(emp)}
                      className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs transition"
                      style={{ fontWeight: 600 }}>
                      View Details
                    </button>
                    <button onClick={() => handleAction(emp.id, 'approved')}
                      disabled={loading?.startsWith(emp.id)}
                      className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs transition disabled:opacity-60"
                      style={{ fontWeight: 600 }}>
                      {loading === `${emp.id}-approved`
                        ? <span className="size-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                        : <CheckCircle2 className="size-3.5" />}
                      Approve
                    </button>
                    <button onClick={() => handleAction(emp.id, 'rejected')}
                      disabled={loading?.startsWith(emp.id)}
                      className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-xl text-xs transition disabled:opacity-60"
                      style={{ fontWeight: 600 }}>
                      <XCircle className="size-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All employers */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-gray-700 text-sm" style={{ fontWeight: 700 }}>All Employer Applications</p>
          </div>
          <div className="divide-y divide-gray-50">
            {employers.map(emp => (
              <div key={emp.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50/50 transition">
                <div className="flex size-9 items-center justify-center rounded-xl bg-violet-50 shrink-0">
                  <Building2 className="size-4 text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 text-sm truncate" style={{ fontWeight: 600 }}>{emp.company}</p>
                  <p className="text-gray-400 text-xs">{emp.industry} · {emp.contact}</p>
                </div>
                <StatusBadge status={emp.status} />
                <p className="text-gray-400 text-xs whitespace-nowrap hidden sm:block">
                  {new Date(emp.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Review Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-gray-900" style={{ fontWeight: 700 }}>Employer Application Review</h3>
              <button onClick={() => setReviewModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex size-12 items-center justify-center rounded-xl bg-violet-100">
                  <Building2 className="size-6 text-violet-600" />
                </div>
                <div>
                  <p className="text-gray-900" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{reviewModal.company}</p>
                  <p className="text-gray-500 text-sm">{reviewModal.industry}</p>
                </div>
              </div>
              {[
                { icon: User, label: 'Contact Person', value: reviewModal.contact },
                { icon: Mail, label: 'Email', value: reviewModal.email },
                { icon: Globe, label: 'Industry', value: reviewModal.industry },
                { icon: FileText, label: 'Applied', value: new Date(reviewModal.date).toLocaleDateString('en-PH', { dateStyle: 'long' }) },
              ].map(f => (
                <div key={f.label} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">
                  <f.icon className="size-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="text-gray-400 text-xs">{f.label}</p>
                    <p className="text-gray-800 text-sm" style={{ fontWeight: 500 }}>{f.value}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button onClick={() => setReviewModal(null)} className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-sm transition" style={{ fontWeight: 500 }}>
                Cancel
              </button>
              <div className="flex-1" />
              <button onClick={() => handleAction(reviewModal.id, 'rejected')} disabled={!!loading}
                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
                style={{ fontWeight: 600 }}>
                <XCircle className="size-4" /> Reject
              </button>
              <button onClick={() => handleAction(reviewModal.id, 'approved')} disabled={!!loading}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
                style={{ fontWeight: 600 }}>
                {loading ? <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 className="size-4" />}
                Approve Access
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
