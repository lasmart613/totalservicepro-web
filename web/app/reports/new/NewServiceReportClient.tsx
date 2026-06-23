'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { MODELS, buildManufacturers, CL_ELECTRICAL, CL_MECHANICAL, CL_AESTHETIC, DEFAULT_TEST_EQUIPMENT, computeDeviation, ModelDef, WavelengthSpec } from '@/lib/models';
import { ArrowLeft, FileText, Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const MANUFACTURERS = buildManufacturers();

type ChecklistState = Record<string, 'Pass' | 'Fail' | ''>;

export default function NewServiceReport() {
  const router = useRouter();
  const search = useSearchParams();
  const reportId = search.get('id');
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

  // Customer autocomplete state
  const [customerOrgId, setCustomerOrgId] = useState<number | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Dynamic sections
  const [serviceType, setServiceType] = useState('PM');
  const [perfData, setPerfData] = useState<Record<string, { actual: number | null }>>({});
  const [paramsData, setParamsData] = useState<Record<string, string>>({});
  const [clElectrical, setClElectrical] = useState<ChecklistState>({});
  const [clMechanical, setClMechanical] = useState<ChecklistState>({});
  const [clAesthetic, setClAesthetic] = useState<ChecklistState>({});
  const [groundRes, setGroundRes] = useState<string>('');
  const [leakageCur, setLeakageCur] = useState<string>('');

  const [testEquip, setTestEquip] = useState<any[]>(DEFAULT_TEST_EQUIPMENT);

  // Signatures
  const techSigRef = useRef<HTMLCanvasElement>(null);
  const custSigRef = useRef<HTMLCanvasElement>(null);
  const [techSigData, setTechSigData] = useState<string>('');
  const [custSigData, setCustSigData] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Load user + profile
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

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
        if (profile.organization_id) setCurrentUserOrgId(profile.organization_id);
      }

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

  // Model change handler
  useEffect(() => {
    if (!modelKey) {
      setModel(null);
      return;
    }
    const m = MODELS[modelKey];
    setModel(m);

    const initPerf: Record<string, { actual: number | null }> = {};
    m.wavelengths.forEach((wl: WavelengthSpec, wi: number) => {
      wl.sets.forEach((s, si) => {
        initPerf[`pwr_${wi}_${si}`] = { actual: null };
      });
    });
    setPerfData(initPerf);

    const initParams: Record<string, string> = {};
    m.params.forEach((p, i) => { initParams[`param_${i}`] = ''; });
    setParamsData(initParams);

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
      model_parameters: paramsData,
      test_equipment: testEquip,
      tech_name: techCompanyCache.tech_name || null,
      tech_phone: techCompanyCache.tech_phone || null,
      tech_email: techCompanyCache.tech_email || null,
      tech_company_name: techCompanyCache.company_name || null,
      tech_company_address: techCompanyCache.company_address || null,
      tech_company_city: techCompanyCache.company_city || null,
      tech_company_state: techCompanyCache.company_state || null,
      tech_company_phone: techCompanyCache.company_phone || null,
      tech_company_logo_url: techCompanyCache.company_logo_url || null,
      organization_id: currentUserOrgId || null,
      customer_organization_id: customerOrgId,
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
        const { error: insErr } = await supabase.from('service_reports').insert(payload);
        error = insErr;
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
      if ('touches' in e) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
    };

    const start = (e: MouseEvent | TouchEvent) => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: MouseEvent | TouchEvent) => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const end = () => { drawing = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    ctx.fillStyle = '#1a2233';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
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

  function exportPrint() {
    const data = collectData() as any;
    const m = model;
    let html = `<!doctype html><html><head><meta charset="utf-8"><title>Service Report</title></head><body>`;
    html += `<h1>Service Report</h1><p>Customer: ${data.customer_name}</p>`;
    html += `<p>Equipment: ${data.equipment_name} (SN: ${data.serial_number})</p>`;
    html += `<p>Generated by Total Service Pro</p></body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 300);
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

        {/* Customer Section with Autocomplete */}
        <div className="section mb-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <label className="label">Customer Name</label>
              <input
                className="input"
                value={custName}
                onChange={e => {
                  setCustName(e.target.value);
                  setCustomerOrgId(null);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="Type to search your laser clinics..."
              />
              {showCustomerDropdown && custName.length > 1 && (
                <CustomerAutocompleteDropdown
                  searchTerm={custName}
                  currentUserOrgId={currentUserOrgId}
                  onSelect={(org: any) => {
                    setCustName(org.name || '');
                    setCustAddress(org.address || '');
                    setCustCity(org.city || '');
                    setCustState(org.state || '');
                    setCustomerOrgId(org.id);
                    setShowCustomerDropdown(false);
                  }}
                  onCreateNew={() => {
                    setShowCustomerDropdown(false);
                    alert('Create new customer coming soon');
                  }}
                />
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

        {/* Equipment Section */}
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
              <select className="select" value={modelKey} onChange={e => setModelKey(e.target.value)} disabled={!mfg}>
                <option value="">— Select Model —</option>
                {availableModels.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
          </div>
          {model && <div className="text-xs mt-2 text-[var(--text3)]">Model: <span className="text-[var(--gold)]">{model.label}</span> • {model.mfg}</div>}
        </div>

        {modelKey && model && (
          <>
            {/* Service Type */}
            <div className="mb-4 flex gap-2">
              {['PM', 'Repair', 'Install', 'Other'].map(t => (
                <button key={t} onClick={() => setServiceType(t)} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${serviceType === t ? 'bg-[var(--gold)] text-[#111827]' : 'bg-[var(--surface3)] border border-[var(--border2)]'}`}>{t}</button>
              ))}
            </div>

            {/* Performance Testing */}
            {model.wavelengths.length > 0 && (
              <div className="section mb-4 p-4">
                <div className="font-bold text-[var(--gold)] mb-3">📊 Performance Testing — {model.label}</div>
                {model.wavelengths.map((wl, wi) => (
                  <div key={wi} className="mb-4">
                    <div className="text-sm font-semibold mb-2">{wl.name} — {wl.unit}</div>
                    <table className="perf-table w-full">
                      <thead><tr><th>Set</th><th>Actual</th><th>Result</th></tr></thead>
                      <tbody>
                        {wl.sets.map((s, si) => {
                          const id = `pwr_${wi}_${si}`;
                          const actual = perfData[id]?.actual;
                          const { pct, result, pass } = computeDeviation(s, actual);
                          return (
                            <tr key={si}>
                              <td>{s} {wl.unit}</td>
                              <td><input type="number" step="0.01" className="input !py-1 !px-2 w-28" value={actual ?? ''} onChange={e => updatePerf(id, e.target.value)} /></td>
                              <td style={{ color: actual != null ? (pass ? 'var(--green)' : 'var(--red)') : undefined }}>{pct} {result}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {/* System Parameters */}
            {model.params.length > 0 && (
              <div className="section mb-4 p-4">
                <div className="font-bold text-[var(--gold)] mb-3">⚙️ System Parameters</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                  {model.params.map((p, i) => (
                    <div key={i}>
                      <label className="label text-xs">{p}</label>
                      <input className="input" value={paramsData[`param_${i}`] || ''} onChange={e => updateParam(`param_${i}`, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Checklists */}
            <div className="grid md:grid-cols-3 gap-4 mb-4">
              {[{ title: '⚡ Electrical', items: CL_ELECTRICAL, state: clElectrical, setter: setClElectrical },
                { title: '🔧 Mechanical', items: CL_MECHANICAL, state: clMechanical, setter: setClMechanical },
                { title: '🎨 Aesthetic', items: CL_AESTHETIC, state: clAesthetic, setter: setClAesthetic }].map((sec, idx) => (
                <div className="section p-3" key={idx}>
                  <div className="font-semibold text-sm mb-2">{sec.title}</div>
                  {sec.items.map((item: string) => (
                    <div key={item} className="checklist-item text-sm">
                      <span className="flex-1">{item}</span>
                      {(['Pass', 'Fail', ''] as const).map(v => (
                        <button key={v} onClick={() => setCL(sec.setter, item, v)} className={`cl-btn text-xs ${sec.state[item] === v ? 'active' : ''}`}>{v || '—'}</button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Electrical Safety */}
            <div className="section mb-4 p-4">
              <div className="font-bold text-[var(--gold)] mb-3">🔌 Electrical Safety Tests</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Ground Resistance (Ω)</label>
                  <input type="number" step="0.001" className="input" value={groundRes} onChange={e => setGroundRes(e.target.value)} placeholder="0.085" />
                </div>
                <div>
                  <label className="label">Leakage Current (µA)</label>
                  <input type="number" className="input" value={leakageCur} onChange={e => setLeakageCur(e.target.value)} placeholder="145" />
                </div>
              </div>
            </div>

            {/* Test Equipment - FIXED */}
            <div className="section mb-4 p-4">
              <div className="font-bold text-[var(--gold)] mb-2 flex justify-between items-center">
                <span>🔧 Test Equipment Used</span>
                <span className="text-xs text-[var(--text3)] cursor-pointer" onClick={() => router.push('/test-equipment')}>Manage in profile →</span>
              </div>
              {testEquip.map((te, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
                  <div className="font-medium text-[var(--text2)]">{te.type}</div>
                  <input className="input !py-1" placeholder="Model" value={te.model || ''} onChange={e => updateTE(i, 'model', e.target.value)} />
                  <input className="input !py-1" placeholder="Serial" value={te.serial || ''} onChange={e => updateTE(i, 'serial', e.target.value)} />
                  <input className="input !py-1" type="date" value={te.calDue || ''} onChange={e => updateTE(i, 'calDue', e.target.value)} />
                </div>
              ))}
            </div>

            {/* Comments */}
            <div className="section mb-4 p-4">
              <label className="label">Comments / Notes</label>
              <textarea className="input min-h-[90px]" value={comments} onChange={e => setComments(e.target.value)} />
            </div>

            {/* Signatures */}
            <div className="section mb-4 p-4">
              <div className="font-bold text-[var(--gold)] mb-3">Signatures</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <div className="text-xs font-semibold mb-1.5 text-[var(--text2)]">Technician Signature</div>
                  <canvas ref={techSigRef} width={280} height={92} className="signature-pad w-full" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => captureSig('tech')} className="btn btn-secondary text-xs px-3 py-1">Capture</button>
                    <button onClick={() => clearSig('tech')} className="btn btn-ghost text-xs px-3 py-1">Clear</button>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold mb-1.5 text-[var(--text2)]">Customer Signature + Date</div>
                  <canvas ref={custSigRef} width={280} height={92} className="signature-pad w-full" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => captureSig('cust')} className="btn btn-secondary text-xs px-3 py-1">Capture</button>
                    <button onClick={() => clearSig('cust')} className="btn btn-ghost text-xs px-3 py-1">Clear</button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-3 mt-6">
          <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary flex-1">Save as Draft</button>
          <button onClick={() => saveReport('complete')} disabled={saving || !modelKey} className="btn btn-primary flex-1">Submit Complete Report</button>
          <button onClick={exportPrint} disabled={!modelKey} className="btn btn-secondary flex items-center gap-2"><FileText size={16} /> Print / PDF Preview</button>
        </div>

        <div className="text-[10px] text-center text-[var(--text3)] mt-8">Data saved to your organization in Supabase.</div>
      </div>

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x/2 bg-[var(--surface3)] border border-[var(--gold)] text-sm px-5 py-2 rounded-full shadow-xl">{toast}</div>}
    </div>
  );
}

// ============================================
// Customer Autocomplete Component
// ============================================
function CustomerAutocompleteDropdown({ 
  searchTerm, 
  currentUserOrgId, 
  onSelect, 
  onCreateNew 
}: { 
  searchTerm: string; 
  currentUserOrgId: any; 
  onSelect: (org: any) => void; 
  onCreateNew: () => void;
}) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    if (!searchTerm || searchTerm.length < 2 || !currentUserOrgId) {
      setResults([]);
      return;
    }

    const searchCustomers = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('organization_customers')
          .select(`
            customer_organization_id,
            organizations:customer_organization_id (
              id, name, address, city, state, phone, email
            )
          `)
          .eq('service_organization_id', currentUserOrgId)
          .ilike('organizations.name', `%${searchTerm}%`)
          .limit(15);

        if (error) throw error;

        const formatted = (data || []).map((row: any) => row.organizations).filter(Boolean);
        setResults(formatted);
      } catch (e) {
        console.error('Customer search error:', e);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchCustomers, 250);
    return () => clearTimeout(debounce);
  }, [searchTerm, currentUserOrgId, supabase]);

  return (
    <div className="absolute z-50 mt-1 w-full bg-[var(--surface2)] border border-[var(--border2)] rounded-xl shadow-xl overflow-hidden max-h-[320px] overflow-y-auto">
      {loading && <div className="px-4 py-3 text-sm text-[var(--text3)]">Searching...</div>}

      {!loading && results.length === 0 && (
        <div className="px-4 py-3 text-sm text-[var(--text3)]">No matching laser clinics found.</div>
      )}

      {results.map((org) => (
        <div key={org.id} onClick={() => onSelect(org)} className="px-4 py-3 hover:bg-[var(--surface3)] cursor-pointer border-b border-[var(--border2)] last:border-b-0">
          <div className="font-semibold">{org.name}</div>
          {(org.city || org.state) && <div className="text-xs text-[var(--text3)]">{[org.city, org.state].filter(Boolean).join(', ')}</div>}
        </div>
      ))}

      <div onClick={onCreateNew} className="px-4 py-3 text-[var(--gold)] hover:bg-[var(--surface3)] cursor-pointer flex items-center gap-2 text-sm font-medium border-t border-[var(--border2)]">
        + Create new laser clinic customer
      </div>
    </div>
  );
}