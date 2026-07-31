'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { ArrowLeft, Check, Plus, Save } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { MODELS, resolveModelDef } from '@/lib/models';
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

/** Android service_report.html uses PASS / FAIL / N/A (not Pass). Normalize for load + highlight. */
function normalizeChecklistVal(val: any): string {
  if (val == null || val === '') return '';
  const v = String(val).trim().toUpperCase().replace(/\s+/g, '');
  if (v === 'PASS' || v === 'P' || v === 'OK' || v === '✓' || v === '✔') return 'PASS';
  if (v === 'FAIL' || v === 'F' || v === 'FAILED' || v === '✗' || v === '✘') return 'FAIL';
  if (v === 'N/A' || v === 'NA' || v === 'NONE' || v === '-') return 'N/A';
  // already exact-ish
  const raw = String(val).trim();
  if (/^pass$/i.test(raw)) return 'PASS';
  if (/^fail$/i.test(raw)) return 'FAIL';
  if (/^n\/?a$/i.test(raw)) return 'N/A';
  return raw;
}

function normalizeChecklistMap(data: any): Record<string, string> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = normalizeChecklistVal(v);
  }
  return out;
}

const CL_BUTTONS = ['PASS', 'FAIL', 'N/A'] as const;

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
  const [sku, setSku] = useState('');

  // Editable customer fields (Android has full form, not read-only summary)
  const [custAddress, setCustAddress] = useState('');
  const [custCity, setCustCity] = useState('');
  const [custState, setCustState] = useState('');
  const [custContactName, setCustContactName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custWebsite, setCustWebsite] = useState('');

  // Checklists state: {item: 'PASS' | 'FAIL' | 'N/A'} — Android parity
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

  // Test equipment (Android: type / make-model / serial / cal due + used checkbox)
  const [testEquipment, setTestEquipment] = useState<
    { type: string; model: string; serial: string; calDue: string; used: boolean; name?: string; id?: string }[]
  >([]);

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

  // Resolve DB names (e.g. "VBeam Perfecta") → static MODELS (Perfecta) for params + perf
  const resolvedModelKey = selectedDbModel || selectedModelKey;
  const currentModel = resolvedModelKey
    ? resolveModelDef(resolvedModelKey, equipName) ||
      (MODELS as any)[resolvedModelKey] ||
      Object.values(MODELS).find(
        (m: any) =>
          m.label === resolvedModelKey ||
          m.mfg === resolvedModelKey ||
          (m.label &&
            String(resolvedModelKey).toLowerCase().includes(String(m.label).toLowerCase().split('(')[0].trim()))
      ) ||
      null
    : null;

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
        if (r.sku) setSku(r.sku);
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
              website: r.customer_website || null,
            }
          );
        }
        setCustAddress(r.customer_address || '');
        setCustCity(r.customer_city || '');
        setCustState(r.customer_state || '');
        setCustContactName(r.customer_contact_name || '');
        setCustPhone(r.customer_phone || '');
        setCustEmail(r.customer_email || '');
        setCustWebsite(r.customer_website || '');
        // Always restore model keys so checklists / params stay editable (gate removed but keys still needed)
        if (r.model_type || r.equipment_name) {
          const mt = r.model_type || r.equipment_name || '';
          setSelectedModelKey(mt);
          setSelectedDbModel(mt);
          // Best-effort manufacturer restore for dropdowns
          const resolved = resolveModelDef(mt, r.equipment_name || mt);
          if (resolved?.mfg) {
            setSelectedDbMfr((prev) => prev || resolved.mfg);
          }
        }
        // Normalize PASS/FAIL so button highlight matches Android-saved reports
        if (r.checklist_electrical && typeof r.checklist_electrical === 'object') {
          setCheckElectrical(normalizeChecklistMap(r.checklist_electrical));
        }
        if (r.checklist_mechanical && typeof r.checklist_mechanical === 'object') {
          setCheckMechanical(normalizeChecklistMap(r.checklist_mechanical));
        }
        if (r.checklist_aesthetic && typeof r.checklist_aesthetic === 'object') {
          setCheckAesthetic(normalizeChecklistMap(r.checklist_aesthetic));
        }
        if (Array.isArray(r.power_measurements)) {
          setPowerMeasurements(
            r.power_measurements.map((pm: any) => ({
              wavelength: pm.wavelength || pm.name || '',
              setting: pm.setting ?? pm.set ?? '',
              measured: pm.measured ?? pm.actual ?? '',
              unit: pm.unit || 'W',
              pass: pm.pass === true || pm.result === 'PASS' || pm.result === 'Pass',
              deviation: pm.deviation || '',
            }))
          );
        }
        if (r.model_parameters && typeof r.model_parameters === 'object') setModelParams(r.model_parameters);
        if (r.ground_resistance != null) setGroundResistance(r.ground_resistance);
        if (r.leakage_current != null) setLeakageCurrent(r.leakage_current);
        if (r.ground_resistance_pass != null) setGroundPass(!!r.ground_resistance_pass);
        if (r.leakage_current_pass != null) setLeakagePass(!!r.leakage_current_pass);
        if (Array.isArray(r.test_equipment) && r.test_equipment.length) {
          setTestEquipment(
            r.test_equipment.map((t: any) => ({
              type: t.type || t.name || 'Instrument',
              model: t.model || t.name || '',
              serial: t.serial || t.id || t.serial_number || '',
              calDue: t.calDue || t.cal_due || '',
              used: t.used !== false,
              name: t.name || t.model || t.type || '',
              id: t.id || t.serial || '',
            }))
          );
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

  // Load user's test equipment catalog for *new* reports only (Android loadTestEquipment parity).
  // When editing an existing report, TE comes from the saved report payload.
  useEffect(() => {
    if (!currentUser || editReportId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('test_equipment')
          .select('type, make, model, serial_number, cal_date, cal_due, is_active')
          .eq('user_id', currentUser.id)
          .eq('is_active', true)
          .order('type');
        if (cancelled) return;
        if (data && data.length) {
          setTestEquipment(
            data.map((eq: any) => ({
              type: eq.type || 'Instrument',
              model: [eq.make, eq.model].filter(Boolean).join(' '),
              serial: eq.serial_number || '',
              calDue: eq.cal_due || '',
              used: true,
              name: [eq.make, eq.model].filter(Boolean).join(' ') || eq.type || '',
              id: eq.serial_number || '',
            }))
          );
        } else {
          setTestEquipment([
            { type: 'Electrical Safety Tester', model: '', serial: '', calDue: '', used: true },
            { type: 'Energy Detector / Power Meter', model: '', serial: '', calDue: '', used: true },
            { type: 'Digital Multimeter', model: '', serial: '', calDue: '', used: true },
            { type: 'Oscilloscope', model: '', serial: '', calDue: '', used: true },
          ]);
        }
      } catch (e) {
        console.warn('Test equipment load error:', e);
        if (!cancelled) {
          setTestEquipment([
            { type: 'Electrical Safety Tester', model: '', serial: '', calDue: '', used: true },
            { type: 'Energy Detector / Power Meter', model: '', serial: '', calDue: '', used: true },
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, supabase, editReportId]);

  // After manufacturers load, try to match selected mfr id for restored model
  useEffect(() => {
    if (!selectedDbModel || selectedDbMfr || !dbManufacturers.length) return;
    const resolved = resolveModelDef(selectedDbModel, equipName || selectedDbModel);
    const mfgName = resolved?.mfg;
    if (!mfgName) return;
    const match = dbManufacturers.find(
      (m: any) => String(m.name).toLowerCase() === String(mfgName).toLowerCase()
    );
    if (match) setSelectedDbMfr(match.id || match.name);
    else setSelectedDbMfr(mfgName);
  }, [dbManufacturers, selectedDbModel, selectedDbMfr, equipName]);

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
    setCustAddress(customer.address || '');
    setCustCity(customer.city || '');
    setCustState(customer.state || '');
    setCustContactName(customer.contact_name || '');
    setCustPhone(customer.phone || '');
    setCustEmail(customer.email || '');
    setCustWebsite(customer.website || '');
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
    // Fuzzy resolve DB names → static MODELS keys (VBeam Perfecta → Perfecta)
    let found =
      Object.keys(MODELS).find(
        (k) =>
          k === modelVal ||
          (MODELS as any)[k]?.label === modelVal ||
          (MODELS as any)[k]?.mfg === modelVal
      ) || '';
    if (!found) {
      const resolved = resolveModelDef(modelVal, modelVal);
      if (resolved) {
        found =
          Object.keys(MODELS).find((k) => MODELS[k] === resolved) || modelVal;
      } else {
        found = modelVal;
      }
    }
    selectModel(found);
    // Derive equipment_name from manufacturer + model dropdowns (no free-text field)
    const m = resolveModelDef(found, modelVal) || (MODELS as any)[found];
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
    setter((prev: any) => ({ ...prev, [item]: normalizeChecklistVal(val) }));
  }

  function markAllPass(items: string[], setter: any) {
    const next: Record<string, string> = {};
    items.forEach((item) => {
      next[item] = 'PASS';
    });
    setter((prev: any) => ({ ...prev, ...next }));
  }

  function addPerfRow() {
    const firstWl = currentModel?.wavelengths?.[0];
    setPowerMeasurements((prev) => [
      ...prev,
      {
        wavelength: firstWl?.name || 'Output',
        setting: (firstWl?.sets && firstWl.sets[0]) || '',
        measured: '',
        unit: firstWl?.unit || 'W',
        pass: true,
        deviation: '',
      },
    ]);
  }

  /** Auto PASS/FAIL for electrical safety (Android checkSafety: ground ≤0.2Ω, leakage ≤300µA) */
  function updateGroundResistance(val: string) {
    if (val === '') {
      setGroundResistance('');
      return;
    }
    const n = parseFloat(val);
    setGroundResistance(isNaN(n) ? '' : n);
    if (!isNaN(n)) setGroundPass(n <= 0.2);
  }
  function updateLeakageCurrent(val: string) {
    if (val === '') {
      setLeakageCurrent('');
      return;
    }
    const n = parseFloat(val);
    setLeakageCurrent(isNaN(n) ? '' : n);
    if (!isNaN(n)) setLeakagePass(n <= 300);
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
    setTestEquipment((prev) => [
      ...prev,
      { type: 'Instrument', model: '', serial: '', calDue: '', used: true, name: '', id: '' },
    ]);
  }

  function updateTestEquip(idx: number, key: string, val: any) {
    setTestEquipment((prev) => {
      const cp = [...prev];
      cp[idx] = { ...cp[idx], [key]: val };
      if (key === 'model' || key === 'type') {
        cp[idx].name = [cp[idx].type, cp[idx].model].filter(Boolean).join(' — ');
      }
      if (key === 'serial') cp[idx].id = val;
      return cp;
    });
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
        sku: sku || null,
        serial_number: serialNumber || null,
        customer_name: selectedCustomer?.name || searchTerm || null,
        customer_address: custAddress || selectedCustomer?.address || null,
        customer_city: custCity || selectedCustomer?.city || null,
        customer_state: custState || selectedCustomer?.state || null,
        customer_phone: custPhone || selectedCustomer?.phone || null,
        customer_email: custEmail || selectedCustomer?.email || null,
        customer_contact_name: custContactName || selectedCustomer?.contact_name || null,
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
        test_equipment: testEquipment
          .filter((t) => t.used !== false && (t.model || t.type || t.name || t.serial))
          .map((t) => ({
            type: t.type || '',
            model: t.model || t.name || '',
            name: t.name || t.model || t.type || '',
            serial: t.serial || t.id || '',
            id: t.serial || t.id || '',
            calDue: t.calDue || '',
            used: true,
          })),
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
        <div className="section-hdr flex items-center justify-between gap-2 flex-wrap">
          <h3>{title}</h3>
          <button
            type="button"
            onClick={() => markAllPass(items, setter)}
            className="text-[11px] font-bold text-[var(--gold)] hover:underline"
          >
            Mark all PASS
          </button>
        </div>
        <div className="section-body">
          {items.map((item) => {
            const active = normalizeChecklistVal(state[item]);
            return (
              <div key={item} className="checklist-item flex items-center justify-between gap-2 py-2 border-b border-[var(--border)] last:border-0">
                <div className="checklist-label text-sm text-[var(--text2)] flex-1 pr-2">{item}</div>
                <div className="checklist-btns flex gap-1 shrink-0">
                  {CL_BUTTONS.map((v) => {
                    const isActive = active === v;
                    const color =
                      v === 'PASS'
                        ? isActive
                          ? 'bg-green-600 text-white border-green-600'
                          : 'border-green-700/50 text-green-400'
                        : v === 'FAIL'
                          ? isActive
                            ? 'bg-red-600 text-white border-red-600'
                            : 'border-red-700/50 text-red-400'
                          : isActive
                            ? 'bg-[var(--gold)] text-black border-[var(--gold)]'
                            : 'border-[var(--border)] text-[var(--text3)]';
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setChecklist(setter, item, v)}
                        className={`px-2 py-0.5 text-xs rounded border font-semibold ${color}`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
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

        {/* Customer Info — full editable fields (Android parity) */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">🏥 Customer Info</h3>
          <div className="flex gap-2 items-end mb-3">
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
                    setCustAddress(''); setCustCity(''); setCustState('');
                    setCustContactName(''); setCustPhone(''); setCustEmail(''); setCustWebsite('');
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="label">Customer Name</label>
              <input type="text" className="input w-full" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Clinic / facility name" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Address</label>
              <input className="input w-full" value={custAddress} onChange={e=>setCustAddress(e.target.value)} placeholder="123 Main St" />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input w-full" value={custCity} onChange={e=>setCustCity(e.target.value)} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input w-full" value={custState} onChange={e=>setCustState(e.target.value)} maxLength={2} placeholder="CA" />
            </div>
            <div>
              <label className="label">Contact Name</label>
              <input className="input w-full" value={custContactName} onChange={e=>setCustContactName(e.target.value)} placeholder="John Doe" />
            </div>
            <div>
              <label className="label">Contact Phone</label>
              <input className="input w-full" type="tel" value={custPhone} onChange={e=>setCustPhone(e.target.value)} />
            </div>
            <div>
              <label className="label">Contact Email</label>
              <input className="input w-full" type="email" value={custEmail} onChange={e=>setCustEmail(e.target.value)} />
            </div>
            <div>
              <label className="label">Website / URL</label>
              <input className="input w-full" type="url" value={custWebsite} onChange={e=>setCustWebsite(e.target.value)} placeholder="https://" />
            </div>
          </div>
        </div>

        {/* Report Info */}
        <div className="section mb-6 p-6">
          <h3 className="text-xl font-semibold mb-4">📋 Report Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Equipment Name</label>
              <input className="input" value={equipName} onChange={e=>setEquipName(e.target.value)} placeholder="Auto-filled from model" />
            </div>
            <div>
              <label className="label">SKU #</label>
              <input className="input" value={sku} onChange={e=>setSku(e.target.value)} />
            </div>
            <div>
              <label className="label">Serial Number</label>
              <input className="input" value={serialNumber} onChange={e=>setSerialNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Service Type</label>
              <select className="input" value={serviceType} onChange={e=>setServiceType(e.target.value)}>
                <option value="PM">PM</option>
                <option value="Repair">Repair</option>
                <option value="PM+Repair">PM + Repair</option>
                <option value="Install">Install</option>
                <option value="Cal">Cal</option>
              </select>
            </div>
            <div><label className="label">Date Out</label><input type="date" className="input" value={dateOut} onChange={e=>setDateOut(e.target.value)} /></div>
            <div><label className="label">Next PM Due</label><input type="date" className="input" value={nextPm} onChange={e=>setNextPm(e.target.value)} /></div>
            <div><label className="label">Ticket #</label><input className="input" value={ticketNum} onChange={e=>setTicketNum(e.target.value)} /></div>
            <div><label className="label">Report #</label><input className="input" value={reportNumber} onChange={e=>setReportNumber(e.target.value)} placeholder="Auto: PREFIX-SR-YYYYMMDD-NN" /></div>
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
              {/* Preserve loaded model_type even if not in filtered list (report open / DB name mismatch) */}
              {(selectedDbModel || selectedModelKey) &&
                !(filteredDbModels.length > 0
                  ? filteredDbModels.some(
                      (m: any) =>
                        (m.name || m.label) === (selectedDbModel || selectedModelKey)
                    )
                  : modelKeys.includes(selectedDbModel || selectedModelKey)) && (
                  <option value={selectedDbModel || selectedModelKey}>
                    {selectedDbModel || selectedModelKey}
                  </option>
                )}
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

        {/* Checklists — always visible & editable (Android always renders once form open) */}
        {renderChecklist(CL_ELECTRICAL, checkElectrical, setCheckElectrical, '⚡ Electrical Checklist')}
        {renderChecklist(CL_MECHANICAL, checkMechanical, setCheckMechanical, '🔧 Mechanical & Optical')}
        {renderChecklist(CL_AESTHETIC, checkAesthetic, setCheckAesthetic, '🎨 Aesthetic Condition')}

        {/* Performance Testing — always available (generic rows if no OEM wavelengths) */}
        <div className="section mb-6">
          <div className="section-hdr"><h3>📊 Performance Testing</h3></div>
          <div className="section-body p-4">
            <p className="text-[10px] text-[var(--text3)] mb-2">
              {currentModel?.wavelengths?.length
                ? 'Model-seeded wavelengths available in the dropdown; add rows as needed.'
                : 'No OEM wavelength table for this model — enter freeform measurements.'}
            </p>
            <button type="button" onClick={addPerfRow} className="btn btn-secondary text-sm mb-3">+ Add Measurement Row</button>
            {powerMeasurements.length === 0 && (
              <div className="text-sm text-[var(--text3)] mb-2">No measurements yet. Add a row to record set vs actual.</div>
            )}
            {powerMeasurements.map((row, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-2 items-center text-sm">
                {currentModel?.wavelengths?.length ? (
                  <select className="input" value={row.wavelength} onChange={e=>updatePerf(i,'wavelength',e.target.value)}>
                    <option value="">— Wavelength —</option>
                    {currentModel.wavelengths.map((w:any) => <option key={w.name} value={w.name}>{w.name}</option>)}
                    {row.wavelength && !currentModel.wavelengths.some((w:any)=>w.name===row.wavelength) && (
                      <option value={row.wavelength}>{row.wavelength}</option>
                    )}
                  </select>
                ) : (
                  <input className="input" placeholder="Wavelength / channel" value={row.wavelength} onChange={e=>updatePerf(i,'wavelength',e.target.value)} />
                )}
                <input className="input" placeholder="Set" value={row.setting} onChange={e=>updatePerf(i,'setting',e.target.value)} />
                <input className="input" placeholder="Measured" value={row.measured} onChange={e=>updatePerf(i,'measured',e.target.value)} />
                <input className="input" placeholder="Unit" value={row.unit || ''} onChange={e=>updatePerf(i,'unit',e.target.value)} />
                <div className={`text-xs font-bold ${row.pass === false ? 'text-red-400' : row.pass ? 'text-green-400' : 'text-[var(--text3)]'}`}>
                  {row.deviation || '—'} {row.pass === true ? 'PASS' : row.pass === false ? 'FAIL' : ''}
                </div>
                <button type="button" onClick={()=>removePerf(i)} className="text-red-400 text-xs">× Remove</button>
              </div>
            ))}
          </div>
        </div>

        {/* System Parameters — show when model has params OR saved modelParams keys exist */}
        {(currentModel?.params?.length > 0 || Object.keys(modelParams).filter(k => !k.startsWith('__') && !k.startsWith('wlt_') && !k.startsWith('gas_') && !k.startsWith('fiber_')).length > 0) && (
          <div className="section mb-6 p-6">
            <h3 className="font-semibold mb-2 text-[var(--gold)]">🔬 System Parameters</h3>
            <p className="text-[10px] text-[var(--text3)] mb-3">
              Model-specific counters and voltages (e.g. VBeam Perfecta: pulses, dye, HV Final, bubble sense).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(currentModel?.params?.length
                ? currentModel.params
                : Object.keys(modelParams).filter((k) => !k.startsWith('__') && !/^wlt_|^gas_|^fiber_/.test(k))
              ).map((p: string) => (
                <div key={p}>
                  <label className="text-xs font-semibold text-[var(--text2)]">{p}</label>
                  <input
                    className="input"
                    inputMode={/s\/n|serial|kit|status|level/i.test(p) ? 'text' : 'decimal'}
                    value={modelParams[p] || ''}
                    onChange={(e) => setModelParams({ ...modelParams, [p]: e.target.value })}
                    placeholder={p}
                  />
                </div>
              ))}
            </div>
            {(currentModel?.wlTest || ['wlt_nofilter','wlt_hd1_pre','wlt_ophir_pre','wlt_filter','wlt_hd1_post','wlt_ophir_post'].some(k => modelParams[k] != null && modelParams[k] !== '')) && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <h4 className="text-sm font-bold text-[var(--gold)] mb-2">Wavelength Test</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    ['wlt_nofilter', 'No Filter'],
                    ['wlt_hd1_pre', 'HD 1 (pre)'],
                    ['wlt_ophir_pre', 'Ophir (pre)'],
                    ['wlt_filter', 'Filter'],
                    ['wlt_hd1_post', 'HD 1 (post)'],
                    ['wlt_ophir_post', 'Ophir (post)'],
                  ].map(([id, lab]) => (
                    <div key={id}>
                      <label className="text-xs">{lab}</label>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={modelParams[id] || ''}
                        onChange={(e) => setModelParams({ ...modelParams, [id]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(currentModel?.gasTest || ['gas_0','gas_10','gas_50','gas_70','gas_120'].some(k => modelParams[k] != null && modelParams[k] !== '')) && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <h4 className="text-sm font-bold text-[var(--gold)] mb-2">Gas PSI Values</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    ['gas_0', '0 PSI (spec ±0)'],
                    ['gas_10', '10 PSI (spec ±5)'],
                    ['gas_50', '50 PSI (spec ±5)'],
                    ['gas_70', '70 PSI (spec ±5)'],
                    ['gas_120', '120 PSI (spec ±5)'],
                  ].map(([id, lab]) => (
                    <div key={id}>
                      <label className="text-xs">{lab}</label>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={modelParams[id] || ''}
                        onChange={(e) => setModelParams({ ...modelParams, [id]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(currentModel?.fiberTest || Object.keys(modelParams).some((k) => k.startsWith('fiber_'))) && (
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <h4 className="text-sm font-bold text-[var(--gold)] mb-2">Ferrule / Fiber Testing</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.keys(modelParams)
                    .filter((k) => k.startsWith('fiber_'))
                    .concat(
                      !Object.keys(modelParams).some((k) => k.startsWith('fiber_'))
                        ? ['fiber_1', 'fiber_2', 'fiber_3', 'fiber_4']
                        : []
                    )
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .map((id) => (
                      <div key={id}>
                        <label className="text-xs">{id.replace(/^fiber_/, 'Fiber ')}</label>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={modelParams[id] || ''}
                          onChange={(e) => setModelParams({ ...modelParams, [id]: e.target.value })}
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="section mb-6 p-6">
          <h3 className="font-semibold mb-2">🛡️ Electrical Safety</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Ground Resistance (Ω) — spec ≤ 0.2Ω</label>
              <input type="number" step="0.001" className="input" value={groundResistance} onChange={e=>updateGroundResistance(e.target.value)} />
              <div className="flex gap-2 mt-2 items-center">
                <button type="button" onClick={()=>setGroundPass(true)} className={`px-3 py-1 rounded text-xs border ${groundPass===true?'bg-green-600 text-white border-green-600':'border-[var(--border)]'}`}>PASS</button>
                <button type="button" onClick={()=>setGroundPass(false)} className={`px-3 py-1 rounded text-xs border ${groundPass===false?'bg-red-600 text-white border-red-600':'border-[var(--border)]'}`}>FAIL</button>
                {groundPass === true && <span className="text-green-400 text-xs font-bold">✓ PASS</span>}
                {groundPass === false && <span className="text-red-400 text-xs font-bold">✗ FAIL</span>}
              </div>
            </div>
            <div>
              <label className="label">Leakage Current (µA) — spec ≤ 300µA</label>
              <input type="number" step="0.1" className="input" value={leakageCurrent} onChange={e=>updateLeakageCurrent(e.target.value)} />
              <div className="flex gap-2 mt-2 items-center">
                <button type="button" onClick={()=>setLeakagePass(true)} className={`px-3 py-1 rounded text-xs border ${leakagePass===true?'bg-green-600 text-white border-green-600':'border-[var(--border)]'}`}>PASS</button>
                <button type="button" onClick={()=>setLeakagePass(false)} className={`px-3 py-1 rounded text-xs border ${leakagePass===false?'bg-red-600 text-white border-red-600':'border-[var(--border)]'}`}>FAIL</button>
                {leakagePass === true && <span className="text-green-400 text-xs font-bold">✓ PASS</span>}
                {leakagePass === false && <span className="text-red-400 text-xs font-bold">✗ FAIL</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="section mb-6 p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">🧰 Test Equipment</h3>
            <Link href="/test-equipment" className="text-[11px] font-bold text-[var(--gold)]">Manage ›</Link>
          </div>
          {testEquipment.length === 0 && (
            <p className="text-sm text-[var(--text3)] mb-2">No test equipment on file. Add instruments below or manage your catalog.</p>
          )}
          {testEquipment.map((te, i) => (
            <div key={i} className="mb-3 pb-3 border-b border-[var(--border)] last:border-0">
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--gold)] mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={te.used !== false}
                  onChange={(e) => updateTestEquip(i, 'used', e.target.checked)}
                  className="accent-[var(--gold)]"
                />
                <input
                  className="input flex-1 text-sm font-bold"
                  value={te.type}
                  onChange={(e) => updateTestEquip(i, 'type', e.target.value)}
                  placeholder="Type (e.g. Digital Multimeter)"
                />
                <span className="font-normal text-[var(--text3)]">(used on this call)</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text3)]">Make / Model</label>
                  <input className="input" value={te.model || ''} onChange={(e) => updateTestEquip(i, 'model', e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text3)]">Serial #</label>
                  <input className="input" value={te.serial || ''} onChange={(e) => updateTestEquip(i, 'serial', e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text3)]">Cal Due</label>
                  <input type="date" className="input" value={te.calDue || ''} onChange={(e) => updateTestEquip(i, 'calDue', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addTestEquip} className="text-xs text-[var(--gold)] font-bold">+ Add instrument</button>
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
