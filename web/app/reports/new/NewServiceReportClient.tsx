'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { ArrowLeft, Check, Plus, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { MODELS } from '@/lib/models';

export default function NewServiceReport() {
  /* Full functional Service Report matching Android service_report.html (source of truth - do not change Android SR).
     - Direct orgs type='customer' + ensure (with contacts) + equipment ensure.
     - Exact CL_* arrays, model-driven perf (seeded + deviation), canvas sig pad, snapshots.
     - Draft / complete, print/PDF via browser, full payload.
     - Matches Android checklists, perf dev logic, sig capture, customer/equip flow.
  */

  const router = useRouter();
  const supabase = getSupabaseClient();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const [currentProfile, setCurrentProfile] = useState<any>(null);
  const [techCompanyCache, setTechCompanyCache] = useState<any>({});

  // Customer (direct orgs type=customer like Android)
  const [customerOptions, setCustomerOptions] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', address: '', city: '', state: '', phone: '', email: '', contactName: '' });
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  // Core report fields
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [serviceType, setServiceType] = useState('PM');
  const [dateOut, setDateOut] = useState('');
  const [nextPm, setNextPm] = useState('');
  const [ticketNum, setTicketNum] = useState('');
  const [comments, setComments] = useState('');

  // Equipment in report
  const [equipName, setEquipName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');

  // Checklists state: {item: 'Pass' | 'Fail' | 'N/A'}
  const [checkElectrical, setCheckElectrical] = useState<Record<string, string>>({});
  const [checkMechanical, setCheckMechanical] = useState<Record<string, string>>({});
  const [checkAesthetic, setCheckAesthetic] = useState<Record<string, string>>({});

  // Performance / params
  const [powerMeasurements, setPowerMeasurements] = useState<any[]>([]);
  const [modelParams, setModelParams] = useState<Record<string, any>>({});
  const [groundResistance, setGroundResistance] = useState<number | ''>('');
  const [leakageCurrent, setLeakageCurrent] = useState<number | ''>('');
  const [groundPass, setGroundPass] = useState<boolean | null>(null);
  const [leakagePass, setLeakagePass] = useState<boolean | null>(null);

  // Test equipment simple list
  const [testEquipment, setTestEquipment] = useState<any[]>([{ name: '', id: '' }]);

  // Signatures (snapshot like Android)
  const [techSig, setTechSig] = useState('');
  const [techSigDate, setTechSigDate] = useState('');

  // Canvas signature pad (full match to Android SR canvas behavior)
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [sigPadReady, setSigPadReady] = useState(false);

  function initSigCanvas() {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 320;
    canvas.height = 90;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    setSigPadReady(true);
  }

  function getSigPos(e: any) {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startDraw(e: any) {
    const canvas = sigCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    setIsDrawing(true);
    const pos = getSigPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: any) {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const pos = getSigPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw() {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = sigCanvasRef.current;
    if (canvas) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        setTechSig(dataUrl);
      } catch {}
    }
  }

  function clearSig() {
    const canvas = sigCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setTechSig('');
  }

  // init canvas on mount
  useEffect(() => {
    initSigCanvas();
  }, []);

  const [saving, setSaving] = useState(false);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const modelKeys = Object.keys(MODELS);
  const currentModel = selectedModelKey ? (MODELS as any)[selectedModelKey] : null;

  // Shared checklists EXACT from Android service_report.html (source of truth for parity). When updating here also note models.ts guidance for Android sync if MODELS change.
  const CL_ELECTRICAL = [
    'Power Cord & Plug integrity',
    'Foot Pedal & Strain Relief function',
    'Circuit Breaker function',
    'Key Switch test',
    'E-Stop Button operates properly',
    'Display functioning properly',
    'High/Low Supplies correct voltage',
    'Faults/Errors documented & cleared'
  ];
  const CL_MECHANICAL = [
    'Aiming Beam brightness',
    'Wheels & Castors integrity',
    'Optics inspected & cleaned',
    'Full Alignment Check',
    'Coolant flushed & topped off',
    'DI & Coolant Filters changed',
    'Interior dust & pollutant free',
    'Servos/Gears/Solenoids to spec'
  ];
  const CL_AESTHETIC = [
    'Condition of Skins',
    'Foot Pedal inspection',
    'Screen condition',
    'Control Panel condition',
    'Accessory Cables',
    'Accessories of the Unit'
  ];

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/login');
      setCurrentUser(user);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id, first_name, last_name, phone, email, job_title, signature_data, organizations(name, address, city, state, phone, logo_url)')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.organization_id) {
        setCurrentUserOrgId(profile.organization_id as any);
        setCurrentProfile(profile);
        setTechCompanyCache({
          tech_name: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
          tech_phone: profile.phone || '',
          tech_email: user.email || '',
          company_name: profile.organizations?.name || '',
          company_address: profile.organizations?.address || '',
          company_city: profile.organizations?.city || '',
          company_state: profile.organizations?.state || '',
          company_phone: profile.organizations?.phone || '',
          company_logo_url: profile.organizations?.logo_url || ''
        });
        await loadCustomers(profile.organization_id as any);
      }
      // default date
      if (!dateOut) setDateOut(new Date().toISOString().slice(0,10));
    })();
  }, [router, supabase]);

  async function loadCustomers(orgId: any) {
    // Prefer direct customer orgs (align to Android + CRM), also fall back to junction if used
    try {
      const { data: direct } = await supabase
        .from('organizations')
        .select('id, name, address, city, state, phone, email, contact_name')
        .eq('type', 'customer')
        .order('name');
      let opts = (direct || []) as any[];

      // Also pull from junction if any legacy
      try {
        const { data: junc } = await supabase
          .from('organization_customers')
          .select(`organizations:customer_organization_id (id, name, address, city, state, phone, email, contact_name)`)
          .eq('service_organization_id', orgId);
        if (junc) {
          const extra = junc.map((j: any) => j.organizations).filter(Boolean);
          const seen = new Set(opts.map(o => o.id));
          extra.forEach((e: any) => { if (e && !seen.has(e.id)) opts.push(e); });
        }
      } catch {}
      setCustomerOptions(opts);
    } catch (e) { console.warn(e); }
  }

  const filteredCustomers = customerOptions.filter((c: any) =>
    (c.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectCustomer = (customer: any) => {
    setSelectedCustomer(customer);
    setSearchTerm(customer.name || '');
    // prefill equip if known
  };

  const handleAddNewCustomer = async () => {
    if (!newCustomer.name.trim() || !currentUserOrgId) return;
    try {
      const { data: org, error } = await supabase.from('organizations').insert({
        name: newCustomer.name.trim(),
        address: newCustomer.address || null,
        city: newCustomer.city || null,
        state: newCustomer.state || null,
        phone: newCustomer.phone || null,
        email: newCustomer.email || null,
        contact_name: newCustomer.contactName || null,
        type: 'customer'
      }).select().single();
      if (error) throw error;

      // Also link via junction for compatibility
      await supabase.from('organization_customers').insert({
        service_organization_id: currentUserOrgId,
        customer_organization_id: org.id
      }).catch(() => {});

      await loadCustomers(currentUserOrgId);
      handleSelectCustomer(org);
      setShowAddModal(false);
      setNewCustomer({ name: '', address: '', city: '', state: '', phone: '', email: '', contactName: '' });
    } catch (e: any) {
      alert('Failed to create customer: ' + (e.message || e));
    }
  };

  function selectModel(key: string) {
    setSelectedModelKey(key);
    // reset dynamic
    setCheckElectrical({}); setCheckMechanical({}); setCheckAesthetic({});
    setPowerMeasurements([]); setModelParams({});
    const m = (MODELS as any)[key];
    if (m && m.params) {
      const p: any = {};
      m.params.forEach((param: string) => { p[param] = ''; });
      setModelParams(p);
    }
    // Seed perf rows from model wavelengths + first set (closer Android model-driven perf table parity)
    if (m && m.wavelengths?.length) {
      const seeded = m.wavelengths.map((w: any) => ({
        wavelength: w.name,
        setting: (w.sets && w.sets[0]) || '',
        measured: '',
        unit: w.unit || 'W',
        pass: true,
        deviation: ''
      }));
      setPowerMeasurements(seeded);
    }
  }

  function setChecklist(setter: any, item: string, val: string) {
    setter((prev: any) => ({ ...prev, [item]: val }));
  }

  function addPerfRow() {
    if (!currentModel) return;
    const firstWl = currentModel.wavelengths?.[0];
    setPowerMeasurements(prev => [...prev, {
      wavelength: firstWl?.name || '',
      setting: firstWl?.sets?.[0] || '',
      measured: '',
      unit: firstWl?.unit || 'W',
      pass: true,
      deviation: ''
    }]);
  }

  function updatePerf(idx: number, key: string, val: any) {
    setPowerMeasurements(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: val };
      // auto deviation calc if measured
      if (key === 'measured' || key === 'setting') {
        const row = copy[idx];
        const setVal = parseFloat(row.setting);
        const meas = parseFloat(row.measured);
        if (!isNaN(setVal) && !isNaN(meas) && setVal) {
          const dev = ((meas - setVal) / setVal * 100);
          row.deviation = dev.toFixed(1) + '%';
          row.pass = Math.abs(dev) <= 10; // typical Android tol
        }
      }
      return copy;
    });
  }

  function removePerf(idx: number) {
    setPowerMeasurements(prev => prev.filter((_,i) => i !== idx));
  }

  function addTestEquip() {
    setTestEquipment(prev => [...prev, { name: '', id: '' }]);
  }

  async function ensureCustomerOrg() {
    if (selectedCustomer?.id) return selectedCustomer.id;
    if (!searchTerm.trim()) return null;
    // create like Android ensureCustomerOrganization (with available contact fields)
    const { data: exist } = await supabase.from('organizations').select('id').eq('name', searchTerm.trim()).eq('type', 'customer').maybeSingle();
    if (exist) return exist.id;
    const { data: newC } = await supabase.from('organizations').insert({
      name: searchTerm.trim(),
      type: 'customer',
      address: null,
      city: null,
      state: null,
      phone: null,
      email: null,
      contact_name: null,
      created_by: currentUser?.id || null
    }).select('id').single();
    return newC?.id || null;
  }

  async function ensureEquipment(orgId: any) {
    if (!orgId || !equipName) return null;
    try {
      const { data: exist } = await supabase.from('equipment').select('id').eq('organization_id', orgId).eq('serial_number', serialNumber || '').maybeSingle();
      if (exist?.id) return exist.id;
      const { data: ins } = await supabase.from('equipment').insert({
        organization_id: orgId,
        name: equipName,
        model: selectedModelKey || equipName,
        serial_number: serialNumber || null,
        manufacturer: currentModel?.mfg || null
      }).select('id').single();
      return ins?.id;
    } catch (e) { return null; }
  }

  async function saveReport(status: 'draft' | 'complete') {
    if (!currentUser || !currentUserOrgId) { alert('No org or user'); return; }
    setSaving(true);
    try {
      // Force latest canvas capture for sig (Android parity)
      const canvas = sigCanvasRef.current;
      if (canvas && !techSig) {
        try { setTechSig(canvas.toDataURL('image/png')); } catch {}
      }
      const custId = await ensureCustomerOrg();
      const equipId = await ensureEquipment(custId || currentUserOrgId);

      // collect data mirroring Android
      const reportData: any = {
        organization_id: currentUserOrgId,
        created_by: currentUser.id,
        status,
        service_type: serviceType,
        model_type: selectedModelKey,
        equipment_name: equipName || currentModel?.label || null,
        serial_number: serialNumber || null,
        customer_name: selectedCustomer?.name || searchTerm || null,
        customer_address: selectedCustomer?.address || null,
        customer_city: selectedCustomer?.city || null,
        customer_state: selectedCustomer?.state || null,
        customer_phone: selectedCustomer?.phone || null,
        customer_email: selectedCustomer?.email || null,
        date_out: dateOut || null,
        next_pm_due: nextPm || null,
        ticket_number: ticketNum || null,
        comments: comments || null,
        ground_resistance: groundResistance === '' ? null : groundResistance,
        leakage_current: leakageCurrent === '' ? null : leakageCurrent,
        ground_resistance_pass: groundPass,
        leakage_current_pass: leakagePass,
        checklist_electrical: checkElectrical,
        checklist_mechanical: checkMechanical,
        checklist_aesthetic: checkAesthetic,
        power_measurements: powerMeasurements,
        model_parameters: modelParams,
        test_equipment: testEquipment.filter(t => t.name),
        tech_name: techCompanyCache.tech_name,
        tech_phone: techCompanyCache.tech_phone,
        tech_email: techCompanyCache.tech_email,
        tech_company_name: techCompanyCache.company_name,
        tech_company_address: techCompanyCache.company_address,
        tech_company_city: techCompanyCache.company_city,
        tech_company_state: techCompanyCache.company_state,
        tech_company_phone: techCompanyCache.company_phone,
        tech_company_logo_url: techCompanyCache.company_logo_url,
        // snapshot sig
        signature_data: techSig || currentProfile?.signature_data || null,
        signed_at: techSigDate || (status === 'complete' ? new Date().toISOString() : null)
      };

      let savedId = currentReportId;
      if (savedId) {
        await supabase.from('service_reports').update(reportData).eq('id', savedId);
      } else {
        const { data: ins, error } = await supabase.from('service_reports').insert(reportData).select('id').single();
        if (error) throw error;
        savedId = ins.id;
        setCurrentReportId(savedId);
      }

      if (status === 'complete') {
        setIsSubmitted(true);
        alert('Report submitted!');
      } else {
        alert('Draft saved.');
      }
      // optionally navigate
    } catch (e: any) {
      console.error(e);
      alert('Save error: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  function renderChecklist(items: string[], state: Record<string, string>, setter: any, title: string) {
    return (
      <div className="section mb-4">
        <div className="section-hdr"><h3>{title}</h3></div>
        <div className="section-body">
          {items.map(item => (
            <div key={item} className="checklist-item">
              <div className="checklist-label">{item}</div>
              <div className="checklist-btns">
                {['Pass','Fail','N/A'].map(v => (
                  <button key={v} onClick={() => setChecklist(setter, item, v)} className={`px-2 py-0.5 text-xs rounded border ${state[item]===v ? 'bg-[var(--gold)] text-black' : ''}`}>{v}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24">
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="text-[var(--gold)]"><ArrowLeft size={24} /></Link>
            <h1 className="text-3xl font-bold">New Service Report</h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary flex items-center gap-2"><Save size={16}/> Save Draft</button>
            <button onClick={() => saveReport('complete')} disabled={saving || isSubmitted} className="btn btn-primary flex items-center gap-2"><Check size={18} /> Submit Complete</button>
            <button onClick={() => window.print()} className="btn btn-ghost flex items-center gap-2 text-xs">Print / Save PDF</button>
          </div>
        </div>

        {/* Customer Info - full like Android */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">🏥 Customer Info</h3>
          <div className="relative mb-3">
            <input type="text" placeholder="Search customer or type to add new..." className="input w-full text-lg py-3" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
            {searchTerm && (
              <div className="absolute z-50 w-full bg-[var(--surface3)] border border-[var(--gold)] rounded mt-1 max-h-60 overflow-auto">
                {filteredCustomers.length ? filteredCustomers.map((c:any)=>(
                  <div key={c.id} className="p-2 hover:bg-[var(--surface)] cursor-pointer" onClick={()=>handleSelectCustomer(c)}>{c.name} {c.city && '('+c.city+')'}</div>
                )) : <div className="p-3 text-sm">No match — use "Add New"</div>}
              </div>
            )}
          </div>
          <button onClick={()=>setShowAddModal(true)} className="text-[var(--gold)] flex items-center gap-1 text-sm"><Plus size={14}/> Add New Customer</button>

          {selectedCustomer && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-[var(--text3)]">Customer:</span> {selectedCustomer.name}</div>
              <div>{[selectedCustomer.city, selectedCustomer.state].filter(Boolean).join(', ')}</div>
              <div>{selectedCustomer.contact_name || selectedCustomer.phone}</div>
            </div>
          )}
        </div>

        {/* Report Info */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">📋 Report Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">Service Type</label><select className="input" value={serviceType} onChange={e=>setServiceType(e.target.value)}><option>PM</option><option>Repair</option><option>Install</option><option>Cal</option></select></div>
            <div><label className="label">Date Out</label><input type="date" className="input" value={dateOut} onChange={e=>setDateOut(e.target.value)} /></div>
            <div><label className="label">Next PM Due</label><input type="date" className="input" value={nextPm} onChange={e=>setNextPm(e.target.value)} /></div>
            <div><label className="label">Ticket #</label><input className="input" value={ticketNum} onChange={e=>setTicketNum(e.target.value)} /></div>
            <div className="md:col-span-2"><label className="label">Equipment Name / Model</label><input className="input" placeholder="e.g. Candela VBeam" value={equipName} onChange={e=>setEquipName(e.target.value)} /></div>
            <div><label className="label">Serial Number</label><input className="input" value={serialNumber} onChange={e=>setSerialNumber(e.target.value)} /></div>
          </div>
        </div>

        {/* Model select + dynamic */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">⚙️ Equipment Model</h3>
          <select className="input mb-4" value={selectedModelKey} onChange={e => selectModel(e.target.value)}>
            <option value="">-- Select Model --</option>
            {modelKeys.map(k => <option key={k} value={k}>{k} — {(MODELS as any)[k].label}</option>)}
          </select>
          {currentModel && <div className="text-sm text-[var(--text3)]">Mfg: {currentModel.mfg}</div>}
        </div>

        {/* Checklists - full port from Android */}
        {selectedModelKey && (
          <>
            {renderChecklist(CL_ELECTRICAL, checkElectrical, setCheckElectrical, '⚡ Electrical Checklist')}
            {renderChecklist(CL_MECHANICAL, checkMechanical, setCheckMechanical, '🔧 Mechanical & Optical')}
            {renderChecklist(CL_AESTHETIC, checkAesthetic, setCheckAesthetic, '🎨 Aesthetic Condition')}
          </>
        )}

        {/* Performance Testing */}
        {currentModel && currentModel.wavelengths?.length > 0 && (
          <div className="section mb-6">
            <div className="section-hdr"><h3>📊 Performance Testing</h3></div>
            <div className="section-body">
              <button onClick={addPerfRow} className="btn btn-secondary text-sm mb-3">+ Add Measurement Row</button>
              {powerMeasurements.map((row, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 mb-2 items-center text-sm">
                  <select className="input" value={row.wavelength} onChange={e=>updatePerf(i,'wavelength',e.target.value)}>
                    {currentModel.wavelengths.map((w:any) => <option key={w.name} value={w.name}>{w.name}</option>)}
                  </select>
                  <input className="input" placeholder="Set" value={row.setting} onChange={e=>updatePerf(i,'setting',e.target.value)} />
                  <input className="input" placeholder="Measured" value={row.measured} onChange={e=>updatePerf(i,'measured',e.target.value)} />
                  <div className="text-xs">{row.deviation} {row.pass ? '✓' : '✗'}</div>
                  <button onClick={()=>removePerf(i)} className="text-red-400 text-xs">×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Params, Safety, etc. */}
        {currentModel && currentModel.params?.length > 0 && (
          <div className="section mb-6 p-6">
            <h3 className="font-semibold mb-2">🔬 System Parameters</h3>
            {currentModel.params.map((p: string) => (
              <div key={p} className="mb-2"><label className="text-xs">{p}</label><input className="input" value={modelParams[p]||''} onChange={e=>setModelParams({...modelParams, [p]: e.target.value})} /></div>
            ))}
          </div>
        )}

        <div className="section mb-6 p-6">
          <h3 className="font-semibold mb-2">🛡️ Electrical Safety</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label>Ground Resistance (Ω)</label><input type="number" className="input" value={groundResistance} onChange={e=>setGroundResistance(e.target.value===''?'':parseFloat(e.target.value))} /></div>
            <div><label>Leakage Current (mA)</label><input type="number" className="input" value={leakageCurrent} onChange={e=>setLeakageCurrent(e.target.value===''?'':parseFloat(e.target.value))} /></div>
            <div className="flex gap-2"><button onClick={()=>setGroundPass(true)} className={`px-3 py-1 rounded ${groundPass===true?'bg-green-600':''}`}>Ground PASS</button><button onClick={()=>setGroundPass(false)} className={`px-3 py-1 rounded ${groundPass===false?'bg-red-600':''}`}>FAIL</button></div>
            <div className="flex gap-2"><button onClick={()=>setLeakagePass(true)} className={`px-3 py-1 rounded ${leakagePass===true?'bg-green-600':''}`}>Leakage PASS</button><button onClick={()=>setLeakagePass(false)} className={`px-3 py-1 rounded ${leakagePass===false?'bg-red-600':''}`}>FAIL</button></div>
          </div>
        </div>

        <div className="section mb-6 p-6">
          <h3 className="font-semibold mb-2">🧰 Test Equipment</h3>
          {testEquipment.map((te, i) => (
            <div key={i} className="flex gap-2 mb-1"><input className="input" placeholder="Meter / Tool" value={te.name} onChange={e=>{const cp=[...testEquipment]; cp[i].name=e.target.value; setTestEquipment(cp);}} /></div>
          ))}
          <button onClick={addTestEquip} className="text-xs text-[var(--gold)]">+ Add</button>
        </div>

        <div className="section mb-6 p-6">
          <h3 className="font-semibold mb-2">💬 Comments / Parts Needed</h3>
          <textarea className="input w-full h-24" value={comments} onChange={e=>setComments(e.target.value)} placeholder="Observations, parts, follow-up..." />
        </div>

        {/* Signatures - Canvas pad matching Android SR exactly (touch/mouse + snapshot dataURL + fallback to profile) */}
        <div className="section mb-6 p-6">
          <h3 className="font-semibold mb-2">✍️ Signatures</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Technician Signature (draw below)</label>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: '#fff', padding: 4, touchAction: 'none' }}>
                <canvas
                  ref={sigCanvasRef}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                  style={{ width: '100%', maxWidth: 320, height: 90, display: 'block', background: '#fff', borderRadius: 4 }}
                />
              </div>
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={clearSig} className="text-xs px-2 py-0.5 border rounded">Clear</button>
                <button type="button" onClick={() => {
                  const c = sigCanvasRef.current;
                  if (c) { try { setTechSig(c.toDataURL('image/png')); } catch {} }
                }} className="text-xs px-2 py-0.5 border rounded">Capture</button>
                <span className="text-[10px] text-[var(--text3)] self-center">Draw with mouse or finger</span>
              </div>
            </div>
            <div>
              <label className="label">Date Signed</label>
              <input type="datetime-local" className="input" value={techSigDate} onChange={e=>setTechSigDate(e.target.value)} />
              <div className="text-[10px] text-[var(--text3)] mt-2">If blank on complete, profile signature_data will be used (Android parity).</div>
            </div>
          </div>
        </div>

        {isSubmitted && <div className="text-center text-green-400 mb-4">Submitted! You can re-edit from Reports list.</div>}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[var(--s1)] border-t border-[var(--gold)] p-4 flex gap-3 justify-center z-40">
        <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary">Save Draft</button>
        <button onClick={() => saveReport('complete')} disabled={saving} className="btn btn-primary">Submit Report</button>
      </div>

      {/* Add Customer Modal (unchanged) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#1a2233] p-8 rounded-3xl w-full max-w-lg mx-4">
            <h3 className="text-2xl font-bold mb-6">Add New Customer</h3>
            <div className="space-y-4">
              <input className="input" placeholder="Customer Name *" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              <input className="input" placeholder="Address" value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} />
              <div className="grid grid-cols-2 gap-4">
                <input className="input" placeholder="City" value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} />
                <input className="input" placeholder="State" value={newCustomer.state} onChange={(e) => setNewCustomer({ ...newCustomer, state: e.target.value })} />
              </div>
              <input className="input" placeholder="Contact Name" value={newCustomer.contactName} onChange={(e) => setNewCustomer({ ...newCustomer, contactName: e.target.value })} />
              <input className="input" placeholder="Phone" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              <input className="input" placeholder="Email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
            </div>
            <div className="flex gap-4 mt-8">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 rounded-2xl border">Cancel</button>
              <button onClick={handleAddNewCustomer} className="flex-1 py-4 rounded-2xl bg-[var(--gold)] text-black font-bold">Create Customer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
