import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../supabase/admin.ts';
import type { StuckOrderAlertLedger } from './stuck-orders.ts';

export const MARKETPLACE_ORDER_ALERTS_TABLE = 'marketplace_order_alerts';

/** An unsent claim older than this can be taken again. */
export const STUCK_ORDER_ALERT_CLAIM_TTL_MS = 60 * 60 * 1000;

type AlertClaimResult = {
  data: { order_id?: string; alerted_at?: string; sent_at?: string | null }[] | null;
  error: { message?: string } | null;
};
type AlertReadResult = {
  data: { alerted_at?: string; sent_at?: string | null } | null;
  error: { message?: string } | null;
};
type AlertQuery = PromiseLike<AlertClaimResult> & {
  select(columns: string): AlertQuery;
  eq(column: string, value: string): AlertQuery;
  is(column: string, value: null): AlertQuery;
  abortSignal(signal: AbortSignal): AlertQuery;
  maybeSingle(): PromiseLike<AlertReadResult>;
};

/** Narrow writer so a test double can stand in for the service-role client. */
export type MarketplaceOrderAlertWriter = {
  from(table: string): {
    upsert(
      values: { order_id: string; status: string; alerted_at?: string; sent_at?: string | null },
      options: { onConflict: string; ignoreDuplicates: boolean }
    ): AlertQuery;
    select(columns: string): AlertQuery;
    delete(): AlertQuery;
  };
};

function withSignal<T extends { abortSignal(signal: AbortSignal): T }>(query: T, signal?: AbortSignal): T {
  return signal ? query.abortSignal(signal) : query;
}

/**
 * Insert (order_id, status) on conflict do nothing. `claim` is true only when
 * this call owns the row. A sent row is never taken again. An unsent row
 * older than STUCK_ORDER_ALERT_CLAIM_TTL_MS is deleted and inserted again.
 */
export function marketplaceOrderAlertLedger(
  writer: MarketplaceOrderAlertWriter,
  now = Date.now
): StuckOrderAlertLedger {
  return {
    async claim(orderId, status, signal) {
      const id = String(orderId || '').trim();
      const state = String(status || '').trim();
      const inserted = await withSignal(
        writer
          .from(MARKETPLACE_ORDER_ALERTS_TABLE)
          .upsert({ order_id: id, status: state }, { onConflict: 'order_id,status', ignoreDuplicates: true })
          .select('order_id,alerted_at,sent_at'),
        signal
      );
      if (inserted.error) throw new Error(inserted.error.message || 'alert claim failed');
      if (Array.isArray(inserted.data) && inserted.data.length > 0) return true;

      const existing = await withSignal(
        writer
          .from(MARKETPLACE_ORDER_ALERTS_TABLE)
          .select('alerted_at,sent_at')
          .eq('order_id', id)
          .eq('status', state),
        signal
      ).maybeSingle();
      if (existing.error) throw new Error(existing.error.message || 'alert claim failed');
      const row = existing.data;
      if (!row || row.sent_at) return false;
      const at = Date.parse(String(row.alerted_at || ''));
      if (!Number.isFinite(at) || now() - at < STUCK_ORDER_ALERT_CLAIM_TTL_MS) return false;

      const removed = await withSignal(
        writer.from(MARKETPLACE_ORDER_ALERTS_TABLE).delete().eq('order_id', id).eq('status', state).is('sent_at', null),
        signal
      );
      if (removed.error) throw new Error(removed.error.message || 'alert claim failed');
      const again = await withSignal(
        writer
          .from(MARKETPLACE_ORDER_ALERTS_TABLE)
          .upsert({ order_id: id, status: state }, { onConflict: 'order_id,status', ignoreDuplicates: true })
          .select('order_id'),
        signal
      );
      if (again.error) throw new Error(again.error.message || 'alert claim failed');
      return Array.isArray(again.data) && again.data.length > 0;
    },
    async release(orderId, status, signal) {
      const result = await withSignal(
        writer
          .from(MARKETPLACE_ORDER_ALERTS_TABLE)
          .delete()
          .eq('order_id', String(orderId || '').trim())
          .eq('status', String(status || '').trim())
          .is('sent_at', null),
        signal
      );
      if (result.error) throw new Error(result.error.message || 'alert release failed');
    },
    async markSent(orderId, status, signal) {
      // Gap left as-is: the unsent row is deleted, then a sent row is inserted.
      // The key is free between those two calls, so another instance can claim it.
      const id = String(orderId || '').trim();
      const state = String(status || '').trim();
      const stamp = new Date(now()).toISOString();
      const removed = await withSignal(
        writer.from(MARKETPLACE_ORDER_ALERTS_TABLE).delete().eq('order_id', id).eq('status', state).is('sent_at', null),
        signal
      );
      if (removed.error) throw new Error(removed.error.message || 'alert sent marker failed');
      const written = await withSignal(
        writer
          .from(MARKETPLACE_ORDER_ALERTS_TABLE)
          .upsert(
            { order_id: id, status: state, alerted_at: stamp, sent_at: stamp },
            { onConflict: 'order_id,status', ignoreDuplicates: true }
          )
          .select('order_id'),
        signal
      );
      if (written.error) throw new Error(written.error.message || 'alert sent marker failed');
      if (!Array.isArray(written.data) || written.data.length === 0) {
        throw new Error('alert sent marker was not written');
      }
    },
  };
}

export function supabaseMarketplaceOrderAlertLedger(
  admin: SupabaseClient = getSupabaseAdmin()
): StuckOrderAlertLedger {
  return marketplaceOrderAlertLedger(admin as unknown as MarketplaceOrderAlertWriter);
}
