import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LocaleHtml } from '@/components/i18n/LocaleHtml';
import EstimateActionClient, { EstimateLinkFallback } from './EstimateActionClient';
import { loadPublicEstimateForToken } from '@/lib/billing/estimate-action';
import { parseCustomerActionKind, parseEstimateEmailAction } from '@/lib/billing/save-helpers';
import { resolveCustomerPageLocale } from '@/lib/i18n/customer-locale';
import type { PublicLocale } from '@/lib/i18n/locales';
import { documentLocaleMeta, estimateDocumentLocaleScript } from '@/lib/i18n/preference';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Review estimate · Total Service Pro' },
  description: 'Review this service estimate, then approve, reject, or request a modification.',
  robots: { index: false, follow: false },
};

function EstimateDocumentLocale({ locale }: { locale: PublicLocale }) {
  const meta = documentLocaleMeta(locale);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: estimateDocumentLocaleScript(locale) }} />
      <LocaleHtml lang={meta.lang} dir={meta.dir} htmlClass={meta.htmlClass} />
    </>
  );
}

function requestedFromQuery(query: { action?: string; changes?: string }) {
  const explicit = parseEstimateEmailAction(query.action);
  if (explicit) return explicit;
  if (String(query.changes || '') === '1') return 'modify' as const;
  return null;
}

export default async function EstimateActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ action?: string; changes?: string; done?: string; notice?: string; lang?: string }>;
}) {
  const raw = await params;
  const query = searchParams ? await searchParams : {};
  const token = String(raw?.token || '').trim();
  const requested = requestedFromQuery(query);
  const justCompleted = parseCustomerActionKind(query.done);
  const notice = String(query.notice || '');
  const acceptLanguage = (await headers()).get('accept-language');

  let loaded: Awaited<ReturnType<typeof loadPublicEstimateForToken>>;
  try {
    loaded = await loadPublicEstimateForToken(token);
  } catch (e) {
    console.error('estimate action page', e);
    loaded = {
      ok: false,
      message: 'This page is temporarily unavailable. Please contact the company that sent the estimate.',
    };
  }

  const locale = resolveCustomerPageLocale({
    orgLanguage: loaded.ok ? loaded.orgLanguage : null,
    queryLang: query.lang,
    acceptLanguage,
  });

  if (!loaded.ok) {
    return (
      <>
        <EstimateDocumentLocale locale={locale} />
        <EstimateLinkFallback message={loaded.message} locale={locale} />
      </>
    );
  }

  return (
    <>
      <EstimateDocumentLocale locale={locale} />
      <EstimateActionClient
        token={token}
        confirms={loaded.confirms}
        estimate={loaded.estimate}
        requested={requested}
        justCompleted={justCompleted}
        notice={notice}
        locale={locale}
      />
    </>
  );
}
