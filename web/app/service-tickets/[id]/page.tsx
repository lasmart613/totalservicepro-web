'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useT } from '@/lib/fa/locale';
import { estimateFromTicketHref, invoiceFromTicketHref } from '@/lib/billing/doc-prefill';
import {
  canCheckIn,
  checkInPatch,
  checkInReportHref,
  checkInState,
  formatArrival,
  ticketAssetTag,
  ticketSerialNumber,
} from '@/lib/ticket-checkin';
import { loadPendingFromLastVisit, type PendingFromLastVisit } from '@/lib/sr-carry-forward';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { DEFAULT_ORG_TIMEZONE, formatOrgDocumentDate, resolveNumberingTimeZone } from '@/lib/org-timezone';
import { ArrowLeft, Edit2, MapPinCheck, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  LINKED_CUSTOMER_SEARCH_DEBOUNCE_MS,
  searchShopCustomers,
  type LinkedCustomerOpt,
} from '@/lib/customer-form';
import { updateOmittingCharOverflow } from '@/lib/char-overflow';
import { AssignFseSelect } from '@/components/AssignFseSelect';
import {
  catalogChoiceLabel,
  manufacturerChoiceLabel,
  normalizeManufacturerRow,
  normalizeModelRow,
} from '@/lib/equipment-dropdown';
import { equipmentTypeLabel, normalizeEquipmentType } from '@/lib/equipment-types';
import { useEquipmentCascade } from '@/lib/use-equipment-cascade';
import EquipmentCascadeFields from '@/components/EquipmentCascadeFields';
import {
  applyTicketAssignee,
  assigneeName,
  loadTicketAssignees,
  looksLikeUuid,
  notifyTicketAssignee,
  shouldNotifyAssignee,
  ticketAssigneeId,
  type TicketAssignee,
} from '@/lib/ticket-assignees';
import { canCreateServiceReports } from '@/lib/roles';
import { listReportsForTicket, type ExistingTicketReport } from '@/lib/ticket-service-report';
import { CreateServiceReportActions } from '@/components/CreateServiceReportActions';
import { TicketAddressLink } from '@/components/AddressLink';

const TICKET_SAVE_FIELDS = [
  'status',
  'priority',
  'description',
  'notes',
  'customer_name',
  'customer_phone',
  'customer_email',
  'customer_address',
  'customer_city',
  'customer_state',
  'zip',
  'customer_organization_id',
  'equipment_make',
  'equipment_model',
  'equipment_type',
  'serial_number',
  'service_date',
  'scheduled_time',
  'end_time',
  'assigned_to',
] as const;

export default function ServiceTicketDetail() {
  const params = useParams();
  const ticketId = params.id as string;

  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [organizations, setOrganizations] = useState<LinkedCustomerOpt[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [showCustDrop, setShowCustDrop] = useState(false);
  const shopIdRef = useRef<string | number | null>(null);
  const customerSearchGen = useRef(0);
  const customerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [assignees, setAssignees] = useState<TicketAssignee[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [selfName, setSelfName] = useState('');
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [viewerOrgType, setViewerOrgType] = useState<string | null>(null);
  const [existingReports, setExistingReports] = useState<ExistingTicketReport[]>([]);
  const [docZone, setDocZone] = useState(DEFAULT_ORG_TIMEZONE);
  const [linkedEquipment, setLinkedEquipment] = useState<Record<string, unknown> | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [pendingFromLast, setPendingFromLast] = useState<PendingFromLastVisit | null>(null);
  const router = useRouter();
  const t = useT();

  // DB dropdowns for equipment
  const [dbMfrs, setDbMfrs] = useState<any[]>([]);
  const [dbLaserModels, setDbLaserModels] = useState<any[]>([]);

  const supabase = getSupabaseClient();
  const filteredOrgs = organizations;

  const refreshCustomers = useCallback(
    async (orgId: string | number, query: string) => {
      const gen = ++customerSearchGen.current;
      setCustomersLoading(true);
      try {
        const rows = await searchShopCustomers(supabase, orgId, query);
        if (gen !== customerSearchGen.current) return;
        setOrganizations(rows);
      } catch {
        if (gen === customerSearchGen.current) setOrganizations([]);
      } finally {
        if (gen === customerSearchGen.current) setCustomersLoading(false);
      }
    },
    [supabase]
  );

  function scheduleCustomerSearch(query: string) {
    if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    const orgId = shopIdRef.current;
    if (orgId == null || orgId === '') return;
    setCustomersLoading(true);
    customerSearchTimer.current = setTimeout(() => {
      void refreshCustomers(orgId, query);
    }, LINKED_CUSTOMER_SEARCH_DEBOUNCE_MS);
  }

  // Fetch ticket + organizations
  useEffect(() => {
    const fetchData = async () => {
      if (!ticketId) return;
      setLoading(true);
      try {
        // Fetch ticket
        const { data: ticketData, error: ticketError } = await supabase
          .from('service_tickets')
          .select('*')
          .eq('id', ticketId)
          .single();

        if (ticketError) throw ticketError;
        const assigned = ticketAssigneeId(ticketData);
        const normalized = { ...ticketData, assigned_to: assigned };
        const nextShopId = ticketData.organization_id;
        shopIdRef.current = nextShopId ?? null;
        customerSearchGen.current += 1;
        setOrganizations([]);
        setCustomersLoading(false);
        setTicket(normalized);
        setFormData(normalized);
        setCustSearch(ticketData.customer_name || '');

        const equipmentPromise = (async () => {
          // Linked equipment record: serial fallback when the ticket has none stored.
          if (normalized?.equipment_id == null || normalized.equipment_id === '') return null;
          try {
            const { data: eq } = await supabase
              .from('equipment')
              .select('*')
              .eq('id', normalized.equipment_id)
              .maybeSingle();
            return (eq as Record<string, unknown>) || null;
          } catch {
            return null;
          }
        })();

        const reportsPromise = (async () => {
          try {
            const ticketReports = await listReportsForTicket(supabase, normalized);
            let pending: PendingFromLastVisit | null = null;
            try {
              pending = await loadPendingFromLastVisit(supabase as any, {
                organizationId: normalized.organization_id,
                equipmentId: normalized.equipment_id,
                serialNumber: normalized.serial_number,
                excludeReportIds: ticketReports.map((r) => r.id),
                excludeTicketId: normalized.id,
                excludeTicketNumber: normalized.ticket_number || null,
              });
            } catch {
              pending = null;
            }
            return { ticketReports, pending };
          } catch (reportErr) {
            console.warn('ticket reports', reportErr);
            return { ticketReports: [] as ExistingTicketReport[], pending: null };
          }
        })();

        const zonePromise = (async () => {
          if (nextShopId == null || nextShopId === '') return null;
          try {
            const zone = await resolveNumberingTimeZone(supabase, nextShopId, { allowBrowser: false });
            return zone.timeZone;
          } catch {
            return null;
          }
        })();

        const peoplePromise = (async () => {
          let meId: string | null = null;
          let meName = '';
          let meRole = '';
          let orgType: string | null = null;
          try {
            const user =
              (await supabase.auth.getSession()).data.session?.user ??
              (await supabase.auth.getUser()).data.user ??
              null;
            meId = user?.id || null;
            if (meId) {
              const withOrg = await supabase
                .from('user_profiles')
                .select('first_name, last_name, email, role, organizations(type)')
                .eq('id', meId)
                .maybeSingle();
              const prof = withOrg.error
                ? (
                    await supabase
                      .from('user_profiles')
                      .select('first_name, last_name, email, role')
                      .eq('id', meId)
                      .maybeSingle()
                  ).data
                : withOrg.data;
              meName =
                [prof?.first_name, prof?.last_name].filter(Boolean).join(' ') ||
                prof?.email ||
                '';
              meRole = prof?.role || '';
              const orgSource = prof as {
                organizations?: { type?: string | null } | Array<{ type?: string | null }> | null;
              } | null;
              const orgRow = Array.isArray(orgSource?.organizations)
                ? orgSource.organizations[0]
                : orgSource?.organizations;
              orgType = orgRow?.type || null;
            }
          } catch (e) {
            console.warn('ticket editor session', e);
          }
          let assignees: TicketAssignee[] = [];
          try {
            assignees = await loadTicketAssignees(supabase, {
              orgId: nextShopId ?? null,
              meId,
              selfName: meName,
              selfRole: meRole,
              keepIds: [assigned],
            });
          } catch (e) {
            console.warn('ticket assignees', e);
          }
          return { meId, meName, meRole, orgType, assignees };
        })();

        const catalogPromise = (async () => {
          try {
            const [mRes, lmRes] = await Promise.all([
              supabase.from('manufacturers').select('id, name').order('name'),
              // equipment_type keeps GE OEC (c_arm) and other non-laser brands out of the Laser list.
              supabase
                .from('laser_models')
                .select('id, name, manufacturer_id, equipment_type')
                .order('name'),
            ]);
            return { m: mRes.data || [], lm: lmRes.data || [] };
          } catch {
            return { m: [], lm: [] };
          }
        })();

        const [equipment, reports, zone, people, catalog] = await Promise.all([
          equipmentPromise,
          reportsPromise,
          zonePromise,
          peoplePromise,
          catalogPromise,
        ]);

        setLinkedEquipment(equipment);
        setExistingReports(reports.ticketReports);
        setPendingFromLast(reports.pending);
        if (zone) setDocZone(zone);
        setUserId(people.meId);
        setSelfName(people.meName);
        setViewerRole(people.meRole || '');
        setViewerOrgType(people.orgType);
        setAssignees(people.assignees);
        setDbMfrs(catalog.m);
        setDbLaserModels(catalog.lm);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => {
      if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    };
  }, [ticketId, supabase]);

  const liveCatalog = useMemo(
    () => ({
      manufacturers: dbMfrs.map(normalizeManufacturerRow),
      models: dbLaserModels.map(normalizeModelRow),
    }),
    [dbMfrs, dbLaserModels]
  );
  const cascade = useEquipmentCascade(liveCatalog);
  const startEditing = () => {
    // Off-list saved make/model load as Other + their text.
    cascade.hydrate({
      equipmentType: ticket?.equipment_type,
      manufacturer: ticket?.equipment_make || '',
      model: ticket?.equipment_model || '',
    });
    setIsEditing(true);
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleCustomerSelect = (selectedOrg: LinkedCustomerOpt | 'new') => {
    if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    customerSearchGen.current += 1;
    setCustomersLoading(false);
    if (selectedOrg === 'new') {
      setFormData((prev: any) => ({ ...prev, customer_organization_id: null }));
      return;
    }

    setCustSearch(selectedOrg.name);
    setShowCustDrop(false);
    setFormData((prev: any) => ({
      ...prev,
      customer_name: selectedOrg.name,
      customer_address: selectedOrg.address || prev.customer_address,
      customer_city: selectedOrg.city || prev.customer_city,
      customer_state: selectedOrg.state || prev.customer_state,
      zip: selectedOrg.zip || prev.zip,
      customer_phone: selectedOrg.phone || prev.customer_phone,
      customer_email: selectedOrg.email || prev.customer_email,
      customer_organization_id: selectedOrg.id,
    }));
  };

  const handleSave = async () => {
    if (!ticketId) return;
    setSaving(true);
    try {
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const key of TICKET_SAVE_FIELDS) {
        if (key in formData) patch[key] = formData[key];
      }
      // Type → make → model come from the shared cascade (Other = typed text).
      patch.equipment_type = cascade.resolved.equipment_type;
      patch.equipment_make = cascade.resolved.manufacturer || null;
      patch.equipment_model = cascade.resolved.model || null;
      // Form assigned_to is the picker uuid. applyTicketAssignee writes that column only.
      const assignedTo = looksLikeUuid(formData.assigned_to) ? String(formData.assigned_to).trim() : '';
      applyTicketAssignee(patch, assignedTo || null);

      let { error } = await updateOmittingCharOverflow(supabase, 'service_tickets', patch, {
        column: 'id',
        value: ticketId,
      });
      if (error && /customer_organization/i.test(error.message || '')) {
        delete patch.customer_organization_id;
        ({ error } = await updateOmittingCharOverflow(supabase, 'service_tickets', patch, {
          column: 'id',
          value: ticketId,
        }));
      }

      if (error) throw error;

      const { data: fresh } = await supabase.from('service_tickets').select('*').eq('id', ticketId).maybeSingle();
      const reloaded = fresh
        ? { ...fresh, assigned_to: ticketAssigneeId(fresh) || assignedTo }
        : { ...ticket, ...patch, assigned_to: assignedTo || null };
      setTicket(reloaded);
      setFormData(reloaded);
      setIsEditing(false);

      const prevAssigned = ticketAssigneeId(ticket);
      if (shouldNotifyAssignee({ previousId: prevAssigned, nextId: assignedTo, actorId: userId })) {
        const who = assigneeName(assignees, assignedTo, 'the assigned FSE');
        try {
          const json = await notifyTicketAssignee(supabase, ticketId, assignedTo);
          if (json.emailed) {
            toast.success(`Ticket updated. ${who} was emailed.`);
          } else {
            toast.success(
              `Ticket updated. Could not email ${who}${json.error ? `: ${json.error}` : '.'}`
            );
          }
        } catch (notifyErr) {
          console.warn('notify assignee', notifyErr);
          toast.success('Ticket updated successfully!');
        }
      } else {
        toast.success('Ticket updated successfully!');
      }
    } catch (err) {
      console.error('Error saving ticket:', err);
      toast.error('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData(ticket);
    setIsEditing(false);
  };

  const handleCheckIn = async () => {
    if (!ticket?.id || checkingIn) return;
    setCheckingIn(true);
    try {
      if (canCheckIn(ticket)) {
        const patch = checkInPatch(new Date());
        // Guarded update: only stamps arrival when it is still null, so a second
        // click / second device never overwrites the first arrival time.
        const { data, error } = await supabase
          .from('service_tickets')
          .update(patch)
          .eq('id', ticket.id)
          .is('arrival_time', null)
          .select('arrival_time, status');
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : null;
        if (row) {
          setTicket((prev: any) => (prev ? { ...prev, ...row } : prev));
          toast.success(t('Checked in at {time}').replace('{time}', formatArrival(row.arrival_time, docZone)));
        } else {
          // Someone already checked in: keep their arrival, just reload it.
          const { data: fresh } = await supabase
            .from('service_tickets')
            .select('arrival_time, status')
            .eq('id', ticket.id)
            .maybeSingle();
          if (fresh) setTicket((prev: any) => (prev ? { ...prev, ...fresh } : prev));
        }
      }
      router.push(checkInReportHref(ticket.id));
    } catch (err: any) {
      console.error('check in', err);
      toast.error(t('Could not check in. Please try again.'));
      setCheckingIn(false);
    }
  };

  const checkIn = checkInState(ticket, existingReports.length);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-[var(--text3)]">Loading ticket...</div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl mb-4">Ticket not found</p>
          <Link href="/service-schedule" className="btn btn-primary">Back to Schedule</Link>
        </div>
      </div>
    );
  }

  const canCreateReport =
    viewerRole != null && canCreateServiceReports(viewerRole, viewerOrgType);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className={`max-w-7xl mx-auto w-full px-4 py-8 ${canCreateReport ? 'pb-24 sm:pb-8' : ''}`}>
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/service-schedule" className="btn btn-secondary shrink-0 p-3">
              <ArrowLeft size={20} />
            </Link>
            <div className="min-w-0">
              <h1 className="text-3xl font-extrabold sm:text-4xl break-words">Ticket #{ticket.ticket_number}</h1>
              <p className="text-[var(--text3)]">{ticket.customer_name}</p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {canCreateReport && !isEditing && checkIn === 'not-checked-in' && (
              <button
                type="button"
                onClick={handleCheckIn}
                disabled={checkingIn}
                data-testid="ticket-check-in"
                className="btn btn-secondary flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
              >
                <MapPinCheck size={18} /> {checkingIn ? t('Checking in...') : t('Check in')}
              </button>
            )}
            {!isEditing && checkIn !== 'not-checked-in' && (
              <span data-testid="ticket-checked-in" className="flex items-center gap-1 text-sm text-gray-600">
                <MapPinCheck size={16} /> {t('Checked in at {time}').replace('{time}', formatArrival(ticket.arrival_time, docZone) || String(ticket.arrival_time))}
              </span>
            )}
            {canCreateReport && !isEditing && checkIn === 'report-pending' && (
              <Link
                href={checkInReportHref(ticket.id)}
                data-testid="ticket-continue-report"
                className="btn btn-primary flex w-full items-center justify-center gap-2 sm:w-auto"
              >
                {t('Continue service report')}
              </Link>
            )}
            <CreateServiceReportActions
              canCreate={canCreateReport}
              ticketId={ticket.id}
              existingReports={existingReports}
            />
            {canCreateReport && !isEditing && !ticket.customer_organization_id && (
              <span
                data-testid="ticket-create-docs-need-clinic"
                title={t('Estimates and invoices need a clinic. Edit the ticket to add one.')}
                className="text-xs text-[var(--text3)] self-center"
              >
                {t('Add a clinic to create an estimate or invoice.')}
              </span>
            )}
            {canCreateReport && !isEditing && !!ticket.customer_organization_id && (
              <>
                <Link
                  href={estimateFromTicketHref(ticket.id)}
                  data-testid="ticket-create-estimate"
                  className="btn btn-secondary flex w-full items-center justify-center gap-2 sm:w-auto"
                >
                  {t('Create estimate')}
                </Link>
                <Link
                  href={invoiceFromTicketHref(ticket.id)}
                  data-testid="ticket-create-invoice"
                  className="btn btn-secondary flex w-full items-center justify-center gap-2 sm:w-auto"
                >
                  {t('Create invoice')}
                </Link>
              </>
            )}
            {!isEditing ? (
              <button onClick={startEditing} className="btn btn-primary flex w-full items-center justify-center gap-2 sm:w-auto">
                <Edit2 size={18} /> Edit Ticket
              </button>
            ) : (
              <>
                <button onClick={handleCancel} className="btn btn-secondary flex flex-1 items-center justify-center gap-2 sm:flex-none">
                  <X size={18} /> Cancel
                </button>
                <button onClick={handleSave} disabled={saving} className="btn btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-60 sm:flex-none">
                  <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Ticket Information */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Ticket Information</h2>
            <div className="space-y-4">
              <Field label="Ticket Number" value={ticket.ticket_number} />
              <Field label="Status" value={isEditing ? (
                <select className="input" value={formData.status || ''} onChange={(e) => handleInputChange('status', e.target.value)}>
                  {['Awaiting Scheduling','Scheduled','En Route','On Site','Parts Ordered','Completed','Cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : ticket.status} />
              <Field label="Priority" value={isEditing ? (
                <select className="input" value={formData.priority || ''} onChange={(e) => handleInputChange('priority', e.target.value)}>
                  {['Low','Medium','High','Emergency'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : ticket.priority} />
              <Field label="Service Type" value={ticket.service_type} />
              <Field label="Description" value={isEditing ? <textarea className="input" rows={3} value={formData.description || ''} onChange={(e) => handleInputChange('description', e.target.value)} /> : ticket.description} multiline />
              <Field label="Notes" value={isEditing ? <textarea className="input" rows={3} value={formData.notes || ''} onChange={(e) => handleInputChange('notes', e.target.value)} /> : ticket.notes} multiline />
            </div>
          </div>

          {/* Customer Information with Dropdown + Autofill */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Customer Information</h2>
            <div className="space-y-4">
              {/* Customer Dropdown */}
              {isEditing && (
                <div className="relative">
                  <div className="text-xs text-[var(--text3)] mb-1">Search existing customer</div>
                  <input
                    className="input mb-1"
                    value={custSearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCustSearch(value);
                      setShowCustDrop(true);
                      handleInputChange('customer_name', value);
                      if (!value) handleCustomerSelect('new');
                      scheduleCustomerSearch(value);
                    }}
                    onFocus={() => {
                      setShowCustDrop(true);
                      scheduleCustomerSearch(custSearch);
                    }}
                    placeholder="Type to find a company assigned to this shop"
                    autoComplete="off"
                  />
                  {showCustDrop && customersLoading && filteredOrgs.length === 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-[var(--border2)] bg-[var(--surface3)] px-3 py-2 text-xs text-[var(--text3)] shadow-lg">
                      Searching customers…
                    </div>
                  )}
                  {showCustDrop && filteredOrgs.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border2)] bg-[var(--surface3)] shadow-lg">
                      {filteredOrgs.map((org) => (
                        <button
                          key={String(org.id)}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-[var(--surface)] text-sm"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleCustomerSelect(org)}
                        >
                          <div className="font-semibold">{org.name}</div>
                          <div className="text-xs text-[var(--text3)]">
                            {[org.city, org.state].filter(Boolean).join(', ')}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Field label="Customer Name" value={isEditing ? 
                <input className="input" value={formData.customer_name || ''} onChange={(e) => handleInputChange('customer_name', e.target.value)} placeholder="Enter or select customer" /> 
                : ticket.customer_name} />

              <Field label="Phone" value={isEditing ? <input className="input" value={formData.customer_phone || ''} onChange={(e) => handleInputChange('customer_phone', e.target.value)} /> : ticket.customer_phone} />
              <Field label="Email" value={isEditing ? <input className="input" value={formData.customer_email || ''} onChange={(e) => handleInputChange('customer_email', e.target.value)} /> : ticket.customer_email} />
              <Field label="Address" value={isEditing ? <input className="input" value={formData.customer_address || formData.address || ''} onChange={(e) => handleInputChange('customer_address', e.target.value)} /> : (
                <TicketAddressLink
                  ticket={ticket}
                  emptyText="—"
                  className="underline text-[var(--gold)]"
                />
              )} />
              {isEditing && (
                <>
                  <Field label="City" value={<input className="input" value={formData.customer_city || formData.city || ''} onChange={(e) => handleInputChange('customer_city', e.target.value)} />} />
                  <Field label="State" value={<input className="input" value={formData.customer_state || formData.state || ''} onChange={(e) => handleInputChange('customer_state', e.target.value)} />} />
                  <Field label="ZIP" value={<input className="input" value={formData.zip || ''} onChange={(e) => handleInputChange('zip', e.target.value)} />} />
                </>
              )}
            </div>
          </div>

          {pendingFromLast && (
            <div
              role="note"
              data-testid="ticket-pending-from-last"
              className="card p-4 border-l-4 border-amber-500 bg-amber-500/10"
            >
              <div className="font-semibold mb-1">
                ⚠️ {pendingFromLast.date
                  ? t('Pending from last visit ({date})').replace('{date}', pendingFromLast.date)
                  : t('Pending from last visit')}
              </div>
              <p className="whitespace-pre-wrap text-sm"><bdi dir="auto">{pendingFromLast.pendingIssues}</bdi></p>
              <Link href={`/reports/${pendingFromLast.reportId}`} className="text-xs text-[var(--gold)] font-bold">
                {t('View report')}{pendingFromLast.reportNumber ? ` ${pendingFromLast.reportNumber}` : ''}
              </Link>
            </div>
          )}

          {/* Equipment Information */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Equipment Information</h2>
            <div className="space-y-4">
              {isEditing ? (
                <EquipmentCascadeFields cascade={cascade} labelClassName="label" idPrefix="ticket-eq" />
              ) : (
                <>
                  <Field label="Equipment Type" value={ticket.equipment_type ? (normalizeEquipmentType(ticket.equipment_type) ? equipmentTypeLabel(ticket.equipment_type) : ticket.equipment_type) : ''} />
                  <Field label="Make" value={manufacturerChoiceLabel(ticket.equipment_make)} />
                  <Field label="Model" value={catalogChoiceLabel(ticket.equipment_model)} />
                </>
              )}
              <Field label="Serial Number" value={isEditing ? <input className="input" value={formData.serial_number || ''} onChange={(e) => handleInputChange('serial_number', e.target.value)} /> : ticketSerialNumber(ticket, linkedEquipment)} />
              <Field label={t('Asset Tag')} value={ticketAssetTag(ticket, linkedEquipment)} />
              <Field label="PM Due Date" value={isEditing ? <input type="date" className="input" value={formData.service_date || ''} onChange={(e) => handleInputChange('service_date', e.target.value)} /> : displayStoredDay(ticket.service_date, docZone)} />
            </div>
          </div>

          {/* Scheduling */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Scheduling</h2>
            <div className="space-y-4">
              <Field label="Service Date" value={isEditing ? <input type="date" className="input" value={formData.service_date || ''} onChange={(e) => handleInputChange('service_date', e.target.value)} /> : displayStoredDay(ticket.service_date, docZone)} />
              <Field label="Scheduled Time" value={isEditing ? <input type="time" className="input" value={formData.scheduled_time || ''} onChange={(e) => handleInputChange('scheduled_time', e.target.value)} /> : ticket.scheduled_time} />
              <Field label="End Time" value={isEditing ? <input type="time" className="input" value={formData.end_time || ''} onChange={(e) => handleInputChange('end_time', e.target.value)} /> : ticket.end_time} />
              <Field
                label="Assign to FSE"
                value={
                  isEditing ? (
                    <AssignFseSelect
                      value={formData.assigned_to || ''}
                      onChange={(id) => handleInputChange('assigned_to', id)}
                      assignees={assignees}
                      userId={userId}
                      selfName={selfName}
                    />
                  ) : (
                    assigneeName(
                      assignees,
                      ticketAssigneeId(ticket),
                      ticketAssigneeId(ticket) ? 'Assigned FSE' : 'Unassigned'
                    )
                  )
                }
              />
              <Field label={t('Arrival Time')} value={formatArrival(ticket.arrival_time, docZone) || ticket.arrival_time} />
              <Field label="Departure Time" value={ticket.departure_time} />
            </div>
          </div>

          {/* Additional Details */}
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Additional Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="PO Number" value={isEditing ? <input className="input" value={formData.po_number || ''} onChange={(e) => handleInputChange('po_number', e.target.value)} /> : ticket.po_number} />
              <Field label="Contract Number" value={isEditing ? <input className="input" value={formData.contract_number || ''} onChange={(e) => handleInputChange('contract_number', e.target.value)} /> : ticket.contract_number} />
              <Field label="Billable" value={ticket.billable ? 'Yes' : 'No'} />
              <Field label="Created At" value={formatOrgDocumentDate(ticket.created_at, docZone)} />
              <Field label="Last Updated" value={formatOrgDocumentDate(ticket.updated_at, docZone)} />
            </div>
          </div>
        </div>
      </div>
      <CreateServiceReportActions
        placement="dock"
        canCreate={canCreateReport}
        ticketId={ticket.id}
        existingReports={existingReports}
      />
    </div>
  );
}

function displayStoredDay(value: unknown, timeZone: string): string {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatOrgDocumentDate(text, timeZone);
  return formatOrgDocumentDate(text, timeZone) || text;
}

function Field({ label, value, multiline = false }: { label: string; value: any; multiline?: boolean }) {
  if (!value && value !== false) return null;

  return (
    <div>
      <div className="text-xs text-[var(--text3)] mb-1">{label}</div>
      {multiline ? (
        <div className="text-sm whitespace-pre-wrap">{value}</div>
      ) : (
        <div className="text-sm font-medium">{value}</div>
      )}
    </div>
  );
}