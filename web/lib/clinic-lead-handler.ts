/**
 * Core of POST /api/clinic-service-leads (the route only rate-limits and
 * wraps this in NextResponse). Guest clinic lead from the logged-out landing.
 * Inserts a new clinic/owner organizations row (never updates live orgs), a
 * real service_requests row linked to that org, and a clinic_service_leads
 * audit row. Emails the product inbox + QA, and sends one confirmation when
 * the clinic left a valid email. Does not require TSP registration. Does not
 * invent posted_by.
 *
 * Logs never carry the clinic name, location, contact, email or phone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clinicLeadConfirmationHtml,
  clinicLeadConfirmationSubject,
  clinicLeadConfirmationText,
  clinicLeadConfirmReplyTo,
  clinicLeadFromAddress,
  clinicLeadHtml,
  clinicLeadSubject,
  clinicLeadText,
  insertOrganizationFromClinicLead,
  insertServiceRequestFromClinicLead,
  parseClinicLead,
  planClinicLeadMail,
} from './clinic-service-lead.ts';
import {
  CONFIRMATION_CLAIM_STALE_MS,
  clinicLeadConfirmationKey,
  isConfirmationKeyConflict,
  isLeadsTableMissing,
  isUnknownColumnError,
  shouldSendConfirmation,
} from './clinic-lead-confirmation.ts';
import { sendResendEmail, type ResendMail } from './clinic-lead-mail.ts';

export type ClinicLeadDeps = {
  /** null when the service role is not configured. */
  admin: SupabaseClient | null;
  now?: () => Date;
  send?: (mail: ResendMail) => Promise<{ ok: boolean; error?: string }>;
};

export type ClinicLeadResult = { status: number; body: Record<string, unknown> };

const GENERIC_500 = 'Could not send request. Try again, or write contact@medicalrepairnetwork.com.';

export async function handleClinicLeadPost(
  body: Record<string, unknown>,
  deps: ClinicLeadDeps
): Promise<ClinicLeadResult> {
  const now = deps.now ?? (() => new Date());
  const send = deps.send ?? ((mail: ResendMail) => sendResendEmail(mail));
  const admin = deps.admin;
  try {
    const parsed = parseClinicLead({
      clinicName: body.clinicName ?? body.clinic_name ?? body.organization,
      location: body.location ?? body.city ?? body.zip,
      contactName: body.contactName ?? body.contact_name ?? body.name,
      email: body.email,
      phone: body.phone,
      equipmentType: body.equipmentType ?? body.equipment_type,
      equipmentTypeOther: body.equipmentTypeOther ?? body.equipment_type_other,
      manufacturer: body.manufacturer ?? body.brand,
      model: body.model,
      serialNumber: body.serialNumber ?? body.serial_number,
      serviceType: body.serviceType ?? body.service_type,
      description: body.description ?? body.problem,
      urgency: body.urgency,
      preferredDate: body.preferredDate ?? body.preferred_date,
      errorCodes: body.errorCodes ?? body.error_codes,
      website: body.website,
      companyWebsite: body.companyWebsite ?? body.company_website,
    });
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    if (parsed.spam) {
      return {
        status: 200,
        body: { ok: true, stored: false, emailed: false, confirmed: false, message: 'Thanks — we received your request.' },
      };
    }
    const lead = parsed.lead;

    // One confirmation per (email, description, UTC day): the unique
    // confirmation_key on clinic_service_leads (000930) is the claim.
    const confirmationKey = clinicLeadConfirmationKey(lead.email, lead.description, now());
    let claimedKey = false;
    let lostClaim = false;

    let stored = false;
    let storedId: string | null = null;
    let organizationId: string | number | null = null;
    let serviceRequestId: string | null = null;
    if (admin) {
      try {
        // Always INSERT a new clinic/owner org. Never update/upsert live orgs.
        const org = await insertOrganizationFromClinicLead(admin, lead);
        if ('id' in org) organizationId = org.id;
        else console.error('[clinic-service-leads] organization', org.error);

        if (organizationId != null) {
          const sr = await insertServiceRequestFromClinicLead(admin, lead, organizationId);
          if ('id' in sr) serviceRequestId = sr.id;
          else console.error('[clinic-service-leads] service_requests', sr.error);
        }

        const leadRow: Record<string, unknown> = {
          clinic_name: lead.clinicName,
          location: lead.location,
          contact_name: lead.contactName,
          email: lead.email,
          phone: lead.phone,
          equipment_type: lead.equipmentType,
          equipment_type_other: lead.equipmentTypeOther,
          manufacturer: lead.manufacturer,
          model: lead.model,
          description: lead.description,
          urgency: lead.urgency,
          source: 'landing',
          user_agent: String(body.userAgent ?? body.user_agent ?? '').trim().slice(0, 500) || null,
          confirmation_sent: false,
          organization_id: organizationId,
          service_request_id: serviceRequestId,
          confirmation_key: confirmationKey,
          claimed_at: confirmationKey ? now().toISOString() : null,
        };
        const insert = () =>
          admin.from('clinic_service_leads').insert(leadRow).select('id').maybeSingle();
        let { data, error } = await insert();
        if (error && isConfirmationKeyConflict(error) && confirmationKey) {
          // Retake a stale claim (claimed long ago, never marked sent).
          const cutoff = new Date(now().getTime() - CONFIRMATION_CLAIM_STALE_MS).toISOString();
          const freed = await admin
            .from('clinic_service_leads')
            .update({ confirmation_key: null, claimed_at: null })
            .eq('confirmation_key', confirmationKey)
            .eq('confirmation_sent', false)
            .lt('claimed_at', cutoff)
            .select('id');
          if (freed.error) console.error('[clinic-service-leads] stale claim check', freed.error.message);
          if (!freed.error && Array.isArray(freed.data) && freed.data.length > 0) {
            leadRow.claimed_at = now().toISOString();
            ({ data, error } = await insert());
          }
        }
        if (error && isConfirmationKeyConflict(error)) {
          // Same request already claimed today: keep the row, skip the email.
          lostClaim = true;
          leadRow.confirmation_key = null;
          leadRow.claimed_at = null;
          ({ data, error } = await insert());
        }
        if (error && isUnknownColumnError(error)) {
          // Older schema only (42703 / PGRST204). Not FK, NOT NULL or checks.
          delete leadRow.organization_id;
          delete leadRow.service_request_id;
          delete leadRow.model;
          delete leadRow.confirmation_key;
          delete leadRow.claimed_at;
          ({ data, error } = await insert());
        }
        if (!error) {
          stored = true;
          storedId = data?.id ? String(data.id) : null;
          claimedKey = !lostClaim && leadRow.confirmation_key != null && storedId != null;
        } else if (isLeadsTableMissing(error)) {
          console.warn('[clinic-service-leads] clinic_service_leads missing; lead not stored, no confirmation dedupe');
        } else {
          console.error('[clinic-service-leads] persist', error.code, error.message);
        }
      } catch (e) {
        console.error('[clinic-service-leads] persist', e);
      }
    }

    // From here on, a claim is released unless the confirmation really went
    // out: send failure, a thrown/timeout fetch, the 503 path or any throw.
    let confirmationDelivered = false;
    try {
      const plan = planClinicLeadMail({
        email: lead.email,
        confirmationAlreadySent: !shouldSendConfirmation({ email: lead.email, stored, claimedKey, lostClaim }),
      });

      const delivered = await send({
        from: clinicLeadFromAddress(),
        to: plan.teamRecipients,
        subject: clinicLeadSubject(lead),
        html: clinicLeadHtml({ lead, confirmationSent: !!plan.confirmationTo, organizationId, serviceRequestId }),
        text: clinicLeadText({ lead, confirmationSent: !!plan.confirmationTo, organizationId, serviceRequestId }),
        replyTo: lead.email || undefined,
      });
      if (!delivered.ok) console.error('[clinic-service-leads] team email', delivered.error);
      if (delivered.ok && stored && storedId && admin) {
        const { error } = await admin.from('clinic_service_leads').update({ delivered_to_inbox: true }).eq('id', storedId);
        if (error) console.error('[clinic-service-leads] delivered_to_inbox', error.message);
      }

      if (admin && !serviceRequestId) {
        console.error('[clinic-service-leads] missing service_requests row', { organizationId, leadId: storedId });
        return {
          status: 503,
          body: { error: 'Could not create the service request yet. Try again, or write contact@medicalrepairnetwork.com.' },
        };
      }

      if (!delivered.ok && !stored && organizationId == null && !serviceRequestId) {
        console.error('[clinic-service-leads] undelivered', { inboxError: delivered.error });
        return {
          status: 503,
          body: { error: 'Could not reach the RepairPlanet team yet. Try again, or write contact@medicalrepairnetwork.com.' },
        };
      }

      let confirmed = false;
      if (plan.confirmationTo) {
        const confirm = await send({
          from: clinicLeadFromAddress(),
          to: [plan.confirmationTo],
          subject: clinicLeadConfirmationSubject(),
          html: clinicLeadConfirmationHtml(),
          text: clinicLeadConfirmationText(),
          replyTo: clinicLeadConfirmReplyTo(),
        });
        confirmed = confirm.ok;
        if (!confirm.ok) {
          console.error('[clinic-service-leads] confirmation', confirm.error);
        } else {
          confirmationDelivered = true;
          if (stored && storedId && admin) {
            const { error } = await admin.from('clinic_service_leads').update({ confirmation_sent: true }).eq('id', storedId);
            if (error) console.error('[clinic-service-leads] confirmation_sent flag', error.message);
          }
        }
      }

      console.info('[clinic-service-leads] accepted', {
        stored,
        organizationCreated: organizationId != null,
        serviceRequestCreated: !!serviceRequestId,
        emailed: delivered.ok,
        confirmed,
      });

      return {
        status: 200,
        body: {
          ok: true,
          stored,
          organizationCreated: organizationId != null,
          serviceRequestCreated: !!serviceRequestId,
          emailed: delivered.ok,
          confirmed,
          message: plan.confirmationTo
            ? 'Thanks — RepairPlanet has your request. We emailed you a confirmation.'
            : 'Thanks — RepairPlanet has your request. A nearby shop will be matched.',
        },
      };
    } finally {
      if (claimedKey && !confirmationDelivered && storedId && admin) {
        await releaseClaim(admin, storedId);
      }
    }
  } catch (e) {
    console.error('[clinic-service-leads]', e);
    return { status: 500, body: { error: GENERIC_500 } };
  }
}

/** Free the claim so a retry can confirm. Errors are logged, never thrown. */
export async function releaseClaim(admin: SupabaseClient, leadId: string): Promise<boolean> {
  try {
    const { error } = await admin
      .from('clinic_service_leads')
      .update({ confirmation_key: null, claimed_at: null })
      .eq('id', leadId);
    if (error) {
      console.error('[clinic-service-leads] release claim failed', leadId, error.code, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[clinic-service-leads] release claim threw', leadId, e);
    return false;
  }
}
