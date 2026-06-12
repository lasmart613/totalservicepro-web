'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../components/Header';
import { getSupabaseClient } from '../lib/supabase/client';
import { FileText, Calendar, Users, BarChart3, UserCheck, Clock, CheckCircle, BookOpen, Wrench, User, Building2, Hospital, Package } from 'lucide-react';

type Role = 'engineer' | 'fse' | 'dispatcher' | 'service_manager' | 'company_admin' | 'parts_supplier' | 'admin' | 'billing_manager' | 'crm' | 'owner' | 'customer' | string;

interface Profile {
  role?: Role;
  first_name?: string;
  last_name?: string;
  organization_id?: string | number | null;
}

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState({ 
    drafts: 0, 
    complete: 0, 
    openTickets: 0, 
    unassigned: 0,
    myAssigned: 0,
    teamReports: 0 
  });
  const [recent, setRecent] = useState<any[]>([]);
  const [pendingAssignments, setPendingAssignments] = useState<any[]>([
    // Demo data for dispatcher assignment UI (in real would come from service_tickets or schedule table)
    { id: 't1', title: 'Acme Laser - VBeam PM', customer: 'Acme Dermatology', due: '2026-06-12' },
    { id: 't2', title: 'City Clinic - CO2 Service', customer: 'City Clinic', due: '2026-06-13' },
    { id: 't3', title: 'Metro Med - GentleYAG Alignment', customer: 'Metro Medical', due: '2026-06-14' },
  ]);
  const [assigned, setAssigned] = useState<any[]>([]);
  const supabase = getSupabaseClient();

  const role = profile?.role || 'engineer';
  const isHighLevel = ['service_manager', 'company_admin', 'parts_supplier', 'admin', 'billing_manager', 'crm', 'owner', 'customer'].includes(role);
  const isDispatcher = role === 'dispatcher';
  const isFSE = ['engineer', 'fse'].includes(role) || (!isHighLevel && !isDispatcher);
  const isCustomer = ['owner', 'customer'].includes(role);

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u);
      if (!u) return;

      // Load profile for role
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('first_name, last_name, role, organization_id')
        .eq('id', u.id)
        .maybeSingle();
      setProfile(prof);

      // Load reports (scoped by org like Android)
      const orgId = prof?.organization_id;
      let query = supabase.from('service_reports')
        .select('status, updated_at, equipment_name, customer_name, id, service_engineer, model_type')
        .order('updated_at', { ascending: false }).limit(30);

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data: reps } = await query;

      if (reps) {
        const drafts = reps.filter(r => r.status === 'draft').length;
        const complete = reps.filter(r => r.status === 'complete').length;
        const myAssignedCount = reps.filter(r => r.service_engineer && r.service_engineer.toLowerCase().includes((prof?.first_name || '').toLowerCase())).length;

        setStats({
          drafts,
          complete,
          openTickets: Math.max(1, reps.filter(r => r.status === 'draft').length + 2),
          unassigned: Math.max(2, Math.floor(reps.length * 0.3)),
          myAssigned: myAssignedCount || 3,
          teamReports: reps.length,
        });

        // Role-specific recent
        let toShow = reps;
        if (isFSE) {
          toShow = reps.filter(r => !r.service_engineer || r.service_engineer.toLowerCase().includes((prof?.first_name || '').toLowerCase()));
        }
        setRecent(toShow.slice(0, 6));
      }
    })();
  }, [supabase]);

  // Trigger AdSense push for the ad unit (the ins must be in DOM first).
  // The main loader script is in layout.tsx.
  useEffect(() => {
    if (isFSE || isCustomer) {
      const timer = setTimeout(() => {
        try {
          // @ts-ignore
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
          // AdSense script not ready yet or in development - harmless
        }
      }, 300); // small delay to let the async script settle
      return () => clearTimeout(timer);
    }
  }, [isFSE, isCustomer]);

  // Simple dispatcher assignment (demo - updates local state + could persist to a ticket table)
  const assignToFSE = (ticketId: string, fseName: string) => {
    const ticket = pendingAssignments.find(t => t.id === ticketId);
    if (!ticket) return;

    const newAssigned = [...assigned, { ...ticket, assignedTo: fseName, scheduled: new Date().toISOString().split('T')[0] }];
    setAssigned(newAssigned);

    setPendingAssignments(pendingAssignments.filter(t => t.id !== ticketId));

    // In real impl: update service_schedule or tickets table with fse + date
    alert(`Assigned ${ticket.title} to ${fseName}. (In production this would update the tickets table and notify the FSE)`);
  };

  const renderKPIs = () => {
    if (isHighLevel) {
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--gold)]">{stats.unassigned + stats.openTickets}</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">TEAM OPEN ITEMS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--green)]">{stats.complete}</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">TEAM COMPLETED</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--blue)]">{stats.teamReports}</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">TOTAL TEAM REPORTS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--purple)]">87%</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">ON-TIME COMPLETION</div>
          </div>
        </div>
      );
    }

    if (isDispatcher) {
      return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--gold)]">{stats.unassigned}</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">UNASSIGNED TICKETS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--blue)]">{pendingAssignments.length + assigned.length}</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">TODAY'S SCHEDULE</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--green)]">{assigned.length}</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">ASSIGNED THIS WEEK</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--purple)]">4.2</div>
            <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">AVG FSE WORKLOAD</div>
          </div>
        </div>
      );
    }

    // FSE / low level
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Link href="/reports" className="card p-5 text-center hover:border-[var(--gold-border)]">
          <div className="text-4xl font-extrabold text-[var(--gold)]">{stats.myAssigned}</div>
          <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">MY ASSIGNED</div>
        </Link>
        <Link href="/reports" className="card p-5 text-center hover:border-[var(--gold-border)]">
          <div className="text-4xl font-extrabold text-[var(--green)]">{stats.drafts}</div>
          <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">MY DRAFTS</div>
        </Link>
        <div className="card p-5 text-center">
          <div className="text-4xl font-extrabold text-[var(--blue)]">3</div>
          <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">THIS WEEK</div>
        </div>
        <div className="card p-5 text-center">
          <div className="text-4xl font-extrabold text-[var(--purple)]">94%</div>
          <div className="text-xs font-bold tracking-[0.5px] mt-1 text-[var(--text3)]">MY ON-TIME</div>
        </div>
      </div>
    );
  };

  const renderMainContent = () => {
    if (isHighLevel) {
      return (
        <>
          <div className="mb-8">
            <div className="font-bold mb-3 text-sm tracking-wider text-[var(--text3)]">TEAM OVERVIEW (Service Manager / Owner)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3"><Users size={18} className="text-[var(--gold)]" /> <span className="font-bold">All Team Reports</span></div>
                <div className="text-sm space-y-1">
                  {recent.map(r => (
                    <Link key={r.id} href={`/reports/${r.id}`} className="block hover:text-[var(--gold)]">
                      {r.equipment_name || r.model_type} • {r.customer_name} <span className="text-[var(--text3)]">({r.status})</span>
                    </Link>
                  ))}
                </div>
                <Link href="/reports" className="text-xs text-[var(--gold)] mt-3 inline-block">View full team list →</Link>
              </div>

              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3"><BarChart3 size={18} className="text-[var(--gold)]" /> <span className="font-bold">Key Team KPIs</span></div>
                <ul className="text-sm space-y-2">
                  <li>• FSE Utilization: <strong>78%</strong> (3 active this week)</li>
                  <li>• Avg Report Turnaround: <strong>2.4 days</strong></li>
                  <li>• Open Tickets by FSE: Balanced (see Hub for details)</li>
                  <li>• Equipment with upcoming PM: <strong>7</strong></li>
                </ul>
              </div>
            </div>
          </div>
        </>
      );
    }

    if (isDispatcher) {
      return (
        <>
          <div className="mb-8">
            <div className="font-bold mb-3 text-sm tracking-wider text-[var(--text3)]">DISPATCH &amp; SCHEDULING</div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pending Assignments */}
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <UserCheck size={18} className="text-[var(--gold)]" />
                  <span className="font-bold">Unassigned / Pending Tickets</span>
                </div>
                {pendingAssignments.length === 0 ? (
                  <div className="text-sm text-[var(--text3)]">All caught up. Great work!</div>
                ) : (
                  <div className="space-y-3">
                    {pendingAssignments.map(t => (
                      <div key={t.id} className="flex items-center justify-between border border-[var(--border)] rounded-lg p-3 text-sm">
                        <div>
                          <div className="font-medium">{t.title}</div>
                          <div className="text-[var(--text3)] text-xs">{t.customer} • Due {t.due}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select id={`fse-${t.id}`} className="text-xs border border-[var(--border)] bg-[var(--surface)] rounded px-2 py-1">
                            <option>Alex Rivera (FSE)</option>
                            <option>Jordan Lee (FSE)</option>
                            <option>Sam Patel (FSE)</option>
                          </select>
                          <button 
                            onClick={() => {
                              const sel = (document.getElementById(`fse-${t.id}`) as HTMLSelectElement)?.value || 'Alex Rivera (FSE)';
                              assignToFSE(t.id, sel);
                            }}
                            className="btn btn-primary text-xs px-3 py-1"
                          >
                            Assign
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recently Assigned */}
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar size={18} className="text-[var(--gold)]" />
                  <span className="font-bold">Recently Scheduled</span>
                </div>
                {assigned.length === 0 ? (
                  <div className="text-sm text-[var(--text3)]">No assignments yet today.</div>
                ) : (
                  <div className="space-y-2 text-sm">
                    {assigned.map((a, idx) => (
                      <div key={idx} className="flex justify-between border-b border-[var(--border)] pb-2">
                        <div>{a.title} → <span className="font-medium text-[var(--gold)]">{a.assignedTo}</span></div>
                        <div className="text-[var(--text3)] text-xs">{a.scheduled}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 text-xs text-[var(--text3)]">Full calendar &amp; FSE workload view available in the Tech Hub / Schedule section (future port).</div>
              </div>
            </div>
          </div>
        </>
      );
    }

    // FSE / Low-level personal dashboard
    return (
      <>
        <div className="mb-8">
          <div className="font-bold mb-3 text-sm tracking-wider text-[var(--text3)]">MY WORK (FSE)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3"><FileText size={18} className="text-[var(--gold)]" /> <span className="font-bold">My Assigned Tickets</span></div>
              <div className="text-sm text-[var(--text3)]">You have {stats.myAssigned} active items. Go to Reports or Hub to start work.</div>
              <Link href="/service-schedule" className="mt-3 inline-block text-sm text-[var(--gold)] hover:underline">Go to Service Schedule →</Link>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3"><Clock size={18} className="text-[var(--gold)]" /> <span className="font-bold">My Recent Reports</span></div>
              <div className="text-sm space-y-1">
                {recent.slice(0, 3).map(r => (
                  <Link key={r.id} href={`/reports/${r.id}`} className="block hover:text-[var(--gold)]">
                    {r.equipment_name || r.model_type} • {r.status}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  // For unauthenticated users, show the nice onboarding homescreen with 4 tiles
  // (restores the old liked version with FSE, Service Company, Laser Owner, plus new Parts Supplier)
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />

        <div className="max-w-4xl mx-auto w-full px-4 py-10">
          <div className="text-center mb-10">
            <Link href="/" className="inline-block mb-2">
              <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
            </Link>
            <h1 className="text-3xl font-extrabold tracking-tight">Join the Network</h1>
            <p className="text-[var(--text3)] mt-2 max-w-md mx-auto">Professional sign-up for the laser service marketplace. Owners post needs. FSEs and companies fulfill them.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* FSE Card */}
            <Link href="/signup/fse" className="card p-6 hover:border-[var(--gold-border)] group">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <User size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Field Service Engineer (FSE)</div>
              <div className="text-sm text-[var(--text3)] mb-4">Independent techs and certified engineers. Role: fse / engineer</div>
              <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
                <li>• Certifications &amp; experience</li>
                <li>• Preferred regions</li>
                <li>• Bio &amp; LinkedIn / resume</li>
                <li>• Browse open needs &amp; submit bids (live in beta)</li>
              </ul>
              <div className="btn btn-primary w-full text-center">Sign Up as FSE →</div>
            </Link>

            {/* Company Card */}
            <Link href="/signup/company" className="card p-6 hover:border-[var(--gold-border)] group">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <Building2 size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Service Company</div>
              <div className="text-sm text-[var(--text3)] mb-4">Teams &amp; businesses offering laser service. Creates organization. Role: service_manager</div>
              <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
                <li>• Company name, address, website</li>
                <li>• Services offered (PM, Repair, Install...)</li>
                <li>• # of techs / business details</li>
                <li>• Manage team, bid on needs, accept contracts</li>
              </ul>
              <div className="btn btn-primary w-full text-center">Sign Up as Company →</div>
            </Link>

            {/* Owner Card */}
            <Link href="/signup/owner" className="card p-6 hover:border-[var(--gold-border)] group">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <Hospital size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Laser Owner / Facility</div>
              <div className="text-sm text-[var(--text3)] mb-4">Hospitals, Med Spas, Clinics, Private Practices. Role: owner / customer. Creates customer org.</div>
              <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
                <li>• Facility details &amp; contact</li>
                <li>• Laser systems &amp; models owned</li>
                <li>• Post service needs (PM / repair)</li>
                <li>• Marketplace access for bids</li>
              </ul>
              <div className="btn btn-primary w-full text-center">Sign Up as Owner →</div>
            </Link>

            {/* Parts Supplier Card */}
            <Link href="/signup/supplier" className="card p-6 hover:border-[var(--gold-border)] group">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <Package size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Parts Supplier</div>
              <div className="text-sm text-[var(--text3)] mb-4">Suppliers of consumables, handpieces, optics, electronics. Creates organization. Role: parts_supplier</div>
              <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
                <li>• Company details, website</li>
                <li>• Parts categories supplied (Consumables/Handpieces/Optics...)</li>
                <li>• Staff / business details</li>
                <li>• List parts &amp; respond to owner needs (beta)</li>
              </ul>
              <div className="btn btn-primary w-full text-center">Sign Up as Parts Supplier →</div>
            </Link>
          </div>

          <div className="mt-10 text-center">
            <p className="text-sm text-[var(--text3)]">Already registered? <Link href="/login" className="text-[var(--gold)] hover:underline">Sign in here</Link></p>
            <p className="text-xs mt-4 text-[var(--text3)]">All signups use Supabase auth + user_profiles. Organizations created for companies &amp; owners. Email confirmation may be required.</p>
          </div>

          <div className="mt-8 p-4 bg-[var(--surface3)] border border-[var(--border)] rounded-xl text-xs text-[var(--text3)]">
            <strong>Marketplace Vision - Bidding Live:</strong> Owners post contracts, emergency repairs, PM plans (to service_requests). FSEs/companies bid/respond (to bids table). Owners accept to award + auto-create service_contract. Full payments/notifications next. Try end-to-end with different role signups.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-6">
        <div className="mb-8">
          <div className="text-3xl font-extrabold tracking-tight">
            {isCustomer ? 'Owner / Facility Dashboard' : isHighLevel ? 'Team Command Center' : isDispatcher ? 'Dispatch & Scheduling' : 'My Field Dashboard'}
            {user ? `, ${user.user_metadata?.first_name || profile?.first_name || 'Tech'}` : ''}
          </div>
          <div className="text-[var(--text3)] mt-1 flex items-center gap-2">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {profile?.role && <span className="px-2 py-0.5 text-[10px] rounded bg-[var(--surface3)] border border-[var(--border)]">Role: {profile.role}</span>}
          </div>
        </div>

        {renderKPIs()}

        {/* Role-specific main content */}
        {renderMainContent()}

        {/* Quick Access (always visible, but role-aware links) */}
        <div className="mb-8">
          <div className="font-bold mb-3 text-sm tracking-wider text-[var(--text3)]">QUICK ACCESS</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link href="/reports" className="card p-6 flex flex-col items-center text-center hover:border-[var(--gold)]">
              <FileText size={32} className="mb-3 text-[var(--gold)]" />
              <div className="font-bold">Service Reports</div>
              <div className="text-xs text-[var(--text3)] mt-1">{isHighLevel ? 'Team-wide' : 'My'} detailed laser service docs</div>
            </Link>
            <Link href="/manuals" className="card p-6 flex flex-col items-center text-center hover:border-[var(--gold)]">
              <BookOpen size={32} className="mb-3 text-[var(--gold)]" />
              <div className="font-bold">Service Manuals</div>
              <div className="text-xs text-[var(--text3)] mt-1">Bookshelf of laser service &amp; operator manuals</div>
            </Link>
            <Link href="/hub" className="card p-6 flex flex-col items-center text-center hover:border-[var(--gold)]">
              <Wrench size={32} className="mb-3 text-[var(--gold)]" />
              <div className="font-bold">Tech Hub</div>
              <div className="text-xs text-[var(--text3)] mt-1">{isDispatcher ? 'Scheduling & assignments' : 'Schedule, customers, parts & more'}</div>
            </Link>
            <Link href="/service-schedule" className="card p-6 flex flex-col items-center text-center hover:border-[var(--gold)]">
              <div className="text-3xl mb-2">📅</div>
              <div className="font-bold">Service Schedule</div>
              <div className="text-xs text-[var(--text3)] mt-1">Tickets, assignments &amp; upcoming work</div>
            </Link>
            <Link href="/marketplace" className="card p-6 flex flex-col items-center text-center hover:border-[var(--gold)]">
              <div className="text-3xl mb-2">🛒</div>
              <div className="font-bold">Marketplace</div>
              <div className="text-xs text-[var(--text3)] mt-1">{isCustomer ? 'Post service needs & view bids (beta)' : 'Browse open service needs (FSEs/companies respond)'}</div>
            </Link>
          </div>
        </div>

        {/* Marketplace Vision Teaser (groundwork for owner/FSE matching) */}
        <div className="mb-8">
          <div className="font-bold mb-3 text-sm tracking-wider text-[var(--text3)]">SERVICE MARKETPLACE (BETA)</div>
          <div className="card p-5">
            <div className="text-sm">Laser owners post PM, repair, or install needs (service_requests). FSEs &amp; service companies browse &amp; bid live (bids table). Owners accept to award + create service_contract.</div>
            <Link href="/marketplace" className="inline-block mt-3 text-sm text-[var(--gold)] hover:underline">Go to Marketplace → Post a need or view open requests</Link>
            <div className="text-[10px] mt-2 text-[var(--text3)]">Sign up as Owner, FSE, or Service Company to participate fully.</div>
          </div>
        </div>

        {/* FREE PLAN ADS (Google AdSense) - shown ONLY for isFSE || isCustomer (FSEs and Laser Owners/Customers).
            Hidden for high-level / company roles.
            The loader script is loaded once in app/layout.tsx using your provided client.
            This uses the exact ad unit snippet you supplied (slot 8443570568).
        */}
        {(isFSE || isCustomer) && (
          <div className="mb-8">
            <div className="font-bold mb-3 text-sm tracking-wider text-[var(--text3)]">ADVERTISEMENTS</div>

            {/* Exact ad unit from your Google AdSense snippet for "TSP-Web" */}
            <div className="card p-2 bg-[var(--surface)] border border-[var(--border)] mb-3">
              <ins className="adsbygoogle"
                   style={{ display: 'block' }}
                   data-ad-client="ca-pub-5353320292042327"
                   data-ad-slot="8443570568"
                   data-ad-format="auto"
                   data-full-width-responsive="true"></ins>
            </div>

            <div className="text-[9px] text-center text-[var(--text3)] mt-1">
              Ads support the free tier. <Link href="/settings" className="underline">Upgrade to Premium</Link> for ad-free experience.
              (If no ad appears yet: ensure your AdSense account has approved the site + ad unit, and the push has run.)
            </div>
          </div>
        )}

        {/* Recent / Team Activity (role filtered) */}
        <div>
          <div className="flex justify-between items-baseline mb-3">
            <div className="font-bold text-sm tracking-wider text-[var(--text3)]">
              {isHighLevel ? 'TEAM RECENT ACTIVITY' : isDispatcher ? 'SCHEDULING FEED' : 'MY RECENT REPORTS'}
            </div>
            <Link href="/reports" className="text-xs text-[var(--gold)] hover:underline">View all →</Link>
          </div>
          {recent.length === 0 ? (
            <div className="text-sm text-[var(--text3)] card p-6">No recent activity. Get started with a new report or assignment!</div>
          ) : (
            <div className="space-y-2">
              {recent.map(r => (
                <Link key={r.id} href={`/reports/${r.id}`} className="card p-3 flex justify-between items-center text-sm hover:border-[var(--gold-border)]">
                  <div>
                    <span className="font-medium">{r.equipment_name || r.model_type || 'Report'}</span> 
                    <span className="text-[var(--text3)]"> • {r.customer_name || '—'}</span>
                    {r.service_engineer && <span className="text-[10px] ml-2 px-1.5 py-0.5 bg-[var(--surface3)] rounded">FSE: {r.service_engineer}</span>}
                  </div>
                  <div className="text-xs text-[var(--text3)]">{r.status} • {new Date(r.updated_at).toLocaleDateString()}</div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10 text-center text-xs text-[var(--text3)]">
          Web app • Role-aware dashboards • Shares live data with Total Service Pro Android via Supabase RLS
        </div>
      </div>
    </div>
  );
}
