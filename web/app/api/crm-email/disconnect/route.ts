import { NextRequest } from 'next/server';
import { bearer, handleDisconnect } from '@/lib/crm-email/server';
import { toResponse } from '../_respond';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  return toResponse(await handleDisconnect(bearer(req.headers.get('authorization')), body.provider));
}
