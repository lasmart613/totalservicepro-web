import { NextRequest } from 'next/server';
import { bearer, handleConnect } from '@/lib/crm-email/server';
import { publicSiteOrigin } from '@/lib/site-origin';
import { toResponse } from '../_respond';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { provider?: string; customer?: unknown };
  return toResponse(await handleConnect(bearer(req.headers.get('authorization')), body.provider, publicSiteOrigin(req), {}, /^\d+$/.test(String(body.customer ?? '')) ? Number(body.customer) : null));
}
