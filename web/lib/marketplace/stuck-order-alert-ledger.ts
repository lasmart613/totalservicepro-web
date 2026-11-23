import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../supabase/admin.ts';
import type { StuckOrderAlertLedger } from './stuck-orders.ts';

export const MARKETPLACE_ORDER_ALERTS_TABLE = 'marketplace_order_alerts';

type AlertClaimResult = { data: { order_id?: string }[] | null; error: { message?: string } | null };
type AlertReleaseResult = { error: { message?: string } | null };

/** Narrow writer so a test double can stand in for the service-role client. */
export type MarketplaceOrderAlertWriter = {
  from(table: string): {
    upsert(
      values: { order_id: string; status: string },
      options: { onConflict: string; ignoreDuplicates: boolean }
    ): { select(columns: string): PromiseLike<AlertClaimResult> };
    delete(): {
      eq(column: string, value: string): {
        eq(column: string, value: string): PromiseLike<AlertReleaseResult>;
      };
    };
  };
};

/**
 * Insert (order_id, status) on conflict do nothing. `claim` is true only when
 * PostgREST returns the inserted row. An empty representation means the row
 * was already there and this caller must not send.
 */
export function marketplaceOrderAlertLedger(writer: MarketplaceOrderAlertWriter): StuckOrderAlertLedger {
  return {
    async claim(orderId, status) {
      const result = await writer
        .from(MARKETPLACE_ORDER_ALERTS_TABLE)
        .upsert(
          { order_id: String(orderId || '').trim(), status: String(status || '').trim() },
          { onConflict: 'order_id,status', ignoreDuplicates: true }
        )
        .select('order_id');
      if (result.error) throw new Error(result.error.message || 'alert claim failed');
      return Array.isArray(result.data) && result.data.length > 0;
    },
    async release(orderId, status) {
      const result = await writer
        .from(MARKETPLACE_ORDER_ALERTS_TABLE)
        .delete()
        .eq('order_id', String(orderId || '').trim())
        .eq('status', String(status || '').trim());
      if (result.error) throw new Error(result.error.message || 'alert release failed');
    },
  };
}

export function supabaseMarketplaceOrderAlertLedger(
  admin: SupabaseClient = getSupabaseAdmin()
): StuckOrderAlertLedger {
  return marketplaceOrderAlertLedger(admin as unknown as MarketplaceOrderAlertWriter);
}
