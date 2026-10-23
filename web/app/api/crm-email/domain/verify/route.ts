import { NextRequest } from 'next/server';
import { bearer, handleDomainVerify } from '@/lib/crm-email/server';
import { toResponse } from '../../_respond';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return toResponse(await handleDomainVerify(bearer(req.headers.get('authorization'))));
}
