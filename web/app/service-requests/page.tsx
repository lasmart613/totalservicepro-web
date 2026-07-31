'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { canBidMarketplace, isOwnerish, isPro, isServiceCompany } from '@/lib/roles';
import { listManufacturers, listModelsForManufacturer, OTHER_MODEL, OTHER_LASER } from '@/lib/laser-catalog';

type Laser = {
  id: number;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  room?: string | null;
};

type ReqRow = {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  urgency?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  created_at?: string | null;
  service_type?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  bid_count?: number;
};

function ServiceRequestsInner() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preLaserId = searchParams.get('laser_id');
  const openedFromQuery = useRef(false);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [lasers, setLasers] = useState<Laser[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [userRole, setUserRole] = useState('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const [orgCity, setOrgCity] = useState('');
  const [orgState, setOrgState] = useState('');

  const [postOpen, setPostOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [laserPick, setLaserPick] = useState('');
  const [mfr, setMfr] = useState('');
  const [model, setModel] = useState('');
  const [modelOther, setModelOther] = useState('');
  const [serial, setSerial] = useState('');
  const [serviceType, setServiceType] = useState('Emergency Repair');
  const [urgency, setUrgency] = useState('Medium');
  const [preferred, setPreferred] = useState('');
  const [errorCodes, setErrorCodes] = useState('');
  const [desc, setDesc] = useState('');

  const mfrOptions = useMemo(() => listManufacturers(), []);
  const modelOptions = useMemo(() => listModelsForManufacturer(mfr), [mfr]);
  const ownerView = isOwnerish(userRole, orgType);
  const proView =
    canBidMarketplace(userRole) || isPro(userRole) || isServiceCompany(userRole, orgType);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // Open post form once when arriving with ?laser_id= from My Lasers / profile
    if (preLaserId && lasers.length && !openedFromQuery.current) {
      openedFromQuery.current = true;
      setLaserPick(preLaserId);
      setPostOpen(true);
      fillFromLaser(preLaserId);
    }
  }, [preLaserId, lasers]);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('role, organization_id, organizations(type, city, state, address)')
      .eq('id', user.id)
      .maybeSingle();
    const role = prof?.role || '';
    const oId = prof?.organization_id ?? null;
    const org = (prof?.organizations as any) || null;
    const oType = org?.type || null;
    setUserRole(role);
    setOrgId(oId);
    setOrgType(oType);
    setOrgCity(org?.city || '');
    setOrgState(org?.state || '');

    if (oId) {
      const { data: eq } = await supabase
        .from('equipment')
        .select('id, manufacturer, model, serial_number, room')
        .eq('customer_organization_id', oId)
        .order('manufacturer');
      setLasers((eq || []) as Laser[]);
    }

    const owner = isOwnerish(role, oType);
    // Owners see open + awarded (so accepting a bid still shows on the list).
    // Pros browse open/bidding jobs; awarded wins are on /accepted-bids.
    let q = supabase
      .from('service_requests')
      .select('*')
      .or('category.eq.service,category.is.null')
      .in('status', owner ? ['open', 'bidding', 'awarded'] : ['open', 'bidding'])
      .order('created_at', { ascending: false })
      .limit(100);
    if (owner && oId != null) q = q.eq('organization_id', oId);
    else if (owner && user.id) q = q.or(`posted_by.eq.${user.id},created_by.eq.${user.id}`);

    const { data, error } = await q;
    if (error) {
      toast.error(error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = (data || []) as ReqRow[];
    if (list.length) {
      try {
        const ids = list.map((r) => r.id);
        const { data: bids } = await supabase.from('bids').select('request_id').in('request_id', ids);
        const counts: Record<string, number> = {};
        (bids || []).forEach((b: any) => {
          const k = String(b.request_id);
          counts[k] = (counts[k] || 0) + 1;
        });
        list.forEach((r) => {
          r.bid_count = counts[String(r.id)] || 0;
        });
      } catch {
        /* ignore */
      }
    }
    setRows(list);
    setLoading(false);
  }

  function fillFromLaser(id: string) {
    const L = lasers.find((x) => String(x.id) === String(id));
    if (!L) return;
    setDesc(
      `Service needed on ${L.manufacturer || ''} ${L.model || ''}` +
        (L.serial_number ? ` (SN ${L.serial_number})` : '') +
        (L.room ? ` in ${L.room}` : '') +
        '.'
    );
  }

  function openPost() {
    setLaserPick(lasers[0] ? String(lasers[0].id) : OTHER_LASER);
    setMfr('');
    setModel('');
    setModelOther('');
    setSerial('');
    setServiceType('Emergency Repair');
    setUrgency('Medium');
    setPreferred('');
    setErrorCodes('');
    setDesc('');
    if (lasers[0]) fillFromLaser(String(lasers[0].id));
    setPostOpen(true);
  }

  async function submitPost() {
    if (!userId || !orgId) {
      toast.error('No facility linked');
      return;
    }
    if (!desc.trim()) {
      toast.error('Please describe the issue');
      return;
    }

    let manufacturer = '';
    let modelVal = '';
    let serialVal = '';
    let equipmentId: number | null = null;
    let room = '';

    if (laserPick === OTHER_LASER) {
      manufacturer = mfr.trim();
      modelVal = model === OTHER_MODEL ? modelOther.trim() : model.trim();
      serialVal = serial.trim();
      if (!manufacturer || !modelVal) {
        toast.error('Manufacturer and model required for a different laser');
        return;
      }
    } else {
      const L = lasers.find((x) => String(x.id) === String(laserPick));
      if (!L) {
        toast.error('Select a laser');
        return;
      }
      manufacturer = L.manufacturer || '';
      modelVal = L.model || '';
      serialVal = L.serial_number || '';
      equipmentId = L.id;
      room = L.room || '';
    }

    const title = `${serviceType}: ${[manufacturer, modelVal].filter(Boolean).join(' ')}`;
    let description = desc.trim();
    if (room && !description.includes(room)) description += ` Room: ${room}.`;

    setSaving(true);
    try {
      const locationStr = [orgCity, orgState].filter(Boolean).join(', ') || null;
      const payload: any = {
        organization_id: orgId,
        posted_by: userId,
        created_by: userId,
        title,
        description,
        service_type: serviceType,
        model_type: modelVal || null,
        manufacturer: manufacturer || null,
        model: modelVal || null,
        serial_number: serialVal || null,
        equipment_id: equipmentId,
        urgency,
        preferred_date: preferred || null,
        deadline: preferred || null,
        error_codes: errorCodes.trim() || null,
        city: orgCity || null,
        state: orgState || null,
        location: locationStr,
        status: 'open',
        category: 'service',
      };
      let { error } = await supabase.from('service_requests').insert(payload);
      if (error) {
        const slim = {
          organization_id: orgId,
          posted_by: userId,
          title,
          description,
          service_type: serviceType,
          model_type: modelVal || null,
          urgency,
          status: 'open',
        };
        const r2 = await supabase.from('service_requests').insert(slim);
        if (r2.error) throw r2.error;
      }
      toast.success('Service request posted');
      setPostOpen(false);
      // Return owners to My Lasers after posting
      router.push('/my-lasers');
    } catch (e: any) {
      toast.error(e.message || 'Could not post');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">← Dashboard</Link>
            <h1 className="text-3xl font-extrabold mt-1">
              {ownerView ? 'Service Requests' : 'Laser Repair Requests'}
            </h1>
            <p className="text-sm text-[var(--text3)] mt-1">
              {ownerView
                ? 'Request service for your facility lasers. Separate from the marketplace.'
                : 'Open repair / PM needs from laser owners. Bid from request details.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/accepted-bids" className="btn btn-secondary text-sm">
              Accepted Bids
            </Link>
            <Link href="/notifications" className="btn btn-secondary text-sm">
              Notifications
            </Link>
            {(ownerView || !proView) && (
              <button type="button" className="btn btn-primary" onClick={openPost} disabled={!orgId && ownerView}>
                ＋ Post Service Request
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center text-[var(--text3)]">
            {ownerView ? 'No open service requests yet.' : 'No open repair jobs right now.'}
            {ownerView && (
              <div className="mt-4">
                <button type="button" className="btn btn-primary" onClick={openPost}>Post Service Request</button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="card p-5">
                <div className="flex justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-lg text-[var(--gold)]">{r.title || r.service_type || 'Service request'}</h3>
                    <p className="text-xs text-[var(--text3)] mt-1">
                      {[r.manufacturer, r.model].filter(Boolean).join(' ')}
                      {r.serial_number ? ` · SN ${r.serial_number}` : ''}
                      {(r.city || r.state || r.location)
                        ? ` · ${[r.city, r.state].filter(Boolean).join(', ') || r.location}`
                        : ''}
                      {r.urgency ? ` · ${r.urgency}` : ''}
                      {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <span
                    className={
                      'text-xs px-2 py-1 rounded capitalize h-fit font-semibold ' +
                      (String(r.status || '').toLowerCase() === 'awarded'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                        : 'bg-[var(--surface3)] text-[var(--text3)]')
                    }
                  >
                    {r.status || 'open'}
                  </span>
                </div>
                {r.description && (
                  <p className="text-sm mt-3 line-clamp-3">{r.description}</p>
                )}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border2)]">
                  <span className="text-sm text-[var(--text3)]">
                    <span className="text-[var(--gold)] font-semibold">{r.bid_count || 0}</span> bid{(r.bid_count || 0) !== 1 ? 's' : ''}
                  </span>
                  <Link href={`/marketplace/requests/${r.id}`} className="btn btn-secondary text-sm">
                    {proView ? 'View / Bid' : 'View details'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {postOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55" onClick={() => setPostOpen(false)}>
          <div
            className="bg-[var(--surface)] border border-[var(--border2)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-extrabold text-lg text-[var(--gold)] mb-1">Post Service Request</div>
            <p className="text-xs text-[var(--text3)] mb-4">
              Service companies can bid on this request. Not a marketplace listing.
            </p>

            <div className="space-y-3">
              <div>
                <label className="label">Model / System *</label>
                <select
                  className="input"
                  value={laserPick}
                  onChange={(e) => {
                    setLaserPick(e.target.value);
                    if (e.target.value !== OTHER_LASER) fillFromLaser(e.target.value);
                    else setDesc('');
                  }}
                >
                  {lasers.map((L) => (
                    <option key={L.id} value={String(L.id)}>
                      {[L.manufacturer, L.model].filter(Boolean).join(' ')}
                      {L.serial_number ? ` · SN ${L.serial_number}` : ''}
                      {L.room ? ` · ${L.room}` : ''}
                    </option>
                  ))}
                  <option value={OTHER_LASER}>Different laser (not in My Lasers)…</option>
                </select>
              </div>

              {laserPick === OTHER_LASER && (
                <>
                  <div>
                    <label className="label">Manufacturer *</label>
                    <select className="input" value={mfr} onChange={(e) => { setMfr(e.target.value); setModel(''); setModelOther(''); }}>
                      <option value="">Select brand…</option>
                      {mfrOptions.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Model *</label>
                    <select className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={!mfr}>
                      <option value="">Select model…</option>
                      {modelOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      <option value={OTHER_MODEL}>Other / not listed…</option>
                    </select>
                    {model === OTHER_MODEL && (
                      <input className="input mt-2" value={modelOther} onChange={(e) => setModelOther(e.target.value)} placeholder="Model name" />
                    )}
                  </div>
                  <div>
                    <label className="label">Serial #</label>
                    <input className="input" value={serial} onChange={(e) => setSerial(e.target.value)} />
                  </div>
                </>
              )}

              <div>
                <label className="label">Service type</label>
                <select className="input" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                  <option>Emergency Repair</option>
                  <option>PM</option>
                  <option>Install / Commission</option>
                  <option>Calibration</option>
                  <option>Full Contract</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="label">Urgency</label>
                <select className="input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Emergency</option>
                </select>
              </div>
              <div>
                <label className="label">Preferred date</label>
                <input className="input" type="date" value={preferred} onChange={(e) => setPreferred(e.target.value)} />
              </div>
              <div>
                <label className="label">Error codes</label>
                <input className="input" value={errorCodes} onChange={(e) => setErrorCodes(e.target.value)} />
              </div>
              <div>
                <label className="label">Description *</label>
                <textarea className="input min-h-[100px]" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setPostOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary flex-[2]" onClick={submitPost} disabled={saving}>
                {saving ? 'Posting…' : 'Post Service Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ServiceRequestsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">Loading…</div>
    }>
      <ServiceRequestsInner />
    </Suspense>
  );
}
