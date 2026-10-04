import { PublicLocaleProvider } from '@/lib/fa/locale';
import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/locales';
import { LocaleHtml } from './LocaleHtml';

/** Wraps /fa, /es, and /fr. English pages do not use this frame. */
export function PublicLocaleFrame({
  locale,
  children,
}: {
  locale: Exclude<PublicLocale, 'en'>;
  children: React.ReactNode;
}) {
  const meta = PUBLIC_LOCALES.find((item) => item.id === locale) ?? PUBLIC_LOCALES[0];
  const rootClass = locale === 'fa' ? 'fa-preview-root' : undefined;
  const htmlClass = locale === 'fa' ? 'fa-preview' : undefined;
  return (
    <div lang={meta.htmlLang} dir={meta.dir} className={rootClass}>
      <LocaleHtml lang={meta.htmlLang} dir={meta.dir} htmlClass={htmlClass} />
      <PublicLocaleProvider locale={locale}>{children}</PublicLocaleProvider>
    </div>
  );
}
