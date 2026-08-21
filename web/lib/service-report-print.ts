/**
 * Build print-ready HTML for a service report (Android exportPDF layout parity).
 * Uses tables only — reliable across browsers and WebView PDF.
 * Free-account CTA is added only when /api/billing/send-report wraps email HTML.
 */

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
  data: Record<string, string> | null | undefined
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
    `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px">${esc(title)}</h3>` +
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">` +
    `<tr style="background:#f5f5f5"><th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Item</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:center;width:72px">Result</th></tr>` +
    rows +
    `</table>`
  );
}

function perfTable(measurements: any[] | null | undefined): string {
  if (!Array.isArray(measurements) || !measurements.length) return '';
  const rows = measurements
    .map((m) => {
      if (!m) return '';
      const set = m.set ?? m.setting ?? '—';
      const actual = m.actual ?? m.measured ?? '—';
      const unit = m.unit || '';
      const dev = m.deviation ?? m.dev ?? '—';
      const pass =
        m.pass === true || m.result === 'PASS' || String(m.result || '').toUpperCase() === 'PASS';
      const fail =
        m.pass === false || m.result === 'FAIL' || String(m.result || '').toUpperCase() === 'FAIL';
      const resultStr = pass ? 'PASS' : fail ? 'FAIL' : '—';
      const color = pass ? '#16a34a' : fail ? '#dc2626' : '#555';
      const wl = m.wavelength || m.name || '';
      return (
        `<tr>` +
        `<td style="padding:5px 8px;border:1px solid #ddd">${esc(wl)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(set)} ${esc(unit)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(actual)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center">${esc(dev)}</td>` +
        `<td style="padding:5px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:${color}">${resultStr}</td>` +
        `</tr>`
      );
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return (
    `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px">Performance Testing</h3>` +
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">` +
    `<tr style="background:#f5f5f5">` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Wavelength</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Set</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Actual</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">% Dev</th>` +
    `<th style="padding:5px 8px;border:1px solid #ddd;text-align:left">Result</th></tr>` +
    rows +
    `</table>`
  );
}

export function buildServiceReportPrintHTML(r: PrintReportInput): string {
  const engineer = r.service_engineer || r.tech_name || '—';
  const reportNum = r.report_number || '—';
  const dateOut = r.date_out || '—';
  const addr = [r.customer_address, r.customer_city, r.customer_state].filter(Boolean).join(', ');

  let logo = '';
  if (r.tech_company_logo_url) {
    logo = `<img src="${esc(r.tech_company_logo_url)}" style="max-width:105px;max-height:55px;object-fit:contain" alt="Logo" />`;
  }
  const company =
    (r.tech_company_name
      ? `<div style="font-size:14px;font-weight:800">${esc(r.tech_company_name)}</div>`
      : '') +
    ([r.tech_company_address, r.tech_company_city, r.tech_company_state].filter(Boolean).length
      ? `<div style="font-size:10px;color:#444">${esc(
          [r.tech_company_address, r.tech_company_city, r.tech_company_state]
            .filter(Boolean)
            .join(', ')
        )}</div>`
      : '') +
    (r.tech_company_phone
      ? `<div style="font-size:10px;color:#444">${esc(r.tech_company_phone)}</div>`
      : '');

  const header =
    `<table style="width:100%;border-bottom:3px solid #FBBF24;margin-bottom:10px;border-collapse:collapse"><tr>` +
    `<td style="width:120px;vertical-align:top;padding-right:8px">${logo}</td>` +
    `<td style="vertical-align:top;font-size:10px">${company}</td>` +
    `<td style="width:120px;vertical-align:top;text-align:right">` +
    `<div style="font-size:16px;font-weight:700">Service Report</div>` +
    `<div style="font-size:12px;color:#B45309;font-weight:700">${esc(reportNum)}</div>` +
    `<div style="font-size:10px;color:#555">${esc(dateOut)}</div>` +
    `</td></tr></table>`;

  let paramsHTML = '';
  if (r.model_parameters && typeof r.model_parameters === 'object') {
    const keys = Object.keys(r.model_parameters).filter((k) => !k.startsWith('__'));
    if (keys.length) {
      paramsHTML =
        `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px">System Parameters</h3>` +
        `<table style="width:100%;border-collapse:collapse;font-size:11px">` +
        keys
          .map(
            (k) =>
              `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:600;width:50%">${esc(k)}</td>` +
              `<td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(r.model_parameters![k] ?? '—')}</td></tr>`
          )
          .join('') +
        `</table>`;
    }
  }

  let safetyHTML = '';
  if (r.ground_resistance != null || r.leakage_current != null) {
    const gr = r.ground_resistance;
    const lc = r.leakage_current;
    const grPass = r.ground_resistance_pass ?? (gr != null && gr <= 0.2);
    const lcPass = r.leakage_current_pass ?? (lc != null && lc <= 300);
    safetyHTML =
      `<h3 style="margin:14px 0 6px;color:#111;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px">Electrical Safety</h3>` +
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
    `<td style="width:50%;padding:2px 4px 2px 0"><span style="font-size:8px;color:#666">EQUIPMENT</span><br><strong>${esc(r.equipment_name || '—')}</strong></td>` +
    `<td style="width:50%;padding:2px 0 2px 4px"><span style="font-size:8px;color:#666">SERIAL #</span><br><strong>${esc(r.serial_number || '—')}</strong></td>` +
    `</tr><tr>` +
    `<td style="padding:2px 4px 2px 0"><span style="font-size:8px;color:#666">ENGINEER (FSE)</span><br><strong>${esc(engineer)}</strong></td>` +
    `<td style="padding:2px 0 2px 4px"><span style="font-size:8px;color:#666">NEXT PM</span><br><strong>${esc(r.next_pm_due || '—')}</strong></td>` +
    `</tr></table></div>` +
    checklistTable('Electrical Checklist', r.checklist_electrical || undefined) +
    checklistTable('Mechanical & Optical', r.checklist_mechanical || undefined) +
    checklistTable('Aesthetic Condition', r.checklist_aesthetic || undefined) +
    perfTable(r.power_measurements) +
    paramsHTML +
    safetyHTML +
    (r.comments
      ? `<h3 style="margin:14px 0 6px;border-bottom:2px solid #FBBF24;padding-bottom:4px;font-size:13px">Comments &amp; Notes</h3>` +
        `<p style="font-size:12px;background:#f9f9f9;padding:10px;border-radius:4px">${esc(r.comments)}</p>`
      : '') +
    `<div style="margin-top:28px;border-top:2px solid #FBBF24;padding-top:12px">` +
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
