'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { MODELS, buildManufacturers, CL_ELECTRICAL, CL_MECHANICAL, CL_AESTHETIC, DEFAULT_TEST_EQUIPMENT, computeDeviation, ModelDef, WavelengthSpec } from '@/lib/models';
import { ArrowLeft, Save, FileText, Check, Download } from 'lucide-react';
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

  // Dynamic fields
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

  // Customer + Equipment
  const [customerSearchResults, setCustomerSearchResults] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [selectedCustomerOrgId, setSelectedCustomerOrgId] = useState<number | null>(null);
  const [equipmentOptions, setEquipmentOptions] = useState<any[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | null>(null);

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

      // Load test equipment
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

  // Model change handler (unchanged)
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

  // Customer search using organization_customers
  async function searchCustomers(query: string) {
    if (!query || query.length < 2 || !currentUserOrgId) {
      setCustomerSearchResults([]);
      setShowCustomerDropdown(false);
      return;
    }

    setIsSearchingCustomers(true);
    try {
      const { data, error } = await supabase
        .from('organization_customers')
        .select(`
          customer_organization_id,
          organizations!inner(id, name, address, city, state)
        `)
        .eq('service_organization_id', currentUserOrgId)
        .ilike('organizations.name', `%${query}%`)
        .order('organizations.name')
        .limit(8);

      if (!error && data) {
        const results = data.map((item: any) => ({
          id: item.customer_organization_id,
          name: item.organizations.name,
          address: item.organizations.address,
          city: item.organizations.city,
          state: item.organizations.state,
        }));
        setCustomerSearchResults(results);
        setShowCustomerDropdown(true);
      }
    } catch (e) {
      console.error('Customer search error:', e);
    } finally {
      setIsSearchingCustomers(false);
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

  // Collect data
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
          actual,
          result: `${pct} ${result}`
        });
      });
    });

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
      // tech company info
      ...techCompanyCache
    };
  }

  async function saveReport(status: 'draft' | 'complete', isFinalized = false) {
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

      if (isFinalized) {
        payload.finalized_at = new Date().toISOString();
        payload.finalized_by = currentUser.id;
        // TODO: Upload PDF to storage and set pdf_url
      }

      let error;
      if (reportId) {
        ({ error } = await supabase.from('service_reports').update(payload).eq('id', reportId));
      } else {
        const { error: insErr } = await supabase.from('service_reports').insert(payload);
        error = insErr;
      }
      if (error) throw error;

      showToast(isFinalized ? 'Report finalized & PDF ready' : status === 'draft' ? 'Draft saved' : 'Report submitted');
      setTimeout(() => router.push('/reports'), 1500);
    } catch (e: any) {
      showToast('Save error: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  // ... (keep your existing signature, canvas, exportPrint, and other helper functions unchanged)

  // For now, Finalize calls exportPrint + save as finalized
  const handleFinalize = () => {
    exportPrint(); // existing print logic
    saveReport('complete', true);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-[820px] mx-auto w-full px-4 py-5">
        <div className="flex items-center gap-3 mb-5">
          <Link href="/reports" className="text-[var(--gold)] flex items-center gap-1">
            <ArrowLeft size={18} /> Back to Reports
          </Link>
          <div className="font-bold text-xl flex-1">New Service Report</div>
          <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary text-sm">
            Save Draft
          </button>
          <button onClick={() => saveReport('complete')} disabled={saving || !modelKey} className="btn btn-primary text-sm flex items-center gap-2">
            <Check size={16} /> Submit
          </button>
          <button onClick={handleFinalize} disabled={saving || !modelKey || !selectedCustomerOrgId} className="btn bg-green-600 hover:bg-green-700 text-sm flex items-center gap-2">
            <Download size={16} /> Finalize & PDF
          </button>
        </div>

        {/* Customer Section with improved autocomplete */}
        <div className="section mb-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <label className="label">Customer Name</label>
              <input
                className="input"
                value={custName}
                onChange={(e) => {
                  setCustName(e.target.value);
                  searchCustomers(e.target.value);
                }}
                onFocus={() => custName.length >= 2 && setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                placeholder="Type to search your customers..."
              />

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
                        setSelectedCustomerOrgId(org.id);
                        setShowCustomerDropdown(false);
                        loadEquipmentForCustomer(org.id);
                      }}
                    >
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-[var(--text3)]">
                        {[org.city, org.state].filter(Boolean).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Service Date */}
            <div>
              <label className="label">Service Date</label>
              <input type="date" className="input" value={dateOut} onChange={e => setDateOut(e.target.value)} />
            </div>

            {/* Address fields */}
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

        {/* Equipment Selector */}
        <div className="section mb-4 p-4">
          <label className="label">Equipment / Laser</label>
          <select 
            className="select"
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
            <option value="">— Select Laser (recommended) —</option>
            {equipmentOptions.map(eq => (
              <option key={eq.id} value={eq.id}>
                {eq.manufacturer} {eq.model} — SN: {eq.serial_number}
              </option>
            ))}
          </select>
        </div>

        {/* Rest of your form (Model selector, checklists, etc.) remains the same */}
        {/* ... (keep all the model selection, performance testing, signatures, etc.) */}

        <div className="text-[10px] text-center text-[var(--text3)] mt-8">
          Data is saved to your organization in Supabase.
        </div>
      </div>
    </div>
  );
}