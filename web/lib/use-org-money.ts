'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSiteLocale } from '@/lib/fa/locale';
import { PUBLIC_LOCALES } from '@/lib/i18n/locales';
import { getSupabaseClient } from '@/lib/supabase/client';
import { DEFAULT_ORG_MONEY, formatOrgMoney, orgCurrencySymbol, type OrgMoneyPrefs } from '@/lib/money-format';
import { loadOrgMoneyPrefs } from '@/lib/org-money';

export function localeToBcp47(locale: string | null | undefined): string {
  const hit = PUBLIC_LOCALES.find((item) => item.id === locale);
  return hit?.htmlLang || 'en';
}

/** Signed-in organization's display currency. Missing columns stay on USD. */
export function useOrgMoney(): {
  prefs: OrgMoneyPrefs;
  locale: string;
  money: (amount: unknown) => string;
  symbol: string;
} {
  const siteLocale = useSiteLocale();
  const locale = localeToBcp47(siteLocale);
  const [prefs, setPrefs] = useState<OrgMoneyPrefs>(DEFAULT_ORG_MONEY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        let profile: { organization_id?: string | number | null; active_organization_id?: string | number | null } | null =
          null;
        const full = await supabase
          .from('user_profiles')
          .select('organization_id, active_organization_id')
          .eq('id', user.id)
          .maybeSingle();
        if (full.error && /active_organization_id|column/i.test(full.error.message || '')) {
          const basic = await supabase
            .from('user_profiles')
            .select('organization_id')
            .eq('id', user.id)
            .maybeSingle();
          profile = basic.data;
        } else {
          profile = full.data;
        }
        const orgId = profile?.active_organization_id ?? profile?.organization_id ?? null;
        const loaded = await loadOrgMoneyPrefs(supabase, orgId);
        if (!cancelled) setPrefs(loaded);
      } catch {
        if (!cancelled) setPrefs(DEFAULT_ORG_MONEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const money = useMemo(() => {
    return (amount: unknown) => formatOrgMoney(amount, prefs, locale);
  }, [prefs, locale]);
  const symbol = useMemo(() => orgCurrencySymbol(prefs, locale), [prefs, locale]);

  return { prefs, locale, money, symbol };
}
