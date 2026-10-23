import { NextRequest } from 'next/server';
import { bearer, handleSend } from '@/lib/crm-email/server';
import { toResponse } from '../_respond';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return toResponse(await handleSend(bearer(req.headers.get('authorization')), body));
}
