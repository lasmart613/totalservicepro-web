/**
 * HTML document builders matching Android estimate_generator / invoice_form PDF layout.
 * Used for on-screen preview and print-to-PDF (same visual quality as the app).
 * Free-account marketing CTA is email-only — see wrapCustomerFacingDocumentEmail.
 * Do not add that footer here or PDFs will pick it up.
 */

export type DocCompany = {
  company_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  slogan?: string;
  logo_url?: string;
  tech_name?: string;
};

export type DocCustomer = {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  contact?: string;
  phone?: string;
  email?: string;
  website?: string;
};

function esc(s: any) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number | undefined | null) {
  return `$${Number(n || 0).toFixed(2)}`;
}

/** Table-based CTAs so Gmail does not collapse the buttons. Safe for client + email. */
export function buildEstimateActionCtasHtml(actionUrl: string): string {
  const approveHref = esc(actionUrl);
  const changesHref = esc(
    actionUrl.includes('?') ? `${actionUrl}&changes=1` : `${actionUrl}?changes=1`
  );
  return (
    `<table class="tsp-est-cta" role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:22px 0 8px;border-collapse:collapse;">` +
    `<tr><td align="center" style="padding:0 8px 10px;font-size:13px;color:#111;font-weight:700;">` +
    `Please review this estimate and let us know how to proceed.` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:6px 8px;">` +
    `<a href="${approveHref}" ` +
    `style="display:inline-block;background:#FBBF24;color:#111827;padding:14px 28px;border-radius:8px;` +
    `text-decoration:none;font-weight:800;font-size:16px;letter-spacing:0.02em;border:2px solid #FBBF24;">` +
    `Approve Estimate</a>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:6px 8px 4px;">` +
    `<a href="${changesHref}" ` +
    `style="display:inline-block;background:#ffffff;color:#111827;padding:12px 24px;border-radius:8px;` +
    `text-decoration:none;font-weight:700;font-size:14px;border:2px solid #FBBF24;">` +
    `Request Changes</a>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:8px 8px 0;font-size:10px;color:#666;">` +
    `Sign in with your clinic account to approve. Opens your estimate on RepairPlanet.` +
    `</td></tr>` +
    `</table>`
  );
}

/** Inject CTAs when the client HTML was built before a token existed. */
export function ensureEstimateActionCtas(html: string, actionUrl: string): string {
  if (!html || !actionUrl) return html;
  if (html.includes('tsp-est-cta') || html.includes(actionUrl)) return html;
  const cta = buildEstimateActionCtasHtml(actionUrl);
  const thankYou = html.lastIndexOf('Thank you for choosing');
  if (thankYou >= 0) {
    return html.slice(0, thankYou) + cta + html.slice(thankYou);
  }
  return html + cta;
}

/** Top header: logo | company block | title/number/date — matches Android buildDocTopHeader */
export function buildDocTopHeader(
  company: DocCompany,
  docTitle: string,
  docNum: string,
  docDate: string
): string {
  const cName = company.company_name || '';
  const cAddr = [company.address, company.city, company.state, company.zip].filter(Boolean).join(', ');
  const cPhone = company.phone || '';
  const cEmail = company.email || '';
  const cWebsite = company.website || '';
  const cSlogan = company.slogan || '';

  let logoBlock = '';
  if (company.logo_url) {
    logoBlock =
      `<img src="${esc(company.logo_url)}" style="max-width:105px;max-height:55px;object-fit:contain;border-radius:4px;display:block;" alt="Company Logo" />` +
      (cSlogan
        ? `<div style="font-size:9px;font-style:italic;color:#555;margin-top:2px;line-height:1.1;max-width:105px;">${esc(cSlogan)}</div>`
        : '');
  }

  let companyBlock = '';
  if (cName || cAddr || cPhone || cEmail || cWebsite) {
    companyBlock =
      (cName
        ? `<div style="font-size:14px;font-weight:800;color:#111;line-height:1.1;">${esc(cName)}</div>`
        : '') +
      (cAddr ? `<div style="font-size:10px;color:#444;line-height:1.15;">${esc(cAddr)}</div>` : '') +
      (cPhone ? `<div style="font-size:10px;color:#444;">${esc(cPhone)}</div>` : '') +
      (cEmail ? `<div style="font-size:10px;color:#444;">${esc(cEmail)}</div>` : '') +
      (cWebsite ? `<div style="font-size:10px;color:#0a66c2;">${esc(cWebsite)}</div>` : '');
  }

  if (logoBlock || companyBlock) {
    return (
      `<table style="width:100%;border-bottom:3px solid #FBBF24;padding-bottom:6px;margin-bottom:10px;border-collapse:collapse;"><tr>` +
      `<td style="width:120px;vertical-align:top;padding-right:8px;">${logoBlock}</td>` +
      `<td style="vertical-align:top;padding-right:8px;font-size:10px;">${companyBlock}</td>` +
      `<td style="width:130px;vertical-align:top;text-align:right;white-space:nowrap;">` +
      `<div style="font-size:16px;font-weight:700;color:#111;">${esc(docTitle)}</div>` +
      (docNum
        ? `<div style="font-size:12px;color:#B45309;font-weight:700;">${esc(docNum)}</div>`
        : '') +
      (docDate ? `<div style="font-size:10px;color:#555;">${esc(docDate)}</div>` : '') +
      `</td></tr></table>`
    );
  }

  return (
    `<div style="border-bottom:3px solid #FBBF24;padding-bottom:4px;margin-bottom:8px;text-align:right;">` +
    `<div style="font-size:16px;font-weight:700;color:#111;">${esc(docTitle)}</div>` +
    (docDate ? `<div style="font-size:10px;color:#555;">${esc(docDate)}</div>` : '') +
    `</div>`
  );
}

function customerBillTo(customer: DocCustomer): string {
  const addr = [customer.address, customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(', ');
  return (
    `<div style="margin-bottom:8px;padding:6px 8px;background:#f8f4e8;border:1px solid #e8d9a0;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Customer / Bill To</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div><span style="color:#666;font-size:8px;">NAME</span> ${esc(customer.name || '—')}</div>` +
    `<div><span style="color:#666;font-size:8px;">ADDRESS</span> ${esc(addr || '—')}</div>` +
    `<div><span style="color:#666;font-size:8px;">CONTACT</span> ${esc(customer.contact || '—')}</div>` +
    `<div><span style="color:#666;font-size:8px;">PHONE</span> ${esc(customer.phone || '—')}</div>` +
    `<div><span style="color:#666;font-size:8px;">EMAIL</span> ${esc(customer.email || '—')}</div>` +
    (customer.website
      ? `<div><span style="color:#666;font-size:8px;">WEBSITE</span> ${esc(customer.website)}</div>`
      : '') +
    `</div></div>`
  );
}

export type InvoiceHtmlInput = {
  company: DocCompany;
  customer: DocCustomer;
  invNumber: string;
  invoiceDate: string;
  dueDate?: string;
  description?: string;
  preparedBy?: string;
  fromEstimateId?: string | number | null;
  lines: { part_number?: string; description?: string; qty?: number; unit_price?: number; ext?: number }[];
  subtotal: number;
  tax: number;
  total: number;
  deposit?: number;
  depositDate?: string;
  depositMethod?: string;
  balanceDue?: number;
  /** Stripe Checkout / Payment Link URL for remaining balance */
  paymentUrl?: string | null;
};

export function buildInvoiceHtml(input: InvoiceHtmlInput): string {
  const dateLabel = input.invoiceDate
    ? (() => {
        try {
          return new Date(input.invoiceDate + (input.invoiceDate.length === 10 ? 'T12:00:00' : '')).toLocaleDateString();
        } catch {
          return input.invoiceDate;
        }
      })()
    : new Date().toLocaleDateString();
  const dueLabel = input.dueDate
    ? (() => {
        try {
          return new Date(input.dueDate + (input.dueDate.length === 10 ? 'T12:00:00' : '')).toLocaleDateString();
        } catch {
          return input.dueDate;
        }
      })()
    : '—';

  let linesHtml =
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin:0 0 12px;">` +
    `<thead><tr style="background:#f5f5f5;border-bottom:2px solid #FBBF24;">` +
    `<th style="text-align:left;padding:6px 4px;">Part #</th>` +
    `<th style="text-align:left;padding:6px 4px;">Description</th>` +
    `<th style="text-align:right;padding:6px 4px;">Qty</th>` +
    `<th style="text-align:right;padding:6px 4px;">Price</th>` +
    `<th style="text-align:right;padding:6px 4px;">Ext</th>` +
    `</tr></thead><tbody>`;

  const items = (input.lines || []).filter(
    (it) => it.description || it.part_number || it.unit_price
  );
  if (!items.length) {
    linesHtml += `<tr><td colspan="5" style="padding:8px;color:#666;">No line items</td></tr>`;
  } else {
    items.forEach((it) => {
      const ext = it.ext ?? (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
      linesHtml +=
        `<tr style="border-bottom:1px solid #eee;">` +
        `<td style="padding:5px 4px;vertical-align:top;">${esc(it.part_number || '')}</td>` +
        `<td style="padding:5px 4px;vertical-align:top;">${esc(it.description || '')}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${Number(it.qty || 0)
          .toFixed(2)
          .replace(/\.00$/, '')}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${money(it.unit_price)}</td>` +
        `<td style="padding:5px 4px;text-align:right;vertical-align:top;">${money(ext)}</td>` +
        `</tr>`;
    });
  }
  linesHtml += `</tbody></table>`;

  const deposit = Number(input.deposit) || 0;
  const total = Number(input.total) || 0;
  const balance = input.balanceDue != null ? Number(input.balanceDue) : Math.max(0, total - deposit);

  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.35;max-width:800px;margin:auto;">` +
    buildDocTopHeader(input.company, 'Invoice', input.invNumber, dateLabel) +
    customerBillTo({
      ...input.customer,
      // show due in bill-to grid like app
    }) +
    `<div style="margin-bottom:10px;padding:6px 8px;background:#f9f9f9;border:1px solid #eee;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Invoice</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div><span style="color:#666;font-size:8px;">INVOICE DATE</span> ${esc(dateLabel)}</div>` +
    `<div><span style="color:#666;font-size:8px;">INVOICE #</span> ${esc(input.invNumber)}</div>` +
    `<div><span style="color:#666;font-size:8px;">DUE DATE</span> ${esc(dueLabel)}</div>` +
    (input.preparedBy || input.company.tech_name
      ? `<div><span style="color:#666;font-size:8px;">PREPARED BY</span> ${esc(
          input.preparedBy || input.company.tech_name
        )}</div>`
      : '') +
    (input.fromEstimateId
      ? `<div><span style="color:#666;font-size:8px;">FROM ESTIMATE</span> #${esc(
          String(input.fromEstimateId)
        )}</div>`
      : '') +
    `</div></div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">Line Items</h3>` +
    linesHtml +
    (input.description
      ? `<div style="margin:0 0 12px;font-size:11px;color:#444;"><strong>Notes:</strong> ${esc(
          input.description
        )}</div>`
      : '') +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">Amounts</h3>` +
    `<div style="font-size:13px;font-weight:600;">` +
    `<div>Subtotal: ${money(input.subtotal)}</div>` +
    `<div>Tax: ${money(input.tax)}</div>` +
    `<div class="totals" style="margin-top:10px;padding-top:10px;border-top:2px solid #ccc;font-size:1.25rem;">Invoice Total: ${money(
      total
    )}</div>` +
    (deposit > 0
      ? `<div style="margin-top:10px;padding:10px;background:#fffbeb;border:1px solid #FBBF24;border-radius:6px;font-size:12px;">` +
        `<div>Deposit received: <strong>${money(deposit)}</strong>` +
        (input.depositDate
          ? ` on ${esc(
              (() => {
                try {
                  return new Date(
                    input.depositDate + (input.depositDate.length === 10 ? 'T12:00:00' : '')
                  ).toLocaleDateString();
                } catch {
                  return input.depositDate;
                }
              })()
            )}`
          : '') +
        (input.depositMethod ? ` via ${esc(input.depositMethod)}` : '') +
        `</div>` +
        `<div style="font-size:1.1rem;margin-top:4px;">Balance remaining: <strong>${money(
          balance
        )}</strong></div></div>`
      : '') +
    `</div>` +
    `<div style="margin-top:28px;font-size:11px;color:#555;text-align:center;border-top:1px solid #eee;padding-top:12px;">` +
    (deposit > 0
      ? `Deposit has been applied. Remaining balance is payable upon completion of the service call.<br>`
      : '') +
    (input.paymentUrl && balance > 0
      ? `<div style="margin:18px 0 8px;text-align:center;">` +
        `<a href="${esc(input.paymentUrl)}" ` +
        `style="display:inline-block;background:#635BFF;color:#fff;padding:14px 28px;border-radius:8px;` +
        `text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">` +
        `Pay ${money(balance)} securely with Stripe</a>` +
        `<div style="font-size:10px;color:#666;margin-top:8px;">Secure card payment · Powered by Stripe</div>` +
        `</div>`
      : '') +
    `Thank you for choosing ${esc(input.company.company_name || 'Total Service Pro')}!` +
    `</div></div>`
  );
}

export type EstimateHtmlInput = {
  company: DocCompany;
  customer: DocCustomer;
  estNumber: string;
  dateStr: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  pulseCount?: string;
  miles?: number;
  urgency?: string;
  services: string[];
  issues?: string;
  laborHours?: number;
  laborRate?: number;
  labor?: number;
  travelRate?: number;
  travel?: number;
  diagFee?: number;
  reimbTravel?: number;
  reimbLodging?: number;
  reimbGround?: number;
  reimbOther?: number;
  perDiem?: number;
  perDiemRate?: number;
  perDiemDays?: number;
  partsLines?: string[];
  partsTotal?: number;
  subtotal: number;
  taxRate?: number;
  tax: number;
  total: number;
  deposit?: number;
  balanceDue?: number;
  validDays?: number;
  /** Clinic estimate page (https://repairplanet.net/estimates/{id}). */
  actionUrl?: string | null;
};

export function buildEstimateHtml(input: EstimateHtmlInput): string {
  const services = input.services?.length ? input.services : ['Not specified'];
  const deposit = Number(input.deposit) || 0;
  const balance =
    input.balanceDue != null
      ? Number(input.balanceDue)
      : Math.max(0, Number(input.total) - deposit);

  let cost = `<div style="font-size:12px;">`;
  if (input.diagFee) cost += `<div>Diagnostic Fee: ${money(input.diagFee)}</div>`;
  if (input.labor)
    cost += `<div>Labor: ${input.laborHours ?? 0} hrs @ ${money(input.laborRate)}/hr = ${money(
      input.labor
    )}</div>`;
  if (input.travel)
    cost += `<div>Travel (mileage): ${input.miles ?? 0} mi @ ${money(input.travelRate)}/mi = ${money(
      input.travel
    )}</div>`;
  if (
    input.reimbTravel ||
    input.reimbLodging ||
    input.reimbGround ||
    input.reimbOther ||
    input.perDiem
  ) {
    cost += `<div style="margin-top:8px;font-weight:700;font-size:11px;color:#555;">REIMBURSABLE EXPENSES</div>`;
  }
  if (input.reimbTravel)
    cost += `<div style="padding-left:8px;">Travel (airfare / tickets): ${money(input.reimbTravel)}</div>`;
  if (input.reimbLodging)
    cost += `<div style="padding-left:8px;">Lodging: ${money(input.reimbLodging)}</div>`;
  if (input.reimbGround)
    cost += `<div style="padding-left:8px;">Car rental / ground transportation: ${money(
      input.reimbGround
    )}</div>`;
  if (input.perDiem)
    cost += `<div style="padding-left:8px;">Per diem: ${input.perDiemDays ?? 0} day(s) @ ${money(
      input.perDiemRate
    )}/day = ${money(input.perDiem)}</div>`;
  if (input.reimbOther)
    cost += `<div style="padding-left:8px;">Other: ${money(input.reimbOther)}</div>`;
  if (input.partsTotal) {
    cost += `<div style="margin-top:6px;">Parts:<br>`;
    (input.partsLines || []).forEach((ln) => {
      cost += `<div>${esc(ln)}</div>`;
    });
    cost += `<strong>Parts Subtotal: ${money(input.partsTotal)}</strong></div>`;
  }
  cost +=
    `<div class="totals" style="font-weight:bold;font-size:1.1rem;margin-top:14px;border-top:2px solid #ccc;padding-top:12px;">` +
    `Subtotal: ${money(input.subtotal)}<br>` +
    `Tax (${input.taxRate ?? 0}%): ${money(input.tax)}<br>` +
    `<span style="font-size:1.25rem;">Grand Total: ${money(input.total)}</span></div>`;
  if (deposit > 0) {
    cost +=
      `<div style="margin-top:14px;padding:12px;background:#fffbeb;border:1px solid #FBBF24;border-radius:6px;">` +
      `<div style="font-weight:800;font-size:13px;color:#92400e;margin-bottom:6px;">Parts / Travel Deposit</div>` +
      `<div style="font-size:12px;color:#111;line-height:1.45;">` +
      `A deposit of <strong>${money(deposit)}</strong> (covering estimated parts and travel-related costs) ` +
      `must be paid before the service call is scheduled. ` +
      `The remaining balance of <strong>${money(
        balance
      )}</strong> is due upon completion of the service call.` +
      `</div></div>`;
  }
  cost += `</div>`;

  const valid = input.validDays ?? 30;

  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.35;max-width:800px;margin:auto;">` +
    buildDocTopHeader(input.company, 'Service Estimate', input.estNumber, input.dateStr) +
    customerBillTo(input.customer) +
    `<div style="margin-bottom:10px;padding:6px 8px;background:#f9f9f9;border:1px solid #eee;border-radius:4px;">` +
    `<div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Estimate Details</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:10px;">` +
    `<div><span style="color:#666;font-size:8px;">MANUFACTURER</span> ${esc(
      input.manufacturer || '—'
    )}</div>` +
    `<div><span style="color:#666;font-size:8px;">MODEL</span> ${esc(input.model || '—')}</div>` +
    `<div><span style="color:#666;font-size:8px;">SERIAL #</span> ${esc(input.serial || '—')}</div>` +
    `<div><span style="color:#666;font-size:8px;">PULSE COUNT</span> ${esc(
      input.pulseCount || '—'
    )}</div>` +
    `<div><span style="color:#666;font-size:8px;">TRAVEL</span> ${input.miles ?? 0} mi round-trip</div>` +
    `<div><span style="color:#666;font-size:8px;">URGENCY</span> ${esc(
      (input.urgency || 'standard').replace(/^\w/, (c) => c.toUpperCase())
    )}</div>` +
    (input.company.tech_name
      ? `<div><span style="color:#666;font-size:8px;">PREPARED BY</span> ${esc(
          input.company.tech_name
        )}</div>`
      : '') +
    `<div><span style="color:#666;font-size:8px;">DATE</span> ${esc(input.dateStr)}</div>` +
    `</div></div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">Services Included</h3>` +
    `<div style="font-size:12px;margin-bottom:12px;">${services
      .map((s) => `• ${esc(s)}`)
      .join('<br>')}</div>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">Reported Issues</h3>` +
    `<pre style="white-space:pre-wrap;font-family:inherit;margin:0 0 12px;font-size:12px;background:#f9f9f9;padding:8px;border-radius:4px;">${esc(
      input.issues || 'No issues noted'
    )}</pre>` +
    `<h3 style="margin:16px 0 8px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px;">Cost Breakdown</h3>` +
    cost +
    `<div style="margin-top:28px;font-size:11px;color:#555;text-align:center;border-top:1px solid #eee;padding-top:12px;">` +
    `<div style="margin-top:10px;padding:10px;background:#f8f4e8;border:1px solid #e8d9a0;border-radius:6px;font-size:11px;color:#111;">` +
    `<strong>Validity:</strong> This estimate is good for <strong>${valid} days</strong> from the date above. ` +
    `After ${valid} days it is considered expired and pricing may be revised. Prices are subject to on-site inspection.` +
    `</div>` +
    (deposit > 0
      ? `<div style="margin-top:8px;font-size:11px;color:#555;">Scheduling is contingent on receipt of the parts/travel deposit described above.</div>`
      : '') +
    (input.actionUrl ? buildEstimateActionCtasHtml(input.actionUrl) : '') +
    `<div style="margin-top:12px;">Thank you for choosing ${esc(
      input.company.company_name || 'Total Service Pro'
    )}!</div></div></div>`
  );
}

/** Open print dialog with full HTML document (app-quality PDF via browser Save as PDF). */
export function printDocumentHtml(bodyInner: string, title: string) {
  const full =
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>` +
    `<style>html,body{margin:0;padding:12px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;}` +
    `img{max-width:100%;} pre{white-space:pre-wrap;}` +
    `@media print{@page{size:letter;margin:0.4in}}</style></head><body>` +
    bodyInner +
    `</body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('Allow pop-ups to export PDF');
  }
  w.document.write(full);
  w.document.close();
  // Wait for images (logo) to load before print
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  }, 500);
}
