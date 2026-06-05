'use client';

import { XCircle } from 'lucide-react';

/**
 * Reusable rejection-reason modal. The admin types (or picks) a comment that
 * is stored on the account and emailed to the applicant. The reason is
 * required so the rejection email always carries a meaningful explanation.
 */

export const GRADUATE_REJECT_REASONS = [
  'Invalid Face ID — please retake your registration photos.',
  'Submitted face photo is too blurry to verify.',
  'Face does not match the submitted identity.',
  'Details do not match our graduate masterlist.',
  'Duplicate account detected.',
];

export const EMPLOYER_REJECT_REASONS = [
  'Company details could not be verified.',
  'Invalid or missing company email / website.',
  'Duplicate employer account detected.',
  'Incomplete registration information.',
];

interface RejectReasonModalProps {
  open: boolean;
  subjectName: string;
  reason: string;
  quickReasons?: string[];
  loading?: boolean;
  error?: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RejectReasonModal({
  open,
  subjectName,
  reason,
  quickReasons = GRADUATE_REJECT_REASONS,
  loading = false,
  error = '',
  onReasonChange,
  onCancel,
  onConfirm,
}: RejectReasonModalProps) {
  if (!open) return null;

  const canConfirm = reason.trim().length > 0 && !loading;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-100">
          <span className="flex size-9 items-center justify-center rounded-full bg-red-50 text-red-600">
            <XCircle className="size-5" />
          </span>
          <div>
            <h3 className="text-base text-gray-900" style={{ fontWeight: 700 }}>Reject registration</h3>
            <p className="text-xs text-gray-500">{subjectName}</p>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-600">
            Add a comment explaining why. It will be saved and emailed to the
            applicant as the reason for rejection.
          </p>

          {quickReasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quickReasons.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onReasonChange(q)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition ${
                    reason.trim() === q
                      ? 'bg-red-50 border-red-200 text-red-600'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
            placeholder="e.g. Invalid Face ID — please retake your registration photos."
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 resize-none"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 text-sm transition disabled:opacity-60"
            style={{ fontWeight: 500 }}
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-60"
            style={{ fontWeight: 600 }}
          >
            {loading
              ? <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <XCircle className="size-4" />}
            Reject &amp; notify
          </button>
        </div>
      </div>
    </div>
  );
}
