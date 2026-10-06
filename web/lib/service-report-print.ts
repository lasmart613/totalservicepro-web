/**
 * Build print-ready HTML for a service report (Android exportPDF layout parity).
 * Uses tables only — reliable across browsers and WebView PDF.
 * Free-account CTA is added only when /api/billing/send-report wraps email HTML.
 * Brand colors: header and logo always, section rules only for document/PDF scope.
 */

import {
  readableOn,
  themeAccentForScope,
  type CompanyTheme,
  type ThemeScope,
} from './company-theme.ts';
import { viewMeasurement } from './fluence-measurement.ts';
import { displayModelText } from './model-display.ts';
import { systemParameterRows } from './models.ts';

export type PrintReportInput = {
  report_number?: string | null;
  date_out?: string | null;
  next_pm_due?: string | null;
  service_engineer?: string | null;
  tech_name?: string | null;
  equipment_name?: string | null;
  serial_number?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_city?: string | null;
  customer_state?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_contact_name?: string | null;
  customer_website?: string | null;
  service_type?: string | null;
  comments?: string | null;
  checklist_electrical?: Record<string, string> | null;
  checklist_mechanical?: Record<string, string> | null;
  checklist_aesthetic?: Record<string, string> | null;
  power_measurements?: any[] | null;
  model_parameters?: Record<string, any> | null;
  ground_resistance?: number | null;
  leakage_current?: number | null;
  ground_resistance_pass?: boolean | null;
  leakage_current_pass?: boolean | null;
  tech_signature?: string | null;
  signed_date?: string | null;
  tech_company_name?: string | null;
  tech_company_address?: string | null;
  tech_company_city?: string | null;
  tech_company_state?: string | null;
  tech_company_phone?: string | null;
  tech_company_logo_url?: string | null;
  status?: string | null;
  model_type?: string | null;
  theme?: CompanyTheme | null;
  themeScope?: ThemeScope;
};

function esc(s: any): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function checklistTable(
  title: string,
  data: Record<string, string> | null | undefined,
  accent = '#FBBF24'
): string {
  if (!data || typeof data !== 'object') return '';
  const keys = Object.keys(data);
  if (!keys.length) return '';
  const rows = keys
    .map((label) => {
      const raw = data[label] == null || data[label] === '' ? '—' : String(data[label]).trim();
      const u = raw.toUpperCase();
      let color = '#555';
      if (u === 'PASS' || u === 'P') color = '#16a34a';
      else if (u === 'FAIL' || u === 'F') color = '#dc2626';
      else if (u === 'N/A' || u === 'NA') color = '#6b7280';
      const display = raw === '—' ? '—' : raw.toUpperCase();
      return (
        `<tr><td style="padding:4px 8px;border:1px solid #ddd">${esc(label)}</td>` +
        `<td style="padding:4px 8px;border:1px solid #ddd;font-weight:700;color:${color};width:72px;text-align:center">${esc(display)}</td></tr>`
      );
    })
    .join('');
  return (
    `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid ${accent};padding-bottom:4px;font-size:13px">${esc(title)}</h3>` +
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">` +
    `<tr style="background:#f5f5f5"><th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Item</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:center;width:72px">Result</th></tr>` +
    rows +
    `</table>`
  );
}

function perfTable(measurements: any[] | null | undefined, accent = '#FBBF24'): string {
  if (!Array.isArray(measurements) || !measurements.length) return '';
  const rows = measurements
    .map((m) => {
      if (!m) return '';
      const view = viewMeasurement(m);
      const pass = view.pass === true;
      const fail = view.pass === false;
      const color = pass ? '#16a34a' : fail ? '#dc2626' : '#555';
      const outcome = pass ? 'PASS' : fail ? 'FAIL' : '';
      const resultText = view.legacy
        ? view.result
        : `${view.result}${outcome ? ` ${outcome}` : ''}`.trim();
      return (
        `<tr>` +
        `<td style="padding:5px 8px;border:1px solid #ddd">${esc(view.wavelength)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(view.spot)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(view.set)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(view.measured)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(resultText)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:${color}">${esc(view.error)}</td>` +
        `</tr>`
      );
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return (
    `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid ${accent};padding-bottom:4px;font-size:13px">Performance Testing</h3>` +
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">` +
    `<tr style="background:#f5f5f5">` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Wavelength</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Spot</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Set</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Measured</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Result</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Error %</th></tr>` +
    rows +
    `</table>`
  );
}

export function buildServiceReportPrintHTML(r: PrintReportInput): string {
  const engineer = r.service_engineer || r.tech_name || '—';
  const reportNum = r.report_number || '—';
  const dateOut = r.date_out || '—';
  const addr = [r.customer_address, r.customer_city, r.customer_state].filter(Boolean).join(', ');
  const theme = r.theme?.branded ? r.theme : null;
  const accent = themeAccentForScope(r.theme, r.themeScope);
  const ink = theme ? theme.onPrimary : '#111';
  const muted = theme ? theme.onPrimary : '#444';
  const meta = theme ? theme.onPrimary : '#555';
  const numberColor = theme ? readableOn(theme.accent, theme.primary, theme.onPrimary) : '#B45309';

  let logo = '';
  if (r.tech_company_logo_url) {
    const logoStyle = theme
      ? 'max-width:105px;max-height:55px;object-fit:contain;background:#ffffff;padding:4px;border-radius:4px;display:block'
      : 'max-width:105px;max-height:55px;object-fit:contain';
    logo = `<img src="${esc(r.tech_company_logo_url)}" style="${logoStyle}" alt="Logo" />`;
  }
  const company =
    (r.tech_company_name
      ? `<div style="font-size:14px;font-weight:800${theme ? `;color:${ink}` : ''}">${esc(r.tech_company_name)}</div>`
      : '') +
    ([r.tech_company_address, r.tech_company_city, r.tech_company_state].filter(Boolean).length
      ? `<div style="font-size:10px;color:${muted}">${esc(
          [r.tech_company_address, r.tech_company_city, r.tech_company_state]
            .filter(Boolean)
            .join(', ')
        )}</div>`
      : '') +
    (r.tech_company_phone
      ? `<div style="font-size:10px;color:${muted}">${esc(r.tech_company_phone)}</div>`
      : '');

  const bar = theme
    ? `background:${theme.primary};color:${theme.onPrimary};border-bottom:3px solid ${theme.accent};`
    : 'border-bottom:3px solid #FBBF24;';
  const brandAttr = theme ? ' data-tsp-brand-header="1"' : '';
  const logoCell = theme ? 'padding:8px 8px 8px 0' : 'padding-right:8px';
  const midCell = theme ? 'padding:8px 0' : '';
  const titleCell = theme ? 'padding:8px 0' : '';
  const header =
    `<table${brandAttr} style="width:100%;${bar}margin-bottom:10px;border-collapse:collapse"><tr>` +
    `<td style="width:120px;vertical-align:top;${logoCell}">${logo}</td>` +
    `<td style="vertical-align:top;font-size:10px;${midCell}">${company}</td>` +
    `<td style="width:120px;vertical-align:top;text-align:right;${titleCell}">` +
    `<div style="font-size:16px;font-weight:700${theme ? `;color:${ink}` : ''}">Service Report</div>` +
    `<div style="font-size:12px;color:${numberColor};font-weight:700">${esc(reportNum)}</div>` +
    `<div style="font-size:10px;color:${meta}">${esc(dateOut)}</div>` +
    `</td></tr></table>`;

  let paramsHTML = '';
  const parameterRows = systemParameterRows(r.model_parameters, r.model_type, r.equipment_name);
  if (parameterRows.length) {
    paramsHTML =
      `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid ${accent};padding-bottom:4px;font-size:13px">System Parameters</h3>` +
      `<table style="width:100%;border-collapse:collapse;font-size:11px">` +
      parameterRows
        .map(
          (row) =>
            `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:600;width:50%">${esc(row.label)}</td>` +
            `<td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(row.value)}</td></tr>`
        )
        .join('') +
      `</table>`;
  }

  let safetyHTML = '';
  if (r.ground_resistance != null || r.leakage_current != null) {
    const gr = r.ground_resistance;
    const lc = r.leakage_current;
    const grPass = r.ground_resistance_pass ?? (gr != null && gr <= 0.2);
    const lcPass = r.leakage_current_pass ?? (lc != null && lc <= 300);
    safetyHTML =
      `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid ${accent};padding-bottom:4px;font-size:13px">Electrical Safety</h3>` +
      `<table style="width:100%;border-collapse:collapse;font-size:11px">` +
      (gr != null
        ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:600">Ground Resistance</td>` +
          `<td style="padding:5px 8px;border-bottom:1px solid #eee">${Number(gr).toFixed(3)} Ω</td>` +
          `<td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:700;color:${grPass ? '#16a34a' : '#dc2626'}">${grPass ? 'PASS' : 'FAIL'}</td></tr>`
        : '') +
      (lc != null
        ? `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:600">Leakage Current</td>` +
          `<td style="padding:5px 8px;border-bottom:1px solid #eee">${Number(lc).toFixed(1)} μA</td>` +
          `<td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:700;color:${lcPass ? '#16a34a' : '#dc2626'}">${lcPass ? 'PASS' : 'FAIL'}</td></tr>`
        : '') +
      `</table>`;
  }

  let sigImg =
    '<div style="height:48px;border:1px dashed #ccc;margin-top:4px;background:#fafafa"></div>';
  if (
    r.tech_signature &&
    String(r.tech_signature).indexOf('data:image') === 0 &&
    String(r.tech_signature).length > 64
  ) {
    sigImg = `<img src="${r.tech_signature}" width="200" height="48" style="height:48px;max-width:200px;border:1px solid #ccc;background:#fff;display:block;margin-top:4px" alt="Signature" />`;
  }

  return (
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Service Report ${esc(reportNum)}</title>` +
    `<style>body{margin:0;padding:12px;color:#111;font-size:11px;line-height:1.3;font-family:Arial,Helvetica,sans-serif}` +
    `table{border-collapse:collapse} @media print{@page{size:8.5in 11in;margin:0.35in}}</style></head><body>` +
    header +
    `<div style="margin-bottom:8px;padding:6px 8px;background:#f8f4e8;border:1px solid #e8d9a0;border-radius:4px">` +
    `<div style="font-size:9px;font-weight:700;color:#8a6f2e;text-transform:uppercase;margin-bottom:3px">Customer</div>` +
    `<table style="width:100%;font-size:10px"><tr>` +
    `<td style="width:50%;padding:2px 4px 2px 0"><span style="font-size:8px;color:#666">NAME</span><br><strong>${esc(r.customer_name || '—')}</strong></td>` +
    `<td style="width:50%;padding:2px 0 2px 4px"><span style="font-size:8px;color:#666">ADDRESS</span><br><strong>${esc(addr || '—')}</strong></td>` +
    `</tr><tr>` +
    `<td style="padding:2px 4px 2px 0"><span style="font-size:8px;color:#666">CONTACT</span><br><strong>${esc(r.customer_contact_name || '—')}</strong></td>` +
    `<td style="padding:2px 0 2px 4px"><span style="font-size:8px;color:#666">PHONE</span><br><strong>${esc(r.customer_phone || '—')}</strong></td>` +
    `</tr></table></div>` +
    `<div style="margin-bottom:10px;padding:6px 8px;background:#f9f9f9;border:1px solid #eee;border-radius:4px">` +
    `<div style="font-size:9px;font-weight:700;color:#666;text-transform:uppercase;margin-bottom:3px">Report</div>` +
    `<table style="width:100%;font-size:10px"><tr>` +
    `<td style="width:50%;padding:2px 4px 2px 0"><span style="font-size:8px;color:#666">EQUIPMENT</span><br><strong>${esc(displayModelText(r.equipment_name || '') || '—')}</strong></td>` +
    `<td style="width:50%;padding:2px 0 2px 4px"><span style="font-size:8px;color:#666">SERIAL #</span><br><strong>${esc(r.serial_number || '—')}</strong></td>` +
    `</tr><tr>` +
    `<td style="padding:2px 4px 2px 0"><span style="font-size:8px;color:#666">ENGINEER (FSE)</span><br><strong>${esc(engineer)}</strong></td>` +
    `<td style="padding:2px 0 2px 4px"><span style="font-size:8px;color:#666">NEXT PM</span><br><strong>${esc(r.next_pm_due || '—')}</strong></td>` +
    `</tr></table></div>` +
    checklistTable('Electrical Checklist', r.checklist_electrical || undefined, accent) +
    checklistTable('Mechanical & Optical', r.checklist_mechanical || undefined, accent) +
    checklistTable('Aesthetic Condition', r.checklist_aesthetic || undefined, accent) +
    perfTable(r.power_measurements, accent) +
    paramsHTML +
    safetyHTML +
    (r.comments
      ? `<h3 style="margin:14px 0 6px;border-bottom:2px solid ${accent};padding-bottom:4px;font-size:13px">Comments &amp; Notes</h3>` +
        `<p style="font-size:12px;background:#f9f9f9;padding:10px;border-radius:4px">${esc(r.comments)}</p>`
      : '') +
    `<div style="margin-top:28px;border-top:2px solid ${accent};padding-top:12px">` +
    `<table style="width:100%;font-size:12px;margin-bottom:10px"><tr>` +
    `<td>Technician: <strong>${esc(engineer)}</strong></td>` +
    `<td style="text-align:right">Date of Service: ${esc(dateOut)}</td></tr></table>` +
    `<table style="width:100%;font-size:12px"><tr>` +
    `<td style="width:50%;vertical-align:top;padding-right:16px">` +
    `<div style="border-top:1px solid #999;padding-top:4px;color:#555;margin-bottom:4px">Technician Signature</div>` +
    sigImg +
    `<div style="font-size:10px;color:#555;margin-top:4px">Date: ${esc(r.signed_date || dateOut)}</div>` +
    `</td>` +
    `<td style="width:50%;vertical-align:top;padding-left:16px">` +
    `<div style="border-top:1px solid #999;padding-top:4px;color:#555;margin-bottom:4px">Customer Signature &amp; Date</div>` +
    `<div style="height:48px;border:1px dashed #ccc;margin-top:4px;background:#fafafa"></div>` +
    `</td></tr></table></div>` +
    `</body></html>`
  );
}
