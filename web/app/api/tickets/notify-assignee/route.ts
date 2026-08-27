import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { sendTicketAssignedEmail } from '@/lib/ticket-assign-email';
import { ticketAssigneeId } from '@/lib/ticket-assignees';

function siteUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (env) return env.replace(/\/$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}`;
  return 'https://repairplanet.net';
}

function sameId(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

function displayName(row: { first_name?: string | null; last_name?: string | null; email?: string | null } | null): string {
  const name = [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim();
  return name || row?.email || 'Dispatcher';
}

function addressLine(ticket: any): string {
  return [ticket?.customer_address, ticket?.customer_city, ticket?.customer_state]
    .map((p: unknown) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * POST /api/tickets/notify-assignee
 * Emails the assigned FSE and writes an in-app notification.
 * Skips email when the assignee is the person creating/saving the ticket.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const ticketId = body.ticketId ?? body.ticket_id ?? null;
    if (ticketId == null || ticketId === '') {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const { data: caller } = await userClient
      .from('user_profiles')
      .select('id, organization_id, first_name, last_name, email, role')
      .eq('id', user.id)
      .maybeSingle();

    // Ticket must already be visible to this session (shop RLS or assigned_to).
    const { data: ticket, error: ticketErr } = await userClient
      .from('service_tickets')
      .select(
        'id, ticket_number, organization_id, assigned_to, customer_name, service_type, service_date, scheduled_time, priority, notes, description, customer_address, customer_city, customer_state'
      )
      .eq('id', ticketId)
      .maybeSingle();
    if (ticketErr || !ticket) {
      return NextResponse.json({ error: ticketErr?.message || 'Ticket not found' }, { status: 404 });
    }
    if (ticket.organization_id == null) {
      return NextResponse.json({ error: 'Ticket has no shop' }, { status: 403 });
    }

    const shopId = ticket.organization_id;
    let onShop = sameId(caller?.organization_id, shopId);
    if (!onShop) {
      const { data: mem } = await userClient
        .from('organization_memberships')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('organization_id', shopId)
        .maybeSingle();
      onShop = !!mem;
    }
    if (!onShop) {
      return NextResponse.json({ error: 'Not a member of this ticket’s shop' }, { status: 403 });
    }

    const assigneeId = String(
      body.assignedTo || body.assigned_to || ticketAssigneeId(ticket) || ''
    ).trim();
    if (!assigneeId) {
      return NextResponse.json({ ok: true, emailed: false, skipped: 'unassigned' });
    }
    if (sameId(assigneeId, user.id)) {
      return NextResponse.json({ ok: true, emailed: false, skipped: 'self' });
    }

    const writer = hasServiceRole() ? getSupabaseAdmin() : userClient;

    const { data: assigneeMem } = await writer
      .from('organization_memberships')
      .select('user_id')
      .eq('user_id', assigneeId)
      .eq('organization_id', shopId)
      .maybeSingle();
    let assigneeOnShop = !!assigneeMem;
    if (!assigneeOnShop) {
      const { data: assigneeProf } = await writer
        .from('user_profiles')
        .select('id, organization_id')
        .eq('id', assigneeId)
        .maybeSingle();
      assigneeOnShop = sameId(assigneeProf?.organization_id, shopId);
    }
    if (!assigneeOnShop) {
      return NextResponse.json({ error: 'Assignee is not on this shop' }, { status: 403 });
    }

    const { data: assignee } = await writer
      .from('user_profiles')
      .select('id, email, first_name, last_name')
      .eq('id', assigneeId)
      .maybeSingle();
    if (!assignee?.id) {
      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
    }

    let shopName = '';
    if (ticket.organization_id != null) {
      const { data: shop } = await writer
        .from('organizations')
        .select('name')
        .eq('id', ticket.organization_id)
        .maybeSingle();
      shopName = shop?.name || '';
    }

    const origin = siteUrl(req);
    const ticketUrl = `${origin}/service-tickets/${ticket.id}`;
    const copy = {
      assigneeFirstName: assignee.first_name || null,
      assignerName: displayName(caller),
      organizationName: shopName,
      ticketNumber: ticket.ticket_number || null,
      customerName: ticket.customer_name || null,
      serviceType: ticket.service_type || null,
      serviceDate: ticket.service_date || null,
      scheduledTime: ticket.scheduled_time ? String(ticket.scheduled_time).slice(0, 5) : null,
      priority: ticket.priority || null,
      addressLine: addressLine(ticket) || null,
      notes: ticket.notes || ticket.description || null,
      ticketUrl,
    };

    const to = String(assignee.email || '').trim();
    const emailed = await sendTicketAssignedEmail({ to, copy });

    try {
      await writer.from('notifications').insert({
        user_id: assigneeId,
        type: 'ticket_assigned',
        message: `${displayName(caller)} assigned you ${ticket.ticket_number || 'a service call'}${
          ticket.customer_name ? ` — ${ticket.customer_name}` : ''
        }.`,
        triggered_by: user.id,
        is_read: false,
        ticket_id: Number.isFinite(Number(ticket.id)) ? Number(ticket.id) : null,
        link: `/service-tickets/${ticket.id}`,
      });
    } catch (e) {
      console.warn('ticket assigned notification', e);
    }

    if (!emailed.ok) {
      return NextResponse.json({
        ok: true,
        emailed: false,
        notified: true,
        error: emailed.error,
        to: to || null,
      });
    }

    return NextResponse.json({ ok: true, emailed: true, notified: true, to });
  } catch (e: any) {
    console.error('notify-assignee', e);
    return NextResponse.json({ error: e?.message || 'Failed to notify assignee' }, { status: 500 });
  }
}
