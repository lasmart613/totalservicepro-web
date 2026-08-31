import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  isValidUnsubscribeToken,
  parseUnsubscribePostBody,
  shopInviteUnsubscribePageHtml,
  unsubscribePageHeaders,
  type UnsubscribePageStatus,
} from '@/lib/shop-invite-unsubscribe';

export const dynamic = 'force-dynamic';

function htmlResponse(status: UnsubscribePageStatus, token: string | null, httpStatus = 200) {
  return new NextResponse(shopInviteUnsubscribePageHtml({ status, token }), {
    status: httpStatus,
    headers: unsubscribePageHeaders(token),
  });
}

function tokenFromRequest(req: NextRequest, bodyToken = ''): string {
  const url = new URL(req.url);
  return String(url.searchParams.get('token') || bodyToken || '').trim();
}

async function markUnsubscribed(
  token: string
): Promise<UnsubscribePageStatus> {
  if (!isValidUnsubscribeToken(token)) return 'invalid';
  if (!hasServiceRole()) return 'missing';

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('god_email_sends')
      .select('id, unsubscribed_at')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (error) {
      if (/column|does not exist|schema cache/i.test(error.message || '')) return 'missing';
      return 'invalid';
    }
    if (!data?.id) return 'invalid';
    if (data.unsubscribed_at) return 'already';

    const { error: updateError } = await admin
      .from('god_email_sends')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('id', data.id)
      .is('unsubscribed_at', null);

    if (updateError) {
      if (/column|does not exist|schema cache/i.test(updateError.message || '')) return 'missing';
      return 'invalid';
    }
    return 'done';
  } catch {
    return 'missing';
  }
}

/**
 * GET /unsubscribe?token=…
 * Human confirmation form. Public. Does not send mail.
 */
export async function GET(req: NextRequest) {
  const token = tokenFromRequest(req);
  if (!token) return htmlResponse('missing', null);
  if (!isValidUnsubscribeToken(token)) return htmlResponse('invalid', token);
  return htmlResponse('form', token);
}

/**
 * POST /unsubscribe
 * RFC 8058 one-click: body List-Unsubscribe=One-Click.
 * Also accepts the HTTPS form Gmail / humans submit.
 * Records the matching god_email_sends row as unsubscribed.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '');
  const parsed = parseUnsubscribePostBody(raw);
  const token = tokenFromRequest(req, parsed.token);
  const status = await markUnsubscribed(token);
  // One-click clients expect 2xx even when the token is already used.
  const http = status === 'done' || status === 'already' ? 200 : status === 'missing' ? 503 : 200;
  return htmlResponse(status, token || null, http);
}
