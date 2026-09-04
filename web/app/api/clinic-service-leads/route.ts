import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  clinicLeadConfirmationHtml,
  clinicLeadConfirmationSubject,
  clinicLeadConfirmationText,
  clinicLeadConfirmReplyTo,
  clinicLeadFromAddress,
  clinicLeadHtml,
  clinicLeadSubject,
  clinicLeadText,
  parseClinicLead,
  planClinicLeadMail,
} from '@/lib/clinic-service-lead';

export const dynamic = 'force-dynamic';

const recentByIp = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = (recentByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    recentByIp.set(ip, prev);
    return true;
  }
  prev.push(now);
  recentByIp.set(ip, prev);
  return false;
}

async function sendResendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const to = opts.to.filter(Boolean);
  if (!to.length) return { ok: false, error: 'No recipients' };
  const from = clinicLeadFromAddress();
  const body: Record<string, unknown> = {
    from,
    to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true };
}

async function confirmationAlreadySent(opts: {
  email: string;
  description: string;
}): Promise<boolean> {
  if (!hasServiceRole()) return false;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('clinic_service_leads')
      .select('id')
      .eq('email', opts.email)
      .eq('description', opts.description)
      .eq('confirmation_sent', true)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * POST /api/clinic-service-leads
 * Guest clinic lead from the logged-out landing. Persists when the service
 * role is available, emails the product inbox + QA, and sends one
 * confirmation when the clinic left a valid email. Does not require TSP
 * registration and does not post a marketplace RFQ.
 */
export async function POST(req: NextRequest) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: 'Too many requests from this network. Try again in a few minutes.' },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseClinicLead({
      clinicName: body.clinicName ?? body.clinic_name ?? body.organization,
      location: body.location ?? body.city ?? body.zip,
      contactName: body.contactName ?? body.contact_name ?? body.name,
      email: body.email,
      phone: body.phone,
      manufacturer: body.manufacturer ?? body.brand ?? body.equipment,
      description: body.description ?? body.problem,
      urgency: body.urgency,
      website: body.website,
      companyWebsite: body.companyWebsite ?? body.company_website,
    });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (parsed.spam) {
      return NextResponse.json({
        ok: true,
        stored: false,
        emailed: false,
        confirmed: false,
        message: 'Thanks — we received your request.',
      });
    }

    const alreadySent = parsed.lead.email
      ? await confirmationAlreadySent({
          email: parsed.lead.email,
          description: parsed.lead.description,
        })
      : false;
    const plan = planClinicLeadMail({
      email: parsed.lead.email,
      confirmationAlreadySent: alreadySent,
    });

    const subject = clinicLeadSubject(parsed.lead);
    const text = clinicLeadText({
      lead: parsed.lead,
      confirmationSent: !!plan.confirmationTo,
    });
    const html = clinicLeadHtml({
      lead: parsed.lead,
      confirmationSent: !!plan.confirmationTo,
    });

    let stored = false;
    let storedId: string | null = null;
    if (hasServiceRole()) {
      try {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin
          .from('clinic_service_leads')
          .insert({
            clinic_name: parsed.lead.clinicName,
            location: parsed.lead.location,
            contact_name: parsed.lead.contactName,
            email: parsed.lead.email,
            phone: parsed.lead.phone,
            manufacturer: parsed.lead.manufacturer,
            description: parsed.lead.description,
            urgency: parsed.lead.urgency,
            source: 'landing',
            user_agent: String(body.userAgent ?? body.user_agent ?? '').trim().slice(0, 500) || null,
            confirmation_sent: false,
          })
          .select('id')
          .maybeSingle();
        if (!error) {
          stored = true;
          storedId = data?.id ? String(data.id) : null;
        } else if (!/schema cache|does not exist|relation/i.test(error.message || '')) {
          console.error('[clinic-service-leads] persist', error.message);
        }
      } catch (e) {
        console.error('[clinic-service-leads] persist', e);
      }
    }

    const delivered = await sendResendEmail({
      to: plan.teamRecipients,
      subject,
      html,
      text,
      replyTo: parsed.lead.email || undefined,
    });
    if (delivered.ok && stored && storedId && hasServiceRole()) {
      try {
        await getSupabaseAdmin()
          .from('clinic_service_leads')
          .update({ delivered_to_inbox: true })
          .eq('id', storedId);
      } catch {
        /* ignore */
      }
    }

    if (!delivered.ok && !stored) {
      console.error('[clinic-service-leads] undelivered', {
        clinic: parsed.lead.clinicName,
        location: parsed.lead.location,
        inboxError: delivered.error,
      });
      return NextResponse.json(
        {
          error:
            'Could not reach the RepairPlanet team yet. Try again, or write contact@medicalrepairnetwork.com.',
        },
        { status: 503 }
      );
    }

    let confirmed = false;
    if (plan.confirmationTo) {
      const confirm = await sendResendEmail({
        to: [plan.confirmationTo],
        subject: clinicLeadConfirmationSubject(),
        html: clinicLeadConfirmationHtml(),
        text: clinicLeadConfirmationText(),
        replyTo: clinicLeadConfirmReplyTo(),
      });
      confirmed = confirm.ok;
      if (!confirm.ok) {
        console.error('[clinic-service-leads] confirmation', confirm.error);
      } else if (stored && storedId && hasServiceRole()) {
        try {
          await getSupabaseAdmin()
            .from('clinic_service_leads')
            .update({ confirmation_sent: true })
            .eq('id', storedId);
        } catch {
          /* ignore */
        }
      }
    }

    console.info('[clinic-service-leads] accepted', {
      stored,
      emailed: delivered.ok,
      confirmed,
      location: parsed.lead.location,
    });

    return NextResponse.json({
      ok: true,
      stored,
      emailed: delivered.ok,
      confirmed,
      message: plan.confirmationTo
        ? 'Thanks — RepairPlanet has your request. We emailed you a confirmation.'
        : 'Thanks — RepairPlanet has your request. A nearby shop will be matched.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not send request';
    console.error('[clinic-service-leads]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
