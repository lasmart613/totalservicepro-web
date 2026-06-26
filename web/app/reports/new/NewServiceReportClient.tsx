'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { MODELS, buildManufacturers, CL_ELECTRICAL, CL_MECHANICAL, CL_AESTHETIC, DEFAULT_TEST_EQUIPMENT, computeDeviation, ModelDef } from '@/lib/models';
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

  // Add New Customer Modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');
  const [newCustomerCity, setNewCustomerCity] = useState('');
  const [newCustomerState, setNewCustomerState] = useState('');

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
    })();
  }, [router, supabase]);

  async function loadMyCustomers(orgId: number) {
    console.log('🔍 Loading customers for org:', orgId);

    const { data, error } = await supabase
      .from('organization_customers')
      .select(`
        customer_organization_id,
        organizations (
          id,
          name,
          address,
          city,
          state
        )
      `)
      .eq('service_organization_id', orgId)
      .order('organizations.name');

    if (error) {
      console.error('❌ Customer load error:', error);
    } else if (data) {
      console.log('✅ Loaded customers:', data.length);
      const customers = data.map((item: any) => ({
        id: item.customer_organization_id,
        name: item.organizations?.name || 'Unnamed Customer',
        address: item.organizations?.address || '',
        city: item.organizations?.city || '',
        state: item.organizations?.state || '',
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

  const handleAddNewCustomer = async () => {
    if (!newCustomerName.trim() || !currentUserOrgId) {
      alert("Please enter a customer name");
      return;
    }

    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name: newCustomerName.trim(),
        address: newCustomerAddress.trim(),
        city: newCustomerCity.trim(),
        state: newCustomerState.trim(),
        type: 'customer'
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("Failed to create customer: " + error.message);
    } else {
      await supabase
        .from('organization_customers')
        .insert({
          service_organization_id: currentUserOrgId,
          customer_organization_id: data.id,
          created_by: currentUser?.id,
          notes: 'Created via New Service Report'
        });

      loadMyCustomers(currentUserOrgId);

      setSelectedCustomerOrgId(data.id);
      setCustName(data.name);
      setCustAddress(data.address || '');
      setCustCity(data.city || '');
      setCustState(data.state || '');

      setShowAddCustomerModal(false);
      setNewCustomerName('');
      setNewCustomerAddress('');
      setNewCustomerCity('');
      setNewCustomerState('');

      alert("New customer added and selected successfully!");
    }
  };

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

  // ... (keep your existing collectData, saveReport, etc. functions)

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

        {/* Customer Dropdown + Add New */}
        <div className="section mb-4 p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="label">Customer Name</label>
            <button 
              type="button"
              onClick={() => setShowAddCustomerModal(true)}
              className="text-xs text-[var(--gold)] hover:underline flex items-center gap-1"
            >
              + Add New Customer
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

        {/* Rest of your form goes here (manufacturer, model, checklists, etc.) */}
        {/* ... keep everything else unchanged ... */}

      </div>

      {/* Add New Customer Modal */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#1a2233] p-8 rounded-3xl w-full max-w-md mx-4">
            <h3 className="text-2xl font-bold mb-6">Add New Customer</h3>
            
            <div className="space-y-4">
              <div>
                <label className="label">Customer Name *</label>
                <input 
                  className="input" 
                  value={newCustomerName} 
                  onChange={e => setNewCustomerName(e.target.value)} 
                  placeholder="e.g. Riverside Medical Center"
                />
              </div>
              <div>
                <label className="label">Address</label>
                <input className="input" value={newCustomerAddress} onChange={e => setNewCustomerAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">City</label>
                  <input className="input" value={newCustomerCity} onChange={e => setNewCustomerCity(e.target.value)} />
                </div>
                <div>
                  <label className="label">State</label>
                  <input className="input" value={newCustomerState} onChange={e => setNewCustomerState(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button 
                type="button"
                onClick={() => setShowAddCustomerModal(false)}
                className="flex-1 py-4 rounded-2xl border border-gray-600 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleAddNewCustomer}
                className="flex-1 py-4 rounded-2xl bg-[var(--gold)] text-black font-semibold hover:bg-yellow-400"
              >
                Create Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}