import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { SHOP_INVITE_SUBJECT, shopInviteHtml, shopInviteText } from '@/lib/shop-invite-email';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/invite/preview
 * Locked shop-tester invite HTML. Does not send.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  return NextResponse.json({
    ok: true,
    subject: SHOP_INVITE_SUBJECT,
    html: shopInviteHtml(),
    text: shopInviteText(),
    cta: 'https://repairplanet.net/signup',
  });
}
