import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { BLAST_TEMPLATES, lockedBlastPreview, parseBlastTemplateKey } from '@/lib/god-email-blast';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/blast/preview?template_key=clinic_invite
 * Locked blast HTML + text. Does not send. God-only.
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

  return NextResponse.json(lockedBlastPreview(BLAST_TEMPLATES[key]));
}
