import { NextRequest } from 'next/server';
import { bearer, handleStatus } from '@/lib/crm-email/server';
import { toResponse } from '../_respond';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('customer');
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return toResponse(await handleStatus(bearer(req.headers.get('authorization')), id));
}
