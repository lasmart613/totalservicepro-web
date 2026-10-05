'use client';

import { useLayoutEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FinancialReportingView } from '@/app/business/financial-reporting/FinancialReportingView';
import { OrgMoneySettings } from '@/components/OrgMoneySettings';
import { useSetSiteLanguage } from '@/lib/fa/locale';
import { applyDocumentLocale } from '@/lib/i18n/preference';
import {
  assembleFinancialReport,
  invoiceColumnFlags,
  presentFinancialReport,
} from '@/lib/financial-reporting';
import type { PublicLocale } from '@/lib/i18n/locales';

const LOCALES = new Set(['en', 'es', 'fr', 'fa', 'he', 'it', 'de', 'pt', 'ar']);

const COLUMNS = invoiceColumnFlags(
  'amount_paid, payment_method, paid_at, tax, due_date, invoice_date, invoice_data, total'
);

function fixtureReport(currencyCode: string, numberFormat: string) {
  return assembleFinancialReport({
    organizationId: 42,
    organizationName: 'Sample Laser Clinic',
    currencyCode,
    numberFormat,
    asOf: new Date('2026-10-02T15:00:00Z'),
    invoiceColumns: COLUMNS,
    invoices: [
      {
        id: 1,
        invoice_number: 'INV-1',
        status: 'sent',
        customer_name: 'Clinic A',
        total: 1000,
        tax: 0,
        amount_paid: 0,
        invoice_date: '2026-09-01',
        due_date: '2026-09-15',
      },
      {
        id: 2,
        invoice_number: 'INV-2',
        status: 'partially_paid',
        customer_name: 'Clinic B',
        total: 500,
        tax: 10,
        amount_paid: 200,
        payment_method: 'Check',
        invoice_date: '2026-09-10',
        due_date: '2026-10-01',
      },
      {
        id: 3,
        invoice_number: 'INV-3',
        status: 'paid',
        customer_name: 'Clinic C',
        total: 300,
        tax: 20,
        amount_paid: 300,
        payment_method: 'Stripe',
        paid_at: '2026-10-02T12:00:00Z',
        invoice_date: '2026-10-01',
        due_date: '2026-10-15',
      },
      {
        id: 6,
        invoice_number: 'INV-6',
        status: 'paid',
        customer_name: 'Clinic F',
        total: 100,
        amount_paid: null,
        invoice_date: '2026-10-02',
      },
    ],
    purchaseOrders: [{ id: 1, po_number: 'PO-1', status: 'sent', supplier_name: 'Parts Co', total: 80 }],
    estimates: [
      { id: 1, estimate_number: 'EST-1', status: 'sent', customer_name: 'Clinic A', total: 400 },
      { id: 2, estimate_number: 'EST-2', status: 'invoiced', customer_name: 'Clinic B', total: 100 },
    ],
  });
}

export function CurrencyReportPreview() {
  const params = useSearchParams();
  const setSiteLanguage = useSetSiteLanguage();
  const view = params.get('view') === 'free' || params.get('view') === 'premium' ? params.get('view') : 'settings';
  const [money, setMoney] = useState({ currency_code: 'EUR', number_format: 'dot_comma_after' });

  useLayoutEffect(() => {
    const lang = params.get('lang');
    if (!lang || !LOCALES.has(lang)) return;
    const locale = lang as PublicLocale;
    applyDocumentLocale(locale);
    setSiteLanguage(locale);
  }, [params, setSiteLanguage]);

  const report = useMemo(() => {
    const full = fixtureReport(money.currency_code, money.number_format);
    return view === 'free' ? presentFinancialReport(full, false) : full;
  }, [money.currency_code, money.number_format, view]);

  if (view === 'free' || view === 'premium') {
    return (
      <div data-preview={view}>
        <FinancialReportingView report={report} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full" data-preview="settings" data-lang={params.get('lang') || 'none'}>
      <h1 className="text-2xl font-extrabold mb-1">Company profile</h1>
      <p className="text-sm text-[var(--text3)] mb-4">Sample organization. Local fixture only.</p>
      <div className="card p-6">
        <OrgMoneySettings
          currencyCode={money.currency_code}
          numberFormat={money.number_format}
          startOpen={params.get('open') === '1'}
          onChange={setMoney}
        />
      </div>
    </div>
  );
}
