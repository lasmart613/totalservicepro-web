'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isOwnerish } from '@/lib/roles';

type Row = {
  id: string;
  title?: string | null;
  status?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  city?: string | null;
  state?: string | null;
  awarded_at?: string | null;
  facility_contact?: any;
  provider_contact?: any;
  awarded_bid_id?: string | null;
  bid?: any;
};

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function AcceptedBidsPage() {
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<'owner' | 'provider'>('provider');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('role, organization_id, organizations(type)')
        .eq('id', user.id)
        .maybeSingle();
      const owner = isOwnerish(prof?.role, (prof?.organizations as any)?.type);
      setMode(owner ? 'owner' : 'provider');

      if (owner && prof?.organization_id) {
        const { data: reqs } = await supabase
          .from('service_requests')
          .select('*')
          .eq('organization_id', prof.organization_id)
          .eq('status', 'awarded')
          .order('awarded_at', { ascending: false })
          .limit(50);
        const list = (reqs || []) as Row[];
        // attach winning bids
        for (const r of list) {
          if (r.awarded_bid_id) {
            const { data: b } = await supabase.from('bids').select('*').eq('id', r.awarded_bid_id).maybeSingle();
            r.bid = b;
          } else {
            const { data: b } = await supabase
              .from('bids')
              .select('*')
              .eq('request_id', r.id)
              .eq('status', 'accepted')
              .maybeSingle();
            r.bid = b;
          }
        }
        setRows(list);
      } else {
        // Provider: bids I won
        const { data: won } = await supabase
          .from('bids')
          .select('*')
          .eq('status', 'accepted')
          .or(`bidder_id.eq.${user.id},bidder_user_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(50);
        const list: Row[] = [];
        for (const b of won || []) {
          if (!b.request_id) continue;
          const { data: req } = await supabase
            .from('service_requests')
            .select('*')
            .eq('id', b.request_id)
            .maybeSingle();
          if (req) list.push({ ...req, bid: b });
        }
        setRows(list);
      }
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <Link href="/" className="text-sm text-[var(--gold)] hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-extrabold mt-1">Accepted Bids</h1>
        <p className="text-sm text-[var(--text3)] mt-1 mb-6">
          {mode === 'owner'
            ? 'Jobs you awarded. Service company contact is available on each job.'
            : 'Jobs you won. Customer contact is revealed after the facility accepts your bid.'}
        </p>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center text-[var(--text3)]">
            No accepted bids yet.
            <div className="mt-4">
              <Link href="/service-requests" className="btn btn-primary">
                Service Requests
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => {
              const total = r.bid?.price ?? r.bid?.amount;
              const contact =
                mode === 'owner' ? r.provider_contact : r.facility_contact;
              return (
                <div
                  key={r.id}
                  className="card p-5 border border-green-500/30 bg-green-500/5"
                >
                  <div className="flex justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-green-400">
                        Awarded
                      </div>
                      <h2 className="font-bold text-lg text-[var(--gold)]">
                        {r.title || 'Service request'}
                      </h2>
                      <p className="text-xs text-[var(--text3)] mt-1">
                        {[r.manufacturer, r.model].filter(Boolean).join(' ')}
                        {(r.city || r.state)
                          ? ` · ${[r.city, r.state].filter(Boolean).join(', ')}`
                          : ''}
                        {r.awarded_at
                          ? ` · ${new Date(r.awarded_at).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-extrabold text-green-400">{money(total)}</div>
                      {r.bid && (
                        <div className="text-[10px] text-[var(--text3)] mt-1">
                          {r.bid.labor_amount != null && `Labor ${money(r.bid.labor_amount)} · `}
                          {r.bid.parts_amount != null && `Parts ${money(r.bid.parts_amount)}`}
                        </div>
                      )}
                    </div>
                  </div>

                  {contact && (
                    <div className="mt-4 p-3 rounded-lg bg-[var(--surface3)] text-sm">
                      <div className="font-semibold text-[var(--gold)] mb-1">
                        {mode === 'owner' ? 'Service company' : 'Customer / facility'}
                      </div>
                      <div className="font-bold">
                        {contact.name || contact.company_name || contact.contact_person || '—'}
                      </div>
                      {(contact.phone || contact.company_phone || contact.contact_phone) && (
                        <div>
                          Phone:{' '}
                          <a
                            className="text-[var(--gold)]"
                            href={`tel:${contact.phone || contact.company_phone || contact.contact_phone}`}
                          >
                            {contact.phone || contact.company_phone || contact.contact_phone}
                          </a>
                        </div>
                      )}
                      {(contact.email || contact.company_email || contact.contact_email) && (
                        <div>
                          Email:{' '}
                          <a
                            className="text-[var(--gold)]"
                            href={`mailto:${contact.email || contact.company_email || contact.contact_email}`}
                          >
                            {contact.email || contact.company_email || contact.contact_email}
                          </a>
                        </div>
                      )}
                      {[contact.address, contact.city, contact.state, contact.zip]
                        .filter(Boolean)
                        .length > 0 && (
                        <div>
                          {[contact.address, contact.city, contact.state, contact.zip]
                            .filter(Boolean)
                            .join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3">
                    <Link
                      href={`/marketplace/requests/${r.id}`}
                      className="btn btn-secondary text-sm"
                    >
                      Open job details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
