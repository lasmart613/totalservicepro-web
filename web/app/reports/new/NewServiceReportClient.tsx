'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { MODELS, buildManufacturers, CL_ELECTRICAL, CL_MECHANICAL, CL_AESTHETIC, DEFAULT_TEST_EQUIPMENT, computeDeviation, ModelDef, WavelengthSpec } from '@/lib/models';
import { ArrowLeft, Save, Check, Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

const MANUFACTURERS = buildManufacturers();

type ChecklistState = Record<string, 'Pass' | 'Fail' | ''>;

export default function NewServiceReport() {
  const router = useRouter();
  const search = useSearchParams();
  const reportId = search.get('id');
  const supabase = getSupabaseClient();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
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

  // Customer & Equipment
  const [customerOptions, setCustomerOptions] = useState<any[]>([]);
  const [selectedCustomerOrgId, setSelectedCustomerOrgId] = useState<number | null>(null);
  const [equipmentOptions, setEquipmentOptions] = useState<any[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | null>(null);

  // Load user + customers
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
        if (profile.organization_id) {
          setCurrentUserOrgId(profile.organization_id);
          loadMyCustomers(profile.organization_id);
        }
      }

      // Test equipment
      try {
        const { data: te } = await supabase.from('test_equipment')
          .select('type, make, model, serial_number, cal_due')
          .eq('user_id', user.id).eq('is_active', true).order('type').limit(6);
        if (te?.length) {
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

  async function loadMyCustomers(orgId: number) {
    const { data } = await supabase
      .from('organization_customers')
      .select(`
        customer_organization_id,
        organizations!inner(id, name, address, city, state)
      `)
      .eq('service_organization_id', orgId)
      .order('organizations.name');

    if (data) {
      const customers = data.map((item: any) => ({
        id: item.customer_organization_id,
        name: item.organizations.name,
        address: item.organizations.address,
        city: item.organizations.city,
        state: item.organizations.state,
      }));
      setCustomerOptions(customers);
    }
  }

  async function loadEquipmentForCustomer(orgId: number) {
    if (!orgId) return;
    const { data } = await supabase
      .from('equipment')
      .select('id, manufacturer, model, serial_number')
      .eq('customer_organization_id', orgId)
      .order('manufacturer, model');
    setEquipmentOptions(data || []);
  }

  // Model change handler
  useEffect(() => {
    if (!modelKey) return;
    const m = MODELS[modelKey];
    setModel(m);

    const initPerf: Record<string, { actual: number | null }> = {};
    m.wavelengths.forEach((wl, wi) => {
      wl.sets.forEach((_, si) => {
        initPerf[`pwr_${wi}_${si}`] = { actual: null };
      });
    });
    setPerfData(initPerf);

    const initParams: Record<string, string> = {};
    m.params.forEach((_, i) => { initParams[`param_${i}`] = ''; });
    setParamsData(initParams);

    const resetCL = (arr: string[]) => Object.fromEntries(arr.map(l => [l, '']));
    setClElectrical(resetCL(CL_ELECTRICAL));
    setClMechanical(resetCL(CL_MECHANICAL));
    setClAesthetic(resetCL(CL_AESTHETIC));
  }, [modelKey]);

  function collectData() {
    if (!model) return {};
    // ... (same as before)
    const measurements: any[] = [];
    // ... build measurements (keep your existing logic here)

    return {
      model_type: modelKey,
      equipment_id: selectedEquipmentId,
      equipment_name: equipName,
      serial_number: serialNum,
      customer_name: custName,
      customer_address: custAddress,
      customer_city: custCity,
      customer_state: custState,
      customer_organization_id: selectedCustomerOrgId,
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
      organization_id: currentUserOrgId,
      ...techCompanyCache
    };
  }

  async function saveReport(status: 'draft' | 'complete', isFinalized = false) {
    // ... keep your existing save logic
  }

  const handleFinalize = () => {
    // exportPrint(); // uncomment when ready
    saveReport('complete', true);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-[820px] mx-auto w-full px-4 py-5">
        <div className="flex items-center gap-3 mb-5">
          <Link href="/reports" className="text-[var(--gold)] flex items-center gap-1">
            <ArrowLeft size={18} /> Back
          </Link>
          <div className="font-bold text-xl flex-1">New Service Report</div>
          <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary text-sm">Save Draft</button>
          <button onClick={() => saveReport('complete')} disabled={saving || !modelKey} className="btn btn-primary text-sm flex items-center gap-2">
            <Check size={16} /> Submit
          </button>
          <button onClick={handleFinalize} disabled={saving || !modelKey || !selectedCustomerOrgId} className="btn bg-green-600 hover:bg-green-700 text-sm flex items-center gap-2">
            <Download size={16} /> Finalize & PDF
          </button>
        </div>

        {/* === CUSTOMER DROPDOWN === */}
        <div className="section mb-4 p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="label">Customer Name</label>
            <button 
              type="button"
              onClick={() => alert('Add New Customer form coming next')}
              className="text-xs text-[var(--gold)] hover:underline flex items-center gap-1"
            >
              + Add New
            </button>
          </div>

          <select 
            className="select w-full"
            value={selectedCustomerOrgId || ''}
            onChange={(e) => {
              const orgId = e.target.value ? parseInt(e.target.value) : null;
              setSelectedCustomerOrgId(orgId);
              const selected = customerOptions.find((o: any) => o.id === orgId);
              if (selected) {
                setCustName(selected.name);
                setCustAddress(selected.address || '');
                setCustCity(selected.city || '');
                setCustState(selected.state || '');
                loadEquipmentForCustomer(orgId!);
              }
            }}
          >
            <option value="">— Select Customer —</option>
            {customerOptions.map((org: any) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div>
              <label className="label">Address</label>
              <input className="input" value={custAddress} onChange={e => setCustAddress(e.target.value)} />
            </div>
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

        {/* Equipment Selector */}
        <div className="section mb-4 p-4">
          <label className="label">Equipment / Laser</label>
          <select 
            className="select w-full"
            value={selectedEquipmentId || ''}
            onChange={(e) => {
              const eqId = e.target.value ? parseInt(e.target.value) : null;
              setSelectedEquipmentId(eqId);
              const eq = equipmentOptions.find(item => item.id === eqId);
              if (eq) {
                setEquipName(`${eq.manufacturer} ${eq.model}`);
                setSerialNum(eq.serial_number || '');
              }
            }}
          >
            <option value="">— Select Laser —</option>
            {equipmentOptions.map(eq => (
              <option key={eq.id} value={eq.id}>
                {eq.manufacturer} {eq.model} — SN: {eq.serial_number}
              </option>
            ))}
          </select>
        </div>

        {/* Model Selector and rest of form... */}
        {/* (Keep the rest of your existing form code for manufacturer/model, checklists, etc.) */}

        <div className="text-[10px] text-center text-[var(--text3)] mt-8">
          Data saved to Supabase
        </div>
      </div>
    </div>
  );
}