'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { LandingPage } from '@/components/landing/LandingPage';
import { Calendar, Wrench, Package, FileText, Zap, Building2, Settings } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  isAdmin,
  getDashboardPersona,
  type DashboardPersona,
} from '@/lib/roles';
import { orgTypeLabel, ownerDashboardHeading, ownerLabelKind, ownerProfileLabel, roleLabel } from '@/lib/labels';
import { applyPendingSignup, resolvePendingSignup } from '@/lib/pending-signup';
import { hasBrowserAuthHint } from '@/lib/auth-session';
import { useUpgradeEntry } from '@/lib/use-show-upgrade';
import { UpgradePlanLink } from '@/components/UpgradePlanLink';
import {
  isClosedTicketStatus,
  isCompleteReport,
  ticketDateYmd,
  toLocalYmd,
  upcomingOpenTickets,
} from '@/lib/tickets';

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [orgType, setOrgType] = useState<string | null>(null);
  const [facilityType, setFacilityType] = useState<string | null>(null);
  const [persona, setPersona] = useState<DashboardPersona>('service');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    openTickets: 0,
    todayCalls: 0,
    completedReports: 0,
    totalReports: 0,
    openServiceRequests: 0,
  });
  const [statsError, setStatsError] = useState<string | null>(null);
  const [ownerStats, setOwnerStats] = useState({
    lasers: 0,
    openRequests: 0,
    serviceHistory: 0,
    bidsReceived: 0,
  });
  const [supplierStats, setSupplierStats] = useState({
    catalog: 0,
    listings: 0,
    openDemand: 0,
    brands: 0,
  });
  const [fseStats, setFseStats] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [authHint, setAuthHint] = useState(false);
  const [authHintReady, setAuthHintReady] = useState(false);

  const supabase = getSupabaseClient();
  const upgrade = useUpgradeEntry();

  useEffect(() => {
    setAuthHint(hasBrowserAuthHint());
    setAuthHintReady(true);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      // localStorage session is enough to keep the dashboard up. getUser()
      // talks to Auth over the network and can sit on a slow link for seconds.
      const { data: { session } } = await supabase.auth.getSession();
      let u = session?.user ?? null;
      if (!u) {
        const { data: { user: verified } } = await supabase.auth.getUser();
        u = verified ?? null;
      }
      setUser(u);

      if (!u) {
        setLoading(false);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from('user_profiles')
        .select('first_name, role, organization_id, onboarding_completed')
        .eq('id', u.id)
        .maybeSingle();

      if (profErr) {
        console.warn('profile load', profErr);
        setStatsError(profErr.message);
      }
      setProfile(prof);

      if (!prof?.organization_id) {
        const pending = resolvePendingSignup(u);
        if (pending?.kind === 'owner') {
          try {
            await applyPendingSignup(supabase, u.id, pending);
            router.replace('/my-lasers?justSetup=1');
            return;
          } catch (e) {
            console.warn('owner first-run apply', e);
          }
        }
        router.replace('/onboarding');
        return;
      }
      if (prof.onboarding_completed === false) {
        const r = String(prof.role || '').toLowerCase();
        const invited = ['fse', 'engineer', 'dispatcher', 'scheduler', 'technician'].includes(r);
        const metaRole = String((u.user_metadata as any)?.role || '').toLowerCase();
        const ownerOrSupplier =
          r === 'owner' ||
          r === 'customer' ||
          r === 'parts_supplier' ||
          r === 'supplier' ||
          metaRole === 'owner' ||
          metaRole === 'parts_supplier';
        if (invited && !ownerOrSupplier) {
          router.replace('/onboarding/member');
          return;
        }
        // Owners/suppliers already have an org — do not send them through RSP onboarding.
        if (!ownerOrSupplier) {
          router.replace('/onboarding');
          return;
        }
      }

      if (!prof?.organization_id) {
        setPersona(getDashboardPersona(prof?.role));
        setLoading(false);
        return;
      }

      const orgId = prof.organization_id;

      let oType: string | null = null;
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('type, facility_type, supported_brands')
          .eq('id', orgId)
          .maybeSingle();
        oType = org?.type || (u.user_metadata as any)?.organization_type || null;
        setOrgType(oType);
        setFacilityType(org?.facility_type || (u.user_metadata as any)?.facility_type || null);
      } catch {
        /* ignore */
      }

      const dashPersona = getDashboardPersona(prof.role, oType);
      setPersona(dashPersona);

      if (dashPersona === 'owner') {
        await loadOwnerStats(orgId, u.id);
        setLoading(false);
        return;
      }

      if (dashPersona === 'supplier') {
        await loadSupplierStats(orgId, u.id);
        setLoading(false);
        return;
      }

      // Service company dashboard — tickets + reports (not reports masquerading as tickets)
      let kpiError: string | null = null;
      let openTickets = 0;
      let todayCalls = 0;
      let completedReports = 0;
      let totalReports = 0;

      try {
        const today = toLocalYmd(new Date());

        const { data: tickets, error: tErr } = await supabase
          .from('service_tickets')
          .select('id, status, service_date, assigned_to, customer_name, service_type, scheduled_time')
          .eq('organization_id', orgId)
          .limit(500);

        if (tErr) {
          console.warn('tickets KPI', tErr);
          kpiError = tErr.message;
        } else {
          const list = tickets || [];
          openTickets = list.filter((t) => !isClosedTicketStatus(t.status)).length;
          todayCalls = list.filter(
            (t) => ticketDateYmd(t.service_date) === today && !isClosedTicketStatus(t.status)
          ).length;
          setUpcoming(upcomingOpenTickets(list, today, 5));
        }
      } catch (e: any) {
        console.warn('tickets load failed', e);
        kpiError = e?.message || 'ticket load failed';
      }

      try {
        // service_reports has created_by (not assigned_to — that column is on service_tickets only)
        const { data: reports, error: rErr } = await supabase
          .from('service_reports')
          .select('status, created_by, service_engineer')
          .eq('organization_id', orgId)
          .limit(500);

        if (rErr) {
          console.warn('reports KPI', rErr);
          if (!kpiError) kpiError = rErr.message;
        } else if (reports) {
          totalReports = reports.length;
          completedReports = reports.filter((r) => isCompleteReport(r.status)).length;

          if (isAdmin(prof.role)) {
            const fseMap: { [key: string]: { name: string; open: number; completed: number } } = {};
            const fseIds = [
              ...new Set(
                reports
                  .map((r: any) => r.created_by)
                  .filter(Boolean)
              ),
            ] as string[];
            if (fseIds.length > 0) {
              const { data: fseUsers } = await supabase
                .from('user_profiles')
                .select('id, first_name, last_name')
                .in('id', fseIds);
              fseUsers?.forEach((fse) => {
                fseMap[fse.id] = {
                  name: `${fse.first_name || ''} ${fse.last_name || ''}`.trim() || 'Tech',
                  open: 0,
                  completed: 0,
                };
              });
            }
            reports.forEach((report: any) => {
              const uid = report.created_by;
              if (uid && fseMap[uid]) {
                if (isCompleteReport(report.status)) {
                  fseMap[uid].completed++;
                } else {
                  fseMap[uid].open++;
                }
              }
            });
            setFseStats(Object.values(fseMap));
          }
        }
      } catch (e) {
        console.warn('reports load failed', e);
      }

      // Open laser repair jobs (owners post via My Lasers → service_requests)
      let openServiceRequests = 0;
      try {
        const { data: openJobs, error: jobErr } = await supabase
          .from('service_requests')
          .select('id, status, category')
          .in('status', ['open', 'bidding'])
          .or('category.eq.service,category.is.null')
          .limit(500);
        if (jobErr) {
          console.warn('service_requests KPI', jobErr);
        } else {
          openServiceRequests = (openJobs || []).length;
        }
      } catch (e) {
        console.warn('service_requests load failed', e);
      }

      setStats({ openTickets, todayCalls, completedReports, totalReports, openServiceRequests });
      setStatsError(kpiError);
      setLoading(false);
    };

    loadData();
  }, [supabase]);

  async function loadOwnerStats(orgId: any, _userId: string) {
    let lasers = 0;
    let openRequests = 0;
    let serviceHistory = 0;
    let bidsReceived = 0;

    try {
      const { count } = await supabase
        .from('equipment')
        .select('id', { count: 'exact', head: true })
        .eq('customer_organization_id', orgId);
      lasers = count || 0;
    } catch { /* ignore */ }

    try {
      const { data: reqs } = await supabase
        .from('service_requests')
        .select('id, status, category')
        .eq('organization_id', orgId)
        .eq('status', 'open')
        .or('category.eq.service,category.is.null');
      openRequests = (reqs || []).length;
    } catch { /* ignore */ }

    try {
      const { data: reps } = await supabase
        .from('service_reports')
        .select('id, status, serial_number, customer_organization_id')
        .eq('status', 'complete')
        .limit(200);
      let list = reps || [];
      const byOrg = list.filter(
        r => r.customer_organization_id != null && String(r.customer_organization_id) === String(orgId)
      );
      if (byOrg.length) {
        list = byOrg;
      } else {
        const { data: eq } = await supabase
          .from('equipment')
          .select('serial_number')
          .eq('customer_organization_id', orgId);
        const serials = (eq || []).map(e => (e.serial_number || '').toLowerCase()).filter(Boolean);
        if (serials.length) {
          list = list.filter(r => serials.includes((r.serial_number || '').toLowerCase()));
        } else {
          list = [];
        }
      }
      serviceHistory = list.length;
    } catch { /* ignore */ }

    try {
      const { data: myReqs } = await supabase
        .from('service_requests')
        .select('id')
        .eq('organization_id', orgId);
      const ids = (myReqs || []).map(r => r.id);
      if (ids.length) {
        const { count } = await supabase
          .from('bids')
          .select('id', { count: 'exact', head: true })
          .in('request_id', ids);
        bidsReceived = count || 0;
      }
    } catch { /* ignore */ }

    setOwnerStats({ lasers, openRequests, serviceHistory, bidsReceived });
  }

  async function loadSupplierStats(orgId: any, userId: string) {
    let catalog = 0;
    let listings = 0;
    let openDemand = 0;
    let brands = 0;

    try {
      let q = supabase.from('parts_catalog').select('id, brand, manufacturer', { count: 'exact' });
      if (userId) q = q.eq('created_by', userId);
      const { data: parts, count } = await q;
      catalog = count != null ? count : (parts || []).length;
      const brandSet = new Set<string>();
      (parts || []).forEach((p: any) => {
        const b = p.brand || p.manufacturer;
        if (b) brandSet.add(String(b).toLowerCase());
      });
      brands = brandSet.size;
    } catch { /* ignore */ }

    try {
      const { data: myList } = await supabase
        .from('marketplace_listings')
        .select('id, status')
        .eq('seller_id', userId)
        .limit(200);
      listings = (myList || []).filter(
        (r: any) => !r.status || r.status === 'open' || r.status === 'active'
      ).length;
    } catch {
      try {
        const { data: myList2 } = await supabase
          .from('service_requests')
          .select('id, status, category, posted_by')
          .eq('posted_by', userId)
          .in('category', ['parts', 'consumables', 'equipment']);
        listings = (myList2 || []).filter(
          (r: any) => !r.status || r.status === 'open' || r.status === 'active'
        ).length;
      } catch { /* ignore */ }
    }

    try {
      const { data: dem } = await supabase
        .from('service_requests')
        .select('id, status, category')
        .eq('status', 'open')
        .in('category', ['parts', 'consumables']);
      openDemand = (dem || []).length;
    } catch { /* ignore */ }

    if (!brands && orgId) {
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('supported_brands')
          .eq('id', orgId)
          .maybeSingle();
        if (Array.isArray(org?.supported_brands)) brands = org.supported_brands.length;
      } catch { /* ignore */ }
    }

    setSupplierStats({ catalog, listings, openDemand, brands });
  }

  const showDashboardSplash = loading && (!!user || !authHintReady || authHint);

  if (showDashboardSplash) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header authPending />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  const role = profile?.role;
  const greetName = profile?.first_name || (persona === 'owner' || persona === 'supplier' ? 'there' : 'Tech');
  const labelKind = ownerLabelKind(orgType, facilityType, user?.user_metadata?.organization_type);
  const displayOrgType =
    labelKind === 'rental' ? 'laser_rental' : labelKind === 'reseller' ? 'laser_reseller' : orgType;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight">
              Welcome back, {greetName}!
            </h1>
            <p className="text-[var(--text3)]">
              Role: {roleLabel(role)}
              {displayOrgType ? <span> · Org: {orgTypeLabel(displayOrgType)}</span> : null}
            </p>
          </div>
          {upgrade.show && (
            <UpgradePlanLink
              className="btn btn-secondary text-sm px-4 py-1.5 shrink-0"
              target={upgrade.target}
            >
              Upgrade plan
            </UpgradePlanLink>
          )}
        </div>

        {/* ── Owner / facility KPIs ── */}
        {persona === 'owner' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
              <Link href="/my-lasers" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-[var(--gold)]">{ownerStats.lasers}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">MY LASERS</div>
              </Link>
              <Link href="/service-requests" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-[var(--blue)]">{ownerStats.openRequests}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">OPEN REQUESTS</div>
              </Link>
              <Link href="/reports" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-green-400">{ownerStats.serviceHistory}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">SERVICE HISTORY</div>
              </Link>
              <Link href="/service-requests" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-purple-400">{ownerStats.bidsReceived}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">BIDS RECEIVED</div>
              </Link>
            </div>

            <div className="mt-12">
              <h3 className="font-bold text-lg mb-4">
                {ownerDashboardHeading(orgType, facilityType, user?.user_metadata?.organization_type)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Link href="/my-lasers" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Zap size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">My Lasers</div>
                </Link>
                <Link href="/service-requests" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Wrench size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Service Requests</div>
                </Link>
                <Link href="/marketplace" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Marketplace</div>
                </Link>
                <Link href="/reports" className="card p-6 text-center hover:border-[var(--gold)]">
                  <FileText size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Service History</div>
                </Link>
                <Link href="/company" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Building2 size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">
                    {ownerProfileLabel(orgType, facilityType, user?.user_metadata?.organization_type)}
                  </div>
                </Link>
                <Link href="/settings" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Settings size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Settings</div>
                </Link>
              </div>
            </div>
          </>
        )}

        {/* ── Supplier KPIs ── */}
        {persona === 'supplier' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
              <Link href="/parts" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-[var(--gold)]">{supplierStats.catalog}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">CATALOG ITEMS</div>
              </Link>
              <Link href="/marketplace/my-listings" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-[var(--blue)]">{supplierStats.listings}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">MY LISTINGS</div>
              </Link>
              <Link href="/marketplace" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-purple-400">{supplierStats.openDemand}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">OPEN DEMAND</div>
              </Link>
              <Link href="/company" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-green-400">{supplierStats.brands}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">BRANDS STOCKED</div>
              </Link>
            </div>

            <div className="mt-12">
              <h3 className="font-bold text-lg mb-4">Supplier Dashboard</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link href="/parts" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Parts Catalog</div>
                </Link>
                <Link href="/marketplace" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Marketplace</div>
                </Link>
                <Link href="/company" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Building2 size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Supplier Profile</div>
                </Link>
                <Link href="/settings" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Settings size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Settings</div>
                </Link>
              </div>
            </div>
          </>
        )}

        {/* ── Service company KPIs + tools (unchanged structure) ── */}
        {persona === 'service' && (
          <>
            {statsError && (
              <div className="mt-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200">
                Some dashboard data could not load: {statsError}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8">
              <Link href="/service-schedule" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-[var(--gold)]">{stats.openTickets}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">OPEN TICKETS</div>
              </Link>
              <Link href="/service-schedule" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-[var(--blue)]">{stats.todayCalls}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">TODAY&apos;S CALLS</div>
              </Link>
              <Link href="/service-requests" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-orange-400">{stats.openServiceRequests}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">REPAIR REQUESTS</div>
              </Link>
              <Link href="/reports" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-green-400">{stats.completedReports}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">COMPLETED REPORTS</div>
              </Link>
              <Link href="/reports" className="card p-5 text-center hover:border-[var(--gold)]">
                <div className="text-4xl font-extrabold text-purple-400">{stats.totalReports}</div>
                <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">TOTAL REPORTS</div>
              </Link>
            </div>

            {isAdmin(role) && fseStats.length > 0 && (
              <div className="mt-10">
                <h3 className="font-bold text-lg mb-4">FSE Performance (Organization)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {fseStats.map((fse, index) => (
                    <div key={index} className="card p-5">
                      <div className="font-semibold mb-2">{fse.name || 'Unassigned FSE'}</div>
                      <div className="flex justify-between text-sm">
                        <span>Open reports:</span>
                        <span className="font-bold text-[var(--gold)]">{fse.open}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Completed reports:</span>
                        <span className="font-bold text-green-400">{fse.completed}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-10">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Calendar size={20} /> Upcoming Service Calls
              </h3>
              <div className="card p-0 overflow-hidden">
                {upcoming.length === 0 ? (
                  <div className="p-6">
                    <p className="text-[var(--text3)]">No upcoming scheduled calls.</p>
                    <Link href="/service-schedule" className="text-[var(--gold)] mt-4 inline-block hover:underline">
                      View Full Schedule →
                    </Link>
                  </div>
                ) : (
                  <ul>
                    {upcoming.map((t) => (
                      <li key={t.id} className="border-b border-[var(--border)] last:border-0">
                        <Link
                          href={`/service-tickets/${t.id}`}
                          className="block px-5 py-3 hover:bg-[var(--surface3)]"
                        >
                          <div className="font-semibold">
                            {(t.service_type || 'Service') + ' — ' + (t.customer_name || 'Customer')}
                          </div>
                          <div className="text-xs text-[var(--text3)] mt-0.5">
                            {ticketDateYmd(t.service_date)}
                            {t.scheduled_time ? ` · ${String(t.scheduled_time).slice(0, 5)}` : ''}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {upcoming.length > 0 && (
                  <div className="px-5 py-3">
                    <Link href="/service-schedule" className="text-sm text-[var(--gold)] hover:underline">
                      View Full Schedule →
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-12">
              <h3 className="font-bold text-lg mb-4">Quick Access · Tech</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link href="/calculators" className="card p-6 text-center hover:border-[var(--gold)]">
                  <div className="text-3xl mb-2">🔬</div>
                  <div className="font-bold">Photometry Tools</div>
                </Link>

                <Link href="/hub" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Wrench size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Tech Hub</div>
                </Link>

                <Link href="/service-schedule" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Calendar size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Service Schedule</div>
                </Link>

                <Link href="/marketplace" className="card p-6 text-center hover:border-[var(--gold)]">
                  <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Marketplace</div>
                </Link>

                <Link href="/directory" className="card p-6 text-center hover:border-[var(--gold)]">
                  <div className="text-3xl mb-2">📒</div>
                  <div className="font-bold">TSP Directory</div>
                  <div className="text-xs text-[var(--text3)] mt-1">Free listings</div>
                </Link>

                <Link href="/reports" className="card p-6 text-center hover:border-[var(--gold)]">
                  <FileText size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                  <div className="font-bold">Reports</div>
                </Link>

                {isAdmin(role) && (
                  <Link
                    href="/admin"
                    className="card p-6 text-center hover:border-[var(--gold)] border-2 border-[var(--gold)]/50"
                  >
                    <div className="text-3xl mb-2">🛡️</div>
                    <div className="font-bold">Admin Portal</div>
                    <div className="text-xs text-[var(--text3)] mt-1">Team & Settings</div>
                  </Link>
                )}
              </div>
            </div>

            {(isAdmin(role) ||
              ['service_manager', 'dispatcher', 'scheduler', 'billing_manager'].includes(
                (role || '').toLowerCase()
              )) && (
              <div className="mt-12">
                <h3 className="font-bold text-lg mb-4">💼 Business Management</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Link href="/customers" className="card p-6 text-center hover:border-[var(--gold)]">
                    <div className="text-3xl mb-2">👥</div>
                    <div className="font-bold">Customers</div>
                    <div className="text-xs text-[var(--text3)] mt-1">Directory & profiles</div>
                  </Link>
                  <Link href="/estimates" className="card p-6 text-center hover:border-[var(--gold)]">
                    <div className="text-3xl mb-2">📝</div>
                    <div className="font-bold">Estimates</div>
                    <div className="text-xs text-[var(--text3)] mt-1">Quotes & service estimates</div>
                  </Link>
                  <Link href="/invoices" className="card p-6 text-center hover:border-[var(--gold)]">
                    <div className="text-3xl mb-2">🧾</div>
                    <div className="font-bold">Invoices</div>
                    <div className="text-xs text-[var(--text3)] mt-1">Billing & collections</div>
                  </Link>
                  <Link href="/purchase-orders" className="card p-6 text-center hover:border-[var(--gold)]">
                    <div className="text-3xl mb-2">📦</div>
                    <div className="font-bold">Purchase Orders</div>
                    <div className="text-xs text-[var(--text3)] mt-1">Email POs to parts suppliers</div>
                  </Link>
                  <Link href="/company" className="card p-6 text-center hover:border-[var(--gold)]">
                    <Building2 size={32} className="mx-auto mb-3 text-[var(--gold)]" />
                    <div className="font-bold">Company Profile</div>
                    <div className="text-xs text-[var(--text3)] mt-1">Org, team & branding</div>
                  </Link>
                </div>
              </div>
            )}

            <div className="mt-12">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">Marketplace</h3>
                <Link href="/marketplace" className="text-sm text-[var(--gold)] hover:underline">Browse all →</Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Link href="/marketplace/parts" className="card p-6 hover:border-[var(--gold)] group">
                  <div className="text-3xl mb-3">🔩</div>
                  <div className="font-bold text-lg mb-1">Parts</div>
                  <div className="text-sm text-[var(--text3)]">Parts listed for sale by suppliers</div>
                </Link>

                <Link href="/marketplace/used-systems" className="card p-6 hover:border-[var(--gold)] group">
                  <div className="text-3xl mb-3">🖥️</div>
                  <div className="font-bold text-lg mb-1">Used Laser Systems</div>
                  <div className="text-sm text-[var(--text3)]">Buy or sell pre-owned equipment</div>
                </Link>

                <Link href="/marketplace/consumables" className="card p-6 hover:border-[var(--gold)] group">
                  <div className="text-3xl mb-3">🧴</div>
                  <div className="font-bold text-lg mb-1">Consumables</div>
                  <div className="text-sm text-[var(--text3)]">Handpieces, fibers, tips & more</div>
                </Link>

                <Link href="/service-requests" className="card p-6 hover:border-[var(--gold)] group">
                  <div className="text-3xl mb-3">🛠️</div>
                  <div className="font-bold text-lg mb-1">Laser Repair Jobs</div>
                  <div className="text-sm text-[var(--text3)]">
                    Open repair requests ({stats.openServiceRequests}) — bid from here
                  </div>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
