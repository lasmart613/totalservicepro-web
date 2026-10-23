import { NextRequest } from 'next/server';
import { bearer, handleDomainCreate, handleDomainRemove, handleDomainStatus } from '@/lib/crm-email/server';
import { toResponse } from '../_respond';

export const dynamic = 'force-dynamic';

/** GET ?refresh=1 polls Resend (throttled per org). */
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  return toResponse(await handleDomainStatus(bearer(req.headers.get('authorization')), refresh));
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return toResponse(await handleDomainCreate(bearer(req.headers.get('authorization')), body));
}

export async function DELETE(req: NextRequest) {
  return toResponse(await handleDomainRemove(bearer(req.headers.get('authorization'))));
}
