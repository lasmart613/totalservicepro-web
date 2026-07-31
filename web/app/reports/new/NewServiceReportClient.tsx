'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { ArrowLeft, Check, Plus, Save } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { MODELS } from '@/lib/models';
import { generateDocNumber } from '@/lib/billing/doc-numbers';
import { ensureEquipment } from '@/lib/equipment-ensure';
import { isAdmin, normalizeRole } from '@/lib/roles';

/** Admin / manager roles may edit Service Engineer (Android parity). */
function canEditServiceEngineer(profile: any): boolean {
  const role = normalizeRole(profile?.role);
  let extras: any = profile?.additional_roles;
  if (typeof extras === 'string') {
    try {
      extras = JSON.parse(extras);
    } catch {
      extras = [];
    }
  }
  if (!Array.isArray(extras)) extras = [];
  const all = [role, ...extras.map((r: any) => normalizeRole(r))];
  return all.some(
    (r) =>
      isAdmin(r) ||
      r === 'owner' ||
      r === 'service_manager' ||
      r === 'billing_manager' ||
      r === 'manager' ||
      (r && (r.includes('admin') || r.includes('owner') || r.includes('manager')))
  );
}

export default function NewServiceReport() {
  /* Full functional Service Report matching Android service_report.html (source of truth - do not change Android SR).
     - Direct orgs type='customer' + ensure (with contacts) + equipment ensure.
     - Exact CL_* arrays, model-driven perf (seeded + deviation), canvas sig pad, snapshots.
     - Draft / complete, print/PDF via browser, full payload.
     - Matches Android checklists, perf dev logic, sig capture, customer/equip flow.
     - Service Engineer field + role lock (Sprint A parity).
  */

  const router = useRouter();
  const searchParams = useSearchParams();
  const editReportId = searchParams?.get('id') || null;
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
  /** Universal: {ORG_PREFIX}-SR-YYYYMMDD-NN */
  const [reportNumber, setReportNumber] = useState('');
  /** Service Engineer / FSE — Android #engineer parity */
  const [serviceEngineer, setServiceEngineer] = useState('');
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

  // New DB-driven manufacturers and laser_models for dropdowns (populates selects in reports/tickets)
  const [dbManufacturers, setDbManufacturers] = useState<any[]>([]);
  const [dbLaserModels, setDbLaserModels] = useState<any[]>([]);
  const [selectedDbMfr, setSelectedDbMfr] = useState('');
  const [selectedDbModel, setSelectedDbModel] = useState('');

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
  const filteredDbModels = selectedDbMfr 
    ? dbLaserModels.filter((m: any) => String(m.manufacturer_id) === String(selectedDbMfr) || m.manufacturer === selectedDbMfr)
    : dbLaserModels;

  // resolved for perf data (lookup in static MODELS by key or label)
  const resolvedModelKey = selectedDbModel || selectedModelKey;
  const currentModel = resolvedModelKey ? (MODELS as any)[resolvedModelKey] || 
    Object.values(MODELS).find((m: any) => m.label === resolvedModelKey || m.mfg === resolvedModelKey) : null;

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

      // signature_data / role / additional_roles optional; fall back if not migrated yet
      let profile: any = null;
      {
        const withSig = await supabase
          .from('user_profiles')
          .select('organization_id, first_name, last_name, phone, email, job_title, role, additional_roles, signature_data, organizations(name, address, city, state, phone, logo_url)')
          .eq('id', user.id)
          .maybeSingle();
        if (withSig.error && /signature_data|additional_roles|role/i.test(withSig.error.message || '')) {
          const bare = await supabase
            .from('user_profiles')
            .select('organization_id, first_name, last_name, phone, email, job_title, role, organizations(name, address, city, state, phone, logo_url)')
            .eq('id', user.id)
            .maybeSingle();
          profile = bare.data;
        } else {
          profile = withSig.data;
        }
      }

      if (profile?.organization_id) {
        setCurrentUserOrgId(profile.organization_id as any);
        setCurrentProfile(profile);
        const org = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations;
        const techName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.email || '';
        setTechCompanyCache({
          tech_name: techName,
          tech_phone: profile.phone || '',
          tech_email: user.email || '',
          company_name: org?.name || '',
          company_address: org?.address || '',
          company_city: org?.city || '',
          company_state: org?.state || '',
          company_phone: org?.phone || '',
          company_logo_url: org?.logo_url || ''
        });
        // Default Service Engineer to signed-in tech (Android applyEngineerFieldAccess)
        setServiceEngineer((prev) => (prev && prev.trim() ? prev : techName));
      }
      // Always load customers for dropdown (type=customer)
      await loadCustomers(profile?.organization_id || null);
      // default date
      if (!dateOut) setDateOut(new Date().toISOString().slice(0,10));
    })();
  }, [router, supabase]);

  const engineerEditable = useMemo(() => canEditServiceEngineer(currentProfile), [currentProfile]);

  // Load existing report when opened via /reports/new?id=… (Android loadReport parity — minimal fields + engineer)
  useEffect(() => {
    if (!editReportId || !currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: r, error } = await supabase
          .from('service_reports')
          .select('*')
          .eq('id', editReportId)
          .maybeSingle();
        if (cancelled || error || !r) {
          if (error) toast.error('Could not load report: ' + error.message);
          return;
        }
        setCurrentReportId(r.id);
        if (r.status === 'complete') setIsSubmitted(true);
        if (r.report_number) setReportNumber(r.report_number);
        if (r.ticket_number) setTicketNum(r.ticket_number);
        if (r.service_type) setServiceType(r.service_type);
        if (r.date_out) setDateOut(String(r.date_out).slice(0, 10));
        if (r.next_pm_due) setNextPm(String(r.next_pm_due).slice(0, 10));
        if (r.serial_number) setSerialNumber(r.serial_number);
        if (r.equipment_name) setEquipName(r.equipment_name);
        if (r.comments) setComments(r.comments);
        // Prefer saved service_engineer; never clobber with profile after load
        if (r.service_engineer) setServiceEngineer(r.service_engineer);
        if (r.customer_name) {
          setSearchTerm(r.customer_name);
          setSelectedCustomer((prev: any) =>
            prev || {
              id: r.customer_organization_id || null,
              name: r.customer_name,
              address: r.customer_address,
              city: r.customer_city,
              state: r.customer_state,
              phone: r.customer_phone,
              email: r.customer_email,
              contact_name: r.customer_contact_name,
            }
          );
        }
        if (r.model_type) {
          setSelectedModelKey(r.model_type);
          setSelectedDbModel(r.model_type);
        }
        if (r.checklist_electrical && typeof r.checklist_electrical === 'object') {
          setCheckElectrical(r.checklist_electrical);
        }
        if (r.checklist_mechanical && typeof r.checklist_mechanical === 'object') {
          setCheckMechanical(r.checklist_mechanical);
        }
        if (r.checklist_aesthetic && typeof r.checklist_aesthetic === 'object') {
          setCheckAesthetic(r.checklist_aesthetic);
        }
        if (Array.isArray(r.power_measurements)) setPowerMeasurements(r.power_measurements);
        if (r.model_parameters && typeof r.model_parameters === 'object') setModelParams(r.model_parameters);
        if (r.ground_resistance != null) setGroundResistance(r.ground_resistance);
        if (r.leakage_current != null) setLeakageCurrent(r.leakage_current);
        if (r.ground_resistance_pass != null) setGroundPass(!!r.ground_resistance_pass);
        if (r.leakage_current_pass != null) setLeakagePass(!!r.leakage_current_pass);
        if (Array.isArray(r.test_equipment) && r.test_equipment.length) {
          setTestEquipment(r.test_equipment.map((t: any) => ({
            name: t.name || t.model || t.type || '',
            id: t.id || t.serial || '',
          })));
        }
        if (r.tech_signature) setTechSig(r.tech_signature);
        if (r.signed_date) setTechSigDate(String(r.signed_date).slice(0, 10));
        toast.success(r.status === 'complete' ? 'Report loaded' : 'Draft loaded');
      } catch (e: any) {
        console.warn('load report', e);
        toast.error('Failed to load report');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editReportId, currentUser, supabase]);

  // Load manufacturers and laser_models from Supabase for dynamic dropdowns in reports (and tickets)
  useEffect(() => {
    (async () => {
      try {
        // Flexible select to handle different possible column names
        const { data: mfrsRaw } = await supabase
          .from('manufacturers')
          .select('*')
          .order('name');
        const normalizedMfrs = (mfrsRaw || []).map((row: any) => ({
          id: row.id || row.manufacturer_id,
          name: row.name || row.manufacturer_name || row.manufacturer || String(row.id || '')
        })).filter(r => r.name);
        setDbManufacturers(normalizedMfrs);

        const { data: lmsRaw } = await supabase
          .from('laser_models')
          .select('*')
          .order('name');
        const normalizedModels = (lmsRaw || []).map((row: any) => ({
          id: row.id,
          name: row.name || row.model_name || row.model || '',
          label: row.label || row.name || row.model_name || '',
          manufacturer_id: row.manufacturer_id || row.manufacturer || row.manufacturer_name || ''
        }));
        setDbLaserModels(normalizedModels);
      } catch (e) {
        console.warn('Failed to load manufacturers/laser_models tables (will fallback to static MODELS):', e);
        // Fallback static will be used in render
      }
    })();
  }, [supabase]);

  async function loadCustomers(orgId: any) {
    // Only customers linked to this service org via organization_customers
    try {
      if (!orgId) {
        setCustomerOptions([]);
        return;
      }
      const { data: junc, error } = await supabase
        .from('organization_customers')
        .select(`organizations:customer_organization_id (id, name, address, city, state, phone, email, contact_name)`)
        .eq('service_organization_id', orgId)
        .limit(500);
      if (error) {
        console.warn('organization_customers load failed:', error);
        setCustomerOptions([]);
        return;
      }
      const opts = (junc || [])
        .map((j: any) => j.organizations)
        .filter(Boolean);
      // de-dupe by id
      const seen = new Set<any>();
      setCustomerOptions(
        opts.filter((o: any) => {
          if (!o?.id || seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        })
      );
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
      try {
        await supabase.from('organization_customers').insert({
          service_organization_id: currentUserOrgId,
          customer_organization_id: org.id
        });
      } catch {
        /* ignore link failure */
      }

      await loadCustomers(currentUserOrgId);
      handleSelectCustomer(org);
      setShowAddModal(false);
      setNewCustomer({ name: '', address: '', city: '', state: '', phone: '', email: '', contactName: '' });
    } catch (e: any) {
      toast.error('Failed to create customer: ' + (e.message || e));
    }
  };

  function selectModel(key: string) {
    setSelectedModelKey(key);
    setSelectedDbModel(key);
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

  function selectDbManufacturer(mfr: string) {
    setSelectedDbMfr(mfr);
    setSelectedDbModel('');
    setSelectedModelKey('');
    setCheckElectrical({}); setCheckMechanical({}); setCheckAesthetic({});
    setPowerMeasurements([]); setModelParams({});
  }

  function selectDbModelValue(modelVal: string) {
    setSelectedDbModel(modelVal);
    // resolve to MODELS key if possible for rich perf data
    const found = Object.keys(MODELS).find(k => 
      k === modelVal || (MODELS as any)[k]?.label === modelVal || (MODELS as any)[k]?.mfg === modelVal
    ) || modelVal;
    selectModel(found);
    // Derive equipment_name from manufacturer + model dropdowns (no free-text field)
    const m = (MODELS as any)[found];
    if (m) {
      setEquipName(`${m.mfg || ''} ${m.label || modelVal}`.trim());
    } else if (modelVal) {
      const mfrRow = dbManufacturers.find((x: any) => String(x.id) === String(selectedDbMfr) || x.name === selectedDbMfr);
      const mfrName = mfrRow?.name || selectedDbMfr || '';
      setEquipName([mfrName, modelVal].filter(Boolean).join(' ').trim());
    }
    // Assign report number once when equipment is chosen
    if (!reportNumber && currentUserOrgId) {
      generateDocNumber(supabase, {
        orgId: currentUserOrgId,
        kind: 'SR',
        date: dateOut || new Date(),
      }).then((n) => setReportNumber(n)).catch(() => {});
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

  async function ensureLinkedEquipment(orgId: any) {
    if (!orgId) return null;
    const mfrRow = dbManufacturers.find(
      (x: any) => String(x.id) === String(selectedDbMfr) || x.name === selectedDbMfr
    );
    const mfrName = currentModel?.mfg || mfrRow?.name || selectedDbMfr || '';
    const modelName =
      currentModel?.label || selectedDbModel || selectedModelKey || equipName || '';
    return ensureEquipment({
      client: supabase,
      customerOrgId: orgId,
      manufacturer: mfrName,
      model: modelName,
      serial: serialNumber,
      name: equipName || [mfrName, modelName].filter(Boolean).join(' '),
    });
  }

  async function saveReport(status: 'draft' | 'complete') {
    if (!currentUser || !currentUserOrgId) {
      toast.error('Sign in with an organization to save reports');
      return;
    }
    setSaving(true);
    try {
      // Force latest canvas capture for sig (Android parity)
      const canvas = sigCanvasRef.current;
      let latestSig = techSig;
      if (canvas && !latestSig) {
        try {
          latestSig = canvas.toDataURL('image/png');
          setTechSig(latestSig);
        } catch {}
      }
      const custId = await ensureCustomerOrg();
      const linkedEquipmentId = await ensureLinkedEquipment(custId || null);

      let rn = reportNumber;
      if (!rn) {
        try {
          rn = await generateDocNumber(supabase, {
            orgId: currentUserOrgId,
            kind: 'SR',
            date: dateOut || new Date(),
          });
          setReportNumber(rn);
        } catch {
          rn = '';
        }
      }

      const engineerName =
        (serviceEngineer && serviceEngineer.trim()) ||
        techCompanyCache.tech_name ||
        [currentProfile?.first_name, currentProfile?.last_name].filter(Boolean).join(' ') ||
        currentUser.email ||
        null;

      // collect data mirroring Android
      const reportData: any = {
        organization_id: currentUserOrgId,
        created_by: currentUser.id,
        status,
        service_type: serviceType,
        model_type: selectedModelKey,
        report_number: rn || reportNumber || null,
        service_engineer: engineerName,
        customer_organization_id: custId || null,
        equipment_id: linkedEquipmentId || null,
        equipment_name:
          equipName ||
          currentModel?.label ||
          [dbManufacturers.find((x: any) => String(x.id) === String(selectedDbMfr) || x.name === selectedDbMfr)?.name, selectedDbModel]
            .filter(Boolean)
            .join(' ') ||
          selectedDbModel ||
          null,
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
        // Android parity: service_reports.tech_signature + signed_date (NOT signature_data / signed_at)
        tech_signature: latestSig || currentProfile?.signature_data || null,
        signed_date:
          (techSigDate && String(techSigDate).slice(0, 10)) ||
          (status === 'complete' ? new Date().toISOString().slice(0, 10) : null),
      };

      // Retry without columns PostgREST says are missing (schema drift / unapplied migrations)
      async function writeReport(payload: Record<string, any>, id: any) {
        let body = { ...payload };
        for (let attempt = 0; attempt < 6; attempt++) {
          if (id) {
            const { error } = await supabase.from('service_reports').update(body).eq('id', id);
            if (!error) return { id, error: null as any };
            const m = String(error.message || '');
            const col = m.match(/Could not find the '([^']+)' column/i)?.[1];
            if (col && col in body) {
              console.warn('service_reports missing column, retry without:', col);
              delete body[col];
              continue;
            }
            return { id, error };
          }
          const { data: ins, error } = await supabase.from('service_reports').insert(body).select('id').single();
          if (!error && ins?.id) return { id: ins.id, error: null as any };
          const m = String(error?.message || '');
          const col = m.match(/Could not find the '([^']+)' column/i)?.[1];
          if (col && col in body) {
            console.warn('service_reports missing column, retry without:', col);
            delete body[col];
            continue;
          }
          return { id: null, error };
        }
        return { id: null, error: new Error('Could not save report after schema retries') };
      }

      let savedId = currentReportId;
      const result = await writeReport(reportData, savedId);
      if (result.error) throw result.error;
      if (!savedId && result.id) {
        savedId = result.id;
        setCurrentReportId(savedId);
      }

      if (status === 'complete') {
        setIsSubmitted(true);
        toast.success('Report submitted!');
      } else {
        toast.success('Draft saved.');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Save error: ' + (e.message || e));
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
            <h1 className="text-3xl font-bold">
              {currentReportId ? (isSubmitted ? 'Service Report' : 'Edit Draft Report') : 'New Service Report'}
            </h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => saveReport('draft')} disabled={saving} className="btn btn-secondary flex items-center gap-2"><Save size={16}/> Save Draft</button>
            <button onClick={() => saveReport('complete')} disabled={saving || isSubmitted} className="btn btn-primary flex items-center gap-2"><Check size={18} /> Submit Complete</button>
            <button onClick={() => window.print()} className="btn btn-ghost flex items-center gap-2 text-xs">Print / Save PDF</button>
          </div>
        </div>

        {/* Customer Info - dropdown with + add new (requested) */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">🏥 Customer Info</h3>
          <div className="flex gap-2 items-end mb-2">
            <div className="flex-1">
              <label className="text-xs text-[var(--text3)]">Select Customer</label>
              <select 
                className="input w-full text-lg py-3" 
                value={selectedCustomer ? selectedCustomer.id : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__new__') {
                    setShowAddModal(true);
                  } else if (val) {
                    const cust = customerOptions.find((c:any) => String(c.id) === val);
                    if (cust) handleSelectCustomer(cust);
                  } else {
                    setSelectedCustomer(null);
                    setSearchTerm('');
                  }
                }}
              >
                <option value="">-- Select Customer --</option>
                {customerOptions.map((c:any) => (
                  <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ''}</option>
                ))}
                <option value="__new__">+ Add New Customer</option>
              </select>
            </div>
            <button onClick={()=>setShowAddModal(true)} className="btn btn-secondary text-sm py-3">+ Add</button>
          </div>

          {selectedCustomer && (
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-[var(--text3)]">Customer:</span> {selectedCustomer.name}</div>
              <div>{[selectedCustomer.city, selectedCustomer.state].filter(Boolean).join(', ')}</div>
              <div>{selectedCustomer.contact_name || selectedCustomer.phone}</div>
            </div>
          )}
          {/* Optional free text for quick custom (creates on save if needed) */}
          <input type="text" placeholder="Or enter custom name (optional)" className="input w-full mt-1 text-sm" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
        </div>

        {/* Report Info — equipment name/model lives only in the dropdown section below */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">📋 Report Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">Service Type</label><select className="input" value={serviceType} onChange={e=>setServiceType(e.target.value)}><option>PM</option><option>Repair</option><option>Install</option><option>Cal</option></select></div>
            <div><label className="label">Date Out</label><input type="date" className="input" value={dateOut} onChange={e=>setDateOut(e.target.value)} /></div>
            <div><label className="label">Next PM Due</label><input type="date" className="input" value={nextPm} onChange={e=>setNextPm(e.target.value)} /></div>
            <div><label className="label">Ticket #</label><input className="input" value={ticketNum} onChange={e=>setTicketNum(e.target.value)} /></div>
            <div><label className="label">Report #</label><input className="input" value={reportNumber} onChange={e=>setReportNumber(e.target.value)} placeholder="Auto: PREFIX-SR-YYYYMMDD-NN" /></div>
            <div><label className="label">Serial Number</label><input className="input" value={serialNumber} onChange={e=>setSerialNumber(e.target.value)} /></div>
            <div className="md:col-span-2">
              <label className="label">
                Service Engineer{' '}
                <span className="font-normal text-[var(--text3)] text-[11px]">
                  {engineerEditable ? '(admin — editable)' : '(locked to your profile)'}
                </span>
              </label>
              <input
                className="input"
                value={serviceEngineer}
                onChange={(e) => {
                  if (engineerEditable) setServiceEngineer(e.target.value);
                }}
                readOnly={!engineerEditable}
                style={{ opacity: engineerEditable ? 1 : 0.85 }}
                title={
                  engineerEditable
                    ? 'Admins can set which FSE performed the work'
                    : 'Locked to signed-in tech for FSE roles'
                }
                placeholder="Field service engineer name"
              />
            </div>
          </div>
        </div>

        {/* Manufacturer + Model dropdowns (sole equipment name source for draft/save) */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">⚙️ Equipment Name / Model</h3>

          {/* Manufacturer from manufacturers table */}
          <div className="mb-2 flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-[var(--text3)]">Manufacturer</label>
              <select 
                className="input mb-1 w-full" 
                value={selectedDbMfr} 
                onChange={e => selectDbManufacturer(e.target.value)}
              >
                <option value="">-- Select Manufacturer --</option>
                {dbManufacturers.length > 0 
                  ? dbManufacturers.map((m: any) => (
                      <option key={m.id || m.name} value={m.id || m.name}>{m.name}</option>
                    ))
                  : [...new Set(Object.values(MODELS).map((m: any) => m.mfg || 'Unknown'))].map((mfg, i) => (
                      <option key={i} value={mfg}>{mfg}</option>
                    ))
                }
              </select>
            </div>
            <button 
              type="button"
              onClick={async () => {
                const name = prompt('New manufacturer name:');
                if (name && name.trim()) {
                  try {
                    const { data } = await supabase.from('manufacturers').insert({name: name.trim()}).select().single();
                    if (data) {
                      setDbManufacturers(prev => [...prev, {id: data.id, name: data.name}]);
                      selectDbManufacturer(data.id || data.name);
                    }
                  } catch(e){ toast.error('Failed to add manufacturer: ' + (e as any).message); }
                }
              }}
              className="btn btn-secondary text-xs py-1">+ Add Mfr
            </button>
          </div>

          {/* Laser Model from laser_models table */}
          <div>
            <label className="text-xs text-[var(--text3)]">Model</label>
            <select 
              className="input mb-1 w-full" 
              value={selectedDbModel || selectedModelKey} 
              onChange={e => selectDbModelValue(e.target.value)}
            >
              <option value="">-- Select Model --</option>
              {filteredDbModels.length > 0 
                ? filteredDbModels.map((m: any) => (
                    <option key={m.id || m.name} value={m.name || m.label}>{m.label || m.name}</option>
                  ))
                : modelKeys.map(k => <option key={k} value={k}>{k} — {(MODELS as any)[k].label}</option>)
              }
            </select>
          </div>

          {currentModel && <div className="text-sm text-[var(--text3)] mt-1">Mfg: {currentModel.mfg}</div>}
          <div className="text-[10px] text-[var(--text3)] mt-1">Data from manufacturers + laser_models tables (fallback to static MODELS if empty). Use +Add for new.</div>
        </div>

        {/* Checklists - full port from Android */}
        {(selectedModelKey || selectedDbModel) && (
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
              <div className="text-[10px] text-[var(--text3)] mt-2">If blank on complete, profile signature will be used (Android parity). Saved as tech_signature on the report.</div>
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
