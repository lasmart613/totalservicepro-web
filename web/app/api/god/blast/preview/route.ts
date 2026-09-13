import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import {
  BLAST_TEMPLATES,
  blastFromAddress,
  blastReplyTo,
  parseBlastTemplateKey,
} from '@/lib/god-email-blast';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/blast/preview?template_key=clinic_invite
 * Locked blast HTML. Does not send.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  const key = parseBlastTemplateKey(req.nextUrl.searchParams.get('template_key'));
  if (!key) {
    return NextResponse.json(
      { error: 'Choose a locked template (shop_invite or clinic_invite).' },
      { status: 400 }
    );
  }

  const template = BLAST_TEMPLATES[key];
  return NextResponse.json({
    ok: true,
    template_key: template.key,
    template_name: template.name,
    subject: template.subject,
    from: blastFromAddress(template),
    reply_to: blastReplyTo(template),
    html: template.html(),
    text: template.text(),
    cta: 'https://repairplanet.net/signup',
  });
}
