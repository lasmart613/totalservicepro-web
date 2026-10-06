/**
 * Shop list / edit-form status for an estimate.
 * customer_action stays beside the stored status. Approved and Rejected
 * replace the Pending badge. Rejected estimates are final.
 */

import {
  customerActionFromEstimate,
  isEstimateExpired,
  type CustomerActionKind,
} from './save-helpers.ts';

export const REJECTED_ESTIMATE_ERROR =
  'This estimate was rejected and cannot be sent or reopened.';

export const REJECTED_ESTIMATE_NOTE = 'This estimate was rejected';

export type EstimateStatusRow = {
  status?: string | null;
  created_at?: string | null;
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
  estimate_data?: unknown;
};

function storedStatus(est: EstimateStatusRow): string {
  return String(est.status || 'draft').toLowerCase();
}

/** Main badge. Invoiced / cancelled stay as stored. Approved and Rejected win over Pending. */
export function estimateListBadge(est: EstimateStatusRow): string {
  const stored = storedStatus(est);
  if (stored === 'invoiced' || stored === 'completed' || stored === 'cancelled' || stored === 'canceled') {
    return stored === 'canceled' ? 'cancelled' : stored;
  }
  const action = customerActionFromEstimate(est).action;
  if (action === 'approved' || action === 'rejected') return action;
  if (isEstimateExpired(est)) return 'expired';
  return stored || 'draft';
}

export function estimateStatusLabel(status: string): string {
  const key = String(status || 'draft').toLowerCase();
  if (key === 'approved') return 'Approved';
  if (key === 'rejected') return 'Rejected';
  if (key === 'pending') return 'Pending';
  if (key === 'sent') return 'Sent';
  if (key === 'draft') return 'Draft';
  if (key === 'invoiced') return 'Invoiced';
  if (key === 'expired') return 'Expired';
  if (key === 'cancelled') return 'Cancelled';
  if (key === 'completed') return 'Completed';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function estimateStatusBadgeClass(status: string): string {
  const key = String(status || '').toLowerCase();
  if (key === 'draft') return 'bg-gray-700/40 text-gray-200 border-gray-600';
  if (key === 'pending' || key === 'sent') return 'bg-blue-900/40 text-blue-200 border-blue-700';
  if (key === 'approved') return 'bg-green-900/40 text-green-200 border-green-700';
  if (key === 'rejected' || key === 'expired') return 'bg-red-900/40 text-red-200 border-red-700';
  if (key === 'invoiced' || key === 'completed') return 'bg-purple-900/40 text-purple-200 border-purple-700';
  return 'bg-[var(--surface2)] text-[var(--text2)] border-[var(--border2)]';
}

/**
 * SENT counter. Rejected estimates are left out. Approved estimates still
 * count while the stored status is pending/sent, and drop off once invoiced
 * or expired the same way other sent rows do.
 */
export function estimateCountsTowardSent(est: EstimateStatusRow): boolean {
  if (customerActionFromEstimate(est).action === 'rejected') return false;
  const stored = storedStatus(est);
  if (stored !== 'pending' && stored !== 'sent') return false;
  if (isEstimateExpired(est)) return false;
  return true;
}

export function isRejectedEstimate(est: EstimateStatusRow): boolean {
  return customerActionFromEstimate(est).action === 'rejected';
}

/** Shop may not email again or move a rejected estimate back to draft/sent. */
export function rejectedEstimateChangeRefusal(est: EstimateStatusRow): {
  status: 409;
  error: string;
} | null {
  if (!isRejectedEstimate(est)) return null;
  return { status: 409, error: REJECTED_ESTIMATE_ERROR };
}

export function estimateCustomerAction(
  est: EstimateStatusRow
): CustomerActionKind | null {
  return customerActionFromEstimate(est).action;
}
