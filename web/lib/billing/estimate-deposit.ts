/**
 * Parts/travel deposit on an estimate.
 *
 * The estimate form used to open with the deposit box already checked and
 * copy parts + mileage + reimbursements into the amount. A $10 part and no
 * travel therefore saved deposit = parts subtotal. Email, PDF, convert, and
 * Stripe all treated that stored amount as money due now.
 *
 * A stored amount is active only when the deposit flag is on. The flag lives
 * in estimate_data.deposit_required (no extra column). When that key is
 * absent, it is derived from the deposit columns already on the row:
 * deposit, travelDeposit, or parts_deposit. partsTotal is never a deposit.
 */

import { money2, parseInvoiceData } from './apply-invoice-payment.ts';

const FLAG_OFF = new Set(['false', '0', 'no', 'off']);
const FLAG_ON = new Set(['true', '1', 'yes', 'on']);

/** Explicit deposit_required. null when the key is missing or blank. */
export function explicitDepositRequired(estimateData: unknown): boolean | null {
  const data = parseInvoiceData(estimateData);
  if (!Object.prototype.hasOwnProperty.call(data, 'deposit_required')) return null;
  const raw = data.deposit_required;
  if (raw === false || raw === 0) return false;
  if (raw === true || raw === 1) return true;
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (FLAG_OFF.has(text)) return false;
  if (FLAG_ON.has(text)) return true;
  return null;
}

/** Amount stored on the deposit columns. partsTotal is not one of them. */
export function storedEstimateDepositAmount(estimateData: unknown): number {
  const data = parseInvoiceData(estimateData);
  const raw = data.deposit ?? data.travelDeposit ?? data.parts_deposit ?? data.partsDeposit;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return money2(n);
}

/**
 * True when this estimate opted into a deposit.
 * An explicit flag wins. With no flag, a positive deposit column turns it on.
 */
export function isEstimateDepositEnabled(estimateData: unknown): boolean {
  const flag = explicitDepositRequired(estimateData);
  if (flag != null) return flag;
  return storedEstimateDepositAmount(estimateData) > 0;
}

/**
 * Amount to print on the estimate email and PDF.
 * Zero unless the deposit flag is on. A full-total deposit still prints;
 * the payment split drops that case separately.
 */
export function printableEstimateDeposit(estimateData: unknown): number {
  if (!isEstimateDepositEnabled(estimateData)) return 0;
  return storedEstimateDepositAmount(estimateData);
}

/**
 * Unpaid parts/travel deposit to collect now. 0 when the flag is off, the
 * amount is empty, or the amount already covers the whole job.
 */
export function activeEstimateDepositAmount(estimateData: unknown, total?: number): number {
  if (!isEstimateDepositEnabled(estimateData)) return 0;
  const amt = storedEstimateDepositAmount(estimateData);
  if (amt <= 0) return 0;
  const job = Number(total);
  if (Number.isFinite(job) && job > 0 && amt >= job - 0.004) return 0;
  return amt;
}

/** Fields written into estimate_data. Off always stores a zero amount. */
export function estimateDepositSaveFields(input: {
  enabled: boolean;
  amount: number;
  total: number;
}): {
  deposit_required: boolean;
  deposit: number;
  travelDeposit: number;
  balanceDue: number;
} {
  const total = money2(Math.max(0, Number(input.total) || 0));
  if (!input.enabled) {
    return {
      deposit_required: false,
      deposit: 0,
      travelDeposit: 0,
      balanceDue: total,
    };
  }
  const deposit = money2(Math.max(0, Number(input.amount) || 0));
  return {
    deposit_required: true,
    deposit,
    travelDeposit: deposit,
    balanceDue: money2(Math.max(0, total - deposit)),
  };
}
