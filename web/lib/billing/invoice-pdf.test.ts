import assert from 'node:assert/strict';
import test from 'node:test';
import { reshapeArabic } from './arabic-join.ts';
import { buildOwnedInvoiceMessage, ownedInvoiceHtmlInput, resendMessage } from './owned-doc-mail.ts';
import {
  INVOICE_PDF_MAX_BYTES,
  invoicePdfFilename,
  isPublicLogoUrl,
  renderInvoicePdf,
  toResendPdfAttachment,
} from './invoice-pdf.ts';
import { extractPdfPages } from '../manual-pdf-text.ts';
import { translateApp } from '../i18n/translate-app.ts';
import type { InvoiceHtmlInput } from './doc-html.ts';

const branded = {
  primary: '#0C4A6E',
  accent: '#38BDF8',
  onPrimary: '#FFFFFF' as const,
  onAccent: '#111827' as const,
  logoUrl: null,
  companyName: 'Ocean Laser',
  branded: true,
};

function sample(locale?: string): InvoiceHtmlInput {
  return ownedInvoiceHtmlInput({
    row: {
      customer_name: 'Cedar Clinic',
      invoice_number: 'INV-100',
      invoice_date: '2026-09-28',
      total: 120,
      invoice_data: {
        custEmail: 'clinic@cedar.test',
        line_items: [{ description: 'Handpiece service', qty: 1, unit_price: 120, ext: 120 }],
      },
    },
    company: { company_name: 'Cedar Laser Service', email: 'shop@cedar.test' },
    theme: null,
    paymentUrl: 'https://pay.example/session',
    locale,
    timeZone: 'America/Chicago',
  });
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pages = await extractPdfPages(bytes);
  return pages.map((page) => page.text).join('\n');
}

function hasEitherOrder(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  return haystack.includes(Array.from(needle).reverse().join(''));
}

test('invoice PDF filename keeps the number and strips path characters', () => {
  assert.equal(invoicePdfFilename('INV-100'), 'Invoice-INV-100.pdf');
  assert.equal(invoicePdfFilename(' INV/100 '), 'Invoice-INV-100.pdf');
  assert.equal(invoicePdfFilename(''), 'Invoice.pdf');
  assert.equal(invoicePdfFilename(null), 'Invoice.pdf');
});

test('Resend attachment is base64 application/pdf and rejects an oversized file', () => {
  const small = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const file = toResendPdfAttachment(small, 'Invoice-INV-100.pdf');
  assert.ok(file);
  assert.equal(file.content_type, 'application/pdf');
  assert.equal(file.filename, 'Invoice-INV-100.pdf');
  assert.equal(Buffer.from(file.content, 'base64').subarray(0, 4).toString(), '%PDF');
  assert.equal(toResendPdfAttachment(new Uint8Array([1, 2, 3, 4, 5]), 'Invoice.pdf'), null);
  const huge = new Uint8Array(INVOICE_PDF_MAX_BYTES + 1);
  huge[0] = 0x25;
  huge[1] = 0x50;
  huge[2] = 0x44;
  huge[3] = 0x46;
  assert.equal(toResendPdfAttachment(huge, 'Invoice.pdf'), null);
});

test('logo URLs stay on public https hosts', () => {
  assert.equal(isPublicLogoUrl('https://cdn.example.com/logo.png'), true);
  assert.equal(isPublicLogoUrl('http://cdn.example.com/logo.png'), false);
  assert.equal(isPublicLogoUrl('https://127.0.0.1/logo.png'), false);
  assert.equal(isPublicLogoUrl('https://169.254.169.254/latest'), false);
  assert.equal(isPublicLogoUrl('https://10.1.1.1/logo.png'), false);
  assert.equal(isPublicLogoUrl('https://localhost/logo.png'), false);
  assert.equal(isPublicLogoUrl('https://user:pass@cdn.example.com/a.png'), false);
});

test('Arabic letters are reshaped before they are drawn', () => {
  const shaped = reshapeArabic('سلام');
  assert.notEqual(shaped, 'سلام');
  assert.equal(reshapeArabic('Invoice'), 'Invoice');
});

test('the email body stays on email theme scope; the PDF input can request the document', () => {
  const row = {
    customer_name: 'Clinic',
    invoice_number: 'OL-1',
    invoice_date: '2026-09-28',
    total: 100,
    estimate_id: 12,
    invoice_data: { line_items: [{ description: 'Labor', qty: 1, unit_price: 100, ext: 100 }] },
  };
  const company = { company_name: 'Ocean Laser' };
  const email = buildOwnedInvoiceMessage({
    row,
    company,
    theme: branded,
    paymentUrl: 'https://pay.example/x',
  });
  assert.match(email, /border-bottom:2px solid #FBBF24/);
  assert.match(email, /securely with Stripe/);
  assert.doesNotMatch(email, /From estimate/);
  const pdfInput = ownedInvoiceHtmlInput({
    row,
    company,
    theme: branded,
    paymentUrl: null,
    themeScope: 'document',
    fromEstimateId: row.estimate_id,
  });
  assert.equal(pdfInput.themeScope, 'document');
  assert.equal(pdfInput.paymentUrl, null);
  assert.equal(pdfInput.fromEstimateId, 12);
});

test('resend payload gains an attachment without changing the message fields', () => {
  const plain = resendMessage({
    from: 'Shop <shop@cedar.test>',
    to: 'clinic@cedar.test',
    subject: 'Invoice INV-100 from Cedar Laser Service',
    html: '<p>Invoice</p>',
    replyTo: 'shop@cedar.test',
  });
  assert.equal(plain.attachments, undefined);
  assert.equal(plain.subject, 'Invoice INV-100 from Cedar Laser Service');
  const withFile = resendMessage({
    from: 'Shop <shop@cedar.test>',
    to: 'clinic@cedar.test',
    subject: plain.subject,
    html: plain.html,
    replyTo: 'shop@cedar.test',
    attachments: [
      { filename: 'Invoice-INV-100.pdf', content: 'JVBERg==', content_type: 'application/pdf' },
    ],
  });
  assert.equal(withFile.subject, plain.subject);
  assert.equal(withFile.html, plain.html);
  assert.equal(withFile.reply_to, plain.reply_to);
  assert.deepEqual(withFile.to, plain.to);
  assert.equal(withFile.attachments?.[0].filename, 'Invoice-INV-100.pdf');
  assert.equal(withFile.attachments?.[0].content_type, 'application/pdf');
});

test('English, German, and Hebrew invoices render a PDF in that language', async () => {
  const english = await renderInvoicePdf({ ...sample(), paymentUrl: 'https://pay.example/ignored' });
  assert.equal(Buffer.from(english.subarray(0, 4)).toString(), '%PDF');
  const englishText = await pdfText(english);
  assert.match(englishText, /INV-100/);
  assert.match(englishText, /Handpiece service/);
  assert.match(englishText, /Cedar Clinic/);
  assert.match(englishText, /Cedar Laser Service/);
  assert.doesNotMatch(englishText, /securely with Stripe/);

  const german = await renderInvoicePdf(sample('de'));
  assert.ok(hasEitherOrder(await pdfText(german), translateApp('de', 'Invoice')));

  const hebrew = await renderInvoicePdf(sample('he'));
  const hebrewText = await pdfText(hebrew);
  assert.ok(hasEitherOrder(hebrewText, translateApp('he', 'Invoice')), hebrewText);
  assert.match(hebrewText, /INV-100/);
});

test('an Arabic invoice PDF is right-to-left and does not throw', async () => {
  const bytes = await renderInvoicePdf({
    ...sample('ar'),
    customer: { name: 'عيادة الأمل', email: 'clinic@cedar.test' },
    description: 'صيانة القطعة',
  });
  const text = await pdfText(bytes);
  assert.match(text, /INV-100/);
  assert.ok(text.length > 20);
});
