'use client';

// Force dynamic rendering for this page.
// useSearchParams() (used for ?id= edit mode) requires a Suspense boundary for static prerendering.
// This export tells Next.js to skip static generation for /reports/new so the build succeeds.
export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { MODELS, buildManufacturers, CL_ELECTRICAL, CL_MECHANICAL, CL_AESTHETIC, DEFAULT_TEST_EQUIPMENT, computeDeviation, ModelDef, WavelengthSpec } from '@/lib/models';
import { ArrowLeft, Save, FileText, Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const MANUFACTURERS = buildManufacturers();

type ChecklistState = Record<string, 'Pass' | 'Fail' | ''>;

interface PerfRow {
  wavelength: string;
  mode: string;
  set: number;
  actual: number | null;
  result: string;
}

export default function NewServiceReport() {
  const router = useRouter();
  const search = useSearchParams();
  const reportId = search.get('id'); // support ?id= for edit later
  const supabase = getSupabaseClient();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<any>(null);
  const [techCompanyCache, setTechCompanyCache] = useState<any>({});

  // Form state
  const [mfg, setMfg] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [model, setModel] = useState<ModelDef | null>(null);

  const [reportNum, setReportNum] = useState('');
  const [custName, setCustName] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custCity, setCustCity] = useState('');
  const [custState, setCustState] = useState('');
  const [equipName, setEquipName] = useState('');
  const [serialNum, setSerialNum] = useState('');
  const [dateOut, setDateOut] = useState(new Date().toISOString().slice(0, 10));
  const [nextPm, setNextPm] = useState('');
  const [engineer, setEngineer] = useState('');
  const [ticketNum, setTicketNum] = useState('');
  const [comments, setComments] = useState('');

  // Dynamic
  const [serviceType, setServiceType] = useState('PM');
  const [perfData, setPerfData] = useState<Record<string, { actual: number | null }>>({});
  const [paramsData, setParamsData] = useState<Record<string, string>>({});
  const [clElectrical, setClElectrical] = useState<ChecklistState>({});
  const [clMechanical, setClMechanical] = useState<ChecklistState>({});
  const [clAesthetic, setClAesthetic] = useState<ChecklistState>({});
  const [groundRes, setGroundRes] = useState<string>('');
  const [leakageCur, setLeakageCur] = useState<string>('');

  // Test equipment (editable)
  const [testEquip, setTestEquip] = useState<any[]>(DEFAULT_TEST_EQUIPMENT);

  // Signatures (canvas refs + data urls)
  const techSigRef = useRef<HTMLCanvasElement>(null);
  const custSigRef = useRef<HTMLCanvasElement>(null);
  const [techSigData, setTechSigData] = useState<string>('');
  const [custSigData, setCustSigData] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // === NEW: Customer Autocomplete States ===
  const [customerSearchResults, setCustomerSearchResults] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);

  // Load auth + profile + tech info + optional existing report
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      // profile + org
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('first_name, last_name, organization_id, organizations(name, address, city, state, phone, logo_url)')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        const org = profile.organizations || {};
        const techName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
        setEngineer(techName || user.email || '');
        setTechCompanyCache({
          tech_name: techName,
          tech_phone: profile.phone || '',
          tech_email: user.email || '',
          company_name: org.name || '',
          company_address: org.address || '',
          company_city: org.city || '',
          company_state: org.state || '',
          company_phone: org.phone || '',
          company_logo_url: org.logo_url || ''
        });
        const candidate = profile.organization_id;
        if (candidate) setCurrentUserOrgId(candidate);
      }

      // Load test equipment (simplified)
      try {
        const { data: te } = await supabase.from('test_equipment')
          .select('type, make, model, serial_number, cal_due')
          .eq('user_id', user.id).eq('is_active', true).order('type').limit(6);
        if (te && te.length) {
          setTestEquip(te.map((eq: any) => ({
            type: eq.type,
            model: [eq.make, eq.model].filter(Boolean).join(' '),
            serial: eq.serial_number || '',
            calDue: eq.cal_due || ''
          })));
        }
      } catch (e) {}
    })();
  }, [router, supabase]);

  // When model changes, reset dynamic state + init perf/params
  useEffect(() => {
    if (!modelKey) {
      setModel(null);
      return;
    }
    const m = MODELS[modelKey];
    setModel(m);

    // init perf
    const initPerf: Record<string, { actual: number | null }> = {};
    m.wavelengths.forEach((wl: WavelengthSpec, wi: number) => {
      wl.sets.forEach((s, si) => {
        initPerf[`pwr_${wi}_${si}`] = { actual: null };
      });
    });
    setPerfData(initPerf);

    // init params
    const initParams: Record<string, string> = {};
    m.params.forEach((p, i) => { initParams[`param_${i}`] = ''; });
    setParamsData(initParams);

    // reset checklists
    const resetCL = (arr: string[]) => Object.fromEntries(arr.map(l => [l, '']));
    setClElectrical(resetCL(CL_ELECTRICAL));
    setClMechanical(resetCL(CL_MECHANICAL));
    setClAesthetic(resetCL(CL_AESTHETIC));
  }, [modelKey]);

  function updatePerf(id: string, val: string) {
    const num = val === '' ? null : parseFloat(val);
    setPerfData(prev => ({ ...prev, [id]: { actual: isNaN(num as number) ? null : num } }));
  }

  function setCL(setter: React.Dispatch<React.SetStateAction<ChecklistState>>, label: string, val: 'Pass' | 'Fail' | '') {
    setter(prev => ({ ...prev, [label]: val }));
  }

  function updateParam(key: string, val: string) {
    setParamsData(prev => ({ ...prev, [key]: val }));
  }

  function updateTE(i: number, field: string, val: string) {
    setTestEquip(prev => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: val };
      return copy;
    });
  }

  // Collect like original collectData()
  function collectData() {
    if (!model) return {};

    const measurements: any[] = [];
    model.wavelengths.forEach((wl, wi) => {
      wl.sets.forEach((s, si) => {
        const id = `pwr_${wi}_${si}`;
        const actual = perfData[id]?.actual ?? null;
        const { pct, result } = computeDeviation(s, actual);
        measurements.push({
          wavelength: wl.name,
          mode: wl.mode,
          set: s,
          actual: actual,
          result: `${pct} ${result}`
        });
      });
    });

    const params: Record<string, any> = { ...paramsData };

    return {
      model_type: modelKey,
      equipment_name: equipName,
      serial_number: serialNum,
      customer_name: custName,
      customer_address: custAddress,
      customer_city: custCity,
      customer_state: custState,
      service_type: serviceType,
      date_out: dateOut,
      next_pm_due: nextPm || null,
      service_engineer: engineer,
      ticket_number: ticketNum || null,
      comments: comments || null,
      ground_resistance: groundRes ? parseFloat(groundRes) : null,
      leakage_current: leakageCur ? parseFloat(leakageCur) : null,
      checklist_electrical: clElectrical,
      checklist_mechanical: clMechanical,
      checklist_aesthetic: clAesthetic,
      power_measurements: measurements,
      model_parameters: params,
      test_equipment: testEquip,
      // snapshots
      tech_name: techCompanyCache.tech_name || null,
      tech_phone: techCompanyCache.tech_phone || null,
      tech_email: techCompanyCache.tech_email || null,
      tech_company_name: techCompanyCache.company_name || null,
      tech_company_address: techCompanyCache.company_address || null,
      tech_company_city: techCompanyCache.city || null,
      tech_company_state: techCompanyCache.state || null,
      tech_company_phone: techCompanyCache.phone || null,
      tech_company_logo_url: techCompanyCache.logo_url || null,
      organization_id: currentUserOrgId || null,
    };
  }

  async function saveReport(status: 'draft' | 'complete') {
    if (!currentUser || !model) {
      showToast('Sign in and select a model first');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        ...collectData(),
        status,
        updated_at: new Date().toISOString(),
      };

      let error;
      if (reportId) {
        ({ error } = await supabase.from('service_reports').update(payload).eq('id', reportId));
      } else {
        const { data: inserted, error: insErr } = await supabase.from('service_reports').insert(payload).select('id').maybeSingle();
        error = insErr;
        if (inserted) {
          // stay or redirect
        }
      }
      if (error) throw error;

      showToast(status === 'draft' ? 'Draft saved' : 'Report submitted');
      setTimeout(() => router.push('/reports'), 1200);
    } catch (e: any) {
      showToast('Save error: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  // === NEW: Search organizations as user types ===
  async function searchCustomers(query: string) {
    if (!query || query.length < 2) {
      setCustomerSearchResults([]);
      setShowCustomerDropdown(false);
      return;
    }

    setIsSearchingCustomers(true);
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, address, city, state')
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(8);

      if (!error && data) {
        setCustomerSearchResults(data);
        setShowCustomerDropdown(true);
      }
    } catch (e) {
      console.error('Customer search error:', e);
    } finally {
      setIsSearchingCustomers(false);
    }
  }

  // Simple signature: capture on demand
  function captureSig(which: 'tech' | 'cust') {
    const canvas = which === 'tech' ? techSigRef.current : custSigRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    if (which === 'tech') setTechSigData(data);
    else setCustSigData(data);
    showToast(`${which === 'tech' ? 'Tech' : 'Customer'} signature captured`);
  }

  function clearSig(which: 'tech' | 'cust') {
    const canvas = which === 'tech' ? techSigRef.current : custSigRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1a2233';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    if (which === 'tech') setTechSigData(''); else setCustSigData('');
  }

  // Basic canvas drawing support (mouse + touch)
  function attachCanvasHandlers(canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let drawing = false;

    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      if ('touches' in e) {
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    };

    const start = (e: MouseEvent | TouchEvent) => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const end = () => { drawing = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    // init bg
    ctx.fillStyle = '#1a2233';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    // attach after mount
    const t = setTimeout(() => {
      attachCanvasHandlers(techSigRef.current);
      attachCanvasHandlers(custSigRef.current);
    }, 80);
    return () => clearTimeout(t);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }

  // Build a printable report HTML
  function exportPrint() {
    const data = collectData() as any;
    const m = model;
    let html = `<!doctype html><html><head><meta charset="utf-8"><title>Service Report ${data.report_number || ''}</title>
      <style>body{font-family:Arial,sans-serif;margin:24px;color:#111;font-size:13px} h3{border-bottom:2px solid #FBBF24;padding-bottom:4px;margin:18px 0 8px;color:#111} table{width:100%;border-collapse:collapse;font-size:12px} th,td{padding:5px 7px;border:1px solid #ddd;text-align:left} .hdr{border-bottom:3px solid #FBBF24;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between}</style>
    </head><body>`;
    html += `<div class="hdr"><div><strong style="font-size:18px;color:#111">${data.tech_company_name || 'Total Service Pro'}</strong><div style="font-size:12px;color:#555">${[data.tech_company_address, data.tech_company_city, data.tech_company_state].filter(Boolean).join(', ')}</div></div>
      <div style="text-align:right"><h1 style="margin:0;font-size:22px">Service Report</h1><div style="color:#B45309;font-weight:700">${reportNum || '—'}</div><div style="font-size:12px">Date: ${dateOut}</div></div></div>`;

    html += `<div style="background:#f9f9f9;padding:12px;border-radius:6px;border:1px solid #eee;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><strong>Customer:</strong> ${data.customer_name || ''}<br>${[data.customer_address, data.customer_city, data.customer_state].filter(Boolean).join(', ')}</div>
      <div><strong>Equipment:</strong> ${data.equipment_name} <span style="color:#666">SN ${data.serial_number || ''}</span><br><strong>Engineer:</strong> ${data.service_engineer || ''} &nbsp; <strong>Next PM:</strong> ${data.next_pm_due || ''}</div>
    </div>`;

    const clToTable = (title: string, obj: any) => {
      const rows = Object.entries(obj || {}).map(([k, v]) => `<tr><td>${k}</td><td style="font-weight:700;color:${v==='Pass'?'#16a34a':v==='Fail'?'#dc2626':'#555'}">${v || '—'}</td></tr>`).join('');
      return rows ? `<h3>${title}</h3><table>${rows}</table>` : '';
    };
    html += clToTable('⚡ Electrical Checklist', clElectrical);
    html += clToTable('🔧 Mechanical & Optical', clMechanical);
    html += clToTable('🎨 Aesthetic Condition', clAesthetic);

    if (m && data.power_measurements?.length) {
      html += '<h3>📊 Performance Testing</h3>';
      m.wavelengths.forEach((wl: any, wi: number) => {
        html += `<p style="margin:6px 0 4px;font-weight:700">${wl.name} (${wl.unit})</p>`;
        html += '<table><tr style="background:#f5f5f5"><th>Set</th><th>Actual</th><th>Result</th></tr>';
        data.power_measurements.filter((pm: any) => pm.wavelength === wl.name).forEach((pm: any) => {
          html += `<tr><td>${pm.set}</td><td>${pm.actual ?? '—'}</td><td>${pm.result}</td></tr>`;
        });
        html += '</table>';
      });
    }

    if (Object.keys(paramsData).length) {
      html += '<h3>⚙️ System Parameters</h3><table>';
      Object.entries(paramsData).forEach(([k, v]) => {
        const label = model?.params[parseInt(k.split('_')[1])] || k;
        html += `<tr><td style="width:55%">${label}</td><td>${v || '—'}</td></tr>`;
      });
      html += '</table>';
    }

    if (groundRes || leakageCur) {
      html += '<h3>🔌 Electrical Safety</h3><table>';
      if (groundRes) html += `<tr><td>Ground Resistance</td><td>${groundRes} Ω</td><td>${parseFloat(groundRes) <= 0.2 ? 'PASS' : 'FAIL'}</td></tr>`;
      if (leakageCur) html += `<tr><td>Leakage Current</td><td>${leakageCur} µA</td><td>${parseFloat(leakageCur) <= 300 ? 'PASS' : 'FAIL'}</td></tr>`;
      html += '</table>';
    }

    html += `<div style="margin-top:32px;border-top:2px solid #FBBF24;padding-top:16px;font-size:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:20px"><div>Technician: <strong>${engineer}</strong></div><div>Date: ${dateOut}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">
        <div><div style="border-top:1px solid #999;padding-top:6px">Technician Signature</div>${techSigData ? `<img src="${techSigData}" style="max-height:70px;margin-top:6px">` : ''}</div>
        <div><div style="border-top:1px solid #999;padding-top:6px">Customer Signature &amp; Date</div>${custSigData ? `<img src="${custSigData}" style="max-height:70px;margin-top:6px">` : ''}</div>
      </div>
    </div>`;

    html += `<p style="margin-top:30px;font-size:11px;color:#666">Generated by Total Service Pro Web • ${new Date().toLocaleString()}</p></body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 450);
    } else {
      showToast('Popup blocked — use browser print on this page or allow popups.');
    }
  }

  const availableModels = mfg ? (MANUFACTURERS[mfg] || []) : [];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-[820px] mx-auto w-full px-4 py-5">
        <div className="flex items-center gap-3 mb-5">
          <Link href="/reports" className="text-[var(--gold)] flex items-center gap-1"><ArrowLeft size={18} /> Back to Reports</Link>
          <div className="font-bold text-xl flex-1">New Service Report</div>
          <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary text-sm">Save Draft</button>
          <button onClick={() => saveReport('complete')} disabled={saving || !modelKey} className="btn btn-primary text-sm flex items-center gap-2"><Check size={16} /> Submit Report</button>
        </div>

        {/* Customer / Equipment Header */}
        <div className="section mb-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* === UPDATED CUSTOMER NAME WITH AUTOCOMPLETE === */}
            <div className="relative">
              <label className="label">Customer Name</label>
              <input
                className="input"
                value={custName}
                onChange={(e) => {
                  setCustName(e.target.value);
                  searchCustomers(e.target.value);
                }}
                onFocus={() => {
                  if (custName.length >= 2) setShowCustomerDropdown(true);
                }}
                onBlur={() => {
                  setTimeout(() => setShowCustomerDropdown(false), 180);
                }}
                placeholder="Type to search existing customers..."
              />

              {/* Autocomplete Dropdown */}
              {showCustomerDropdown && customerSearchResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-[#1f2a44] border border-[#3a4a6a] rounded-md shadow-lg max-h-64 overflow-auto">
                  {customerSearchResults.map((org) => (
                    <div
                      key={org.id}
                      className="px-3 py-2.5 hover:bg-[#2a3a5a] cursor-pointer text-sm border-b border-[#3a4a6a] last:border-b-0"
                      onClick={() => {
                        setCustName(org.name);
                        setCustAddress(org.address || '');
                        setCustCity(org.city || '');
                        setCustState(org.state || '');
                        setShowCustomerDropdown(false);
                        setCustomerSearchResults([]);
                      }}
                    >
                      <div className="font-medium text-white">{org.name}</div>
                      {(org.city || org.state) && (
                        <div className="text-xs text-[var(--text3)] mt-0.5">
                          {[org.city, org.state].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isSearchingCustomers && (
                <div className="absolute right-3 top-[34px] text-xs text-[var(--text3)]">Searching...</div>
              )}
            </div>

            <div>
              <label className="label">Service Date</label>
              <input type="date" className="input" value={dateOut} onChange={e => setDateOut(e.target.value)} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={custAddress} onChange={e => setCustAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={custCity} onChange={e => setCustCity(e.target.value)} />
              </div>
              <div>
                <label className="label">State</label>
                <input className="input" value={custState} onChange={e => setCustState(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="section mb-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Equipment / Make-Model</label>
              <input className="input" value={equipName} onChange={e => setEquipName(e.target.value)} placeholder="e.g. Candela VBeam Perfecta" />
            </div>
            <div>
              <label className="label">Serial Number</label>
              <input className="input" value={serialNum} onChange={e => setSerialNum(e.target.value)} />
            </div>
            <div>
              <label className="label">Report # (optional)</label>
              <input className="input" value={reportNum} onChange={e => setReportNum(e.target.value)} />
            </div>
            <div>
              <label className="label">Ticket #</label>
              <input className="input" value={ticketNum} onChange={e => setTicketNum(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Model Selector */}
        <div className="section mb-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Manufacturer</label>
              <select className="select" value={mfg} onChange={e => { setMfg(e.target.value); setModelKey(''); }}>
                <option value="">— Select Manufacturer —</option>
                {Object.keys(MANUFACTURERS).sort().map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Model</label>
              <select className="select" value={modelKey} onChange={e => setModelKey(e.target.value)}>
                <option value="">— Select Model —</option>
                {availableModels.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Dynamic form content continues below... */}
        {/* (rest of the file remains the same as original) */}

        <div className="text-[10px] text-center text-[var(--text3)] mt-8">
          Data is saved to your organization in Supabase (same backend as the Android app).
        </div>
      </div>
    </div>
  );
}