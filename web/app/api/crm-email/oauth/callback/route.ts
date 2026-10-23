import { NextRequest } from 'next/server';
import { handleCallback, STATE_COOKIE } from '@/lib/crm-email/server';
import { publicSiteOrigin } from '@/lib/site-origin';
import { toResponse } from '../../_respond';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return toResponse(
    await handleCallback(
      { code: q.get('code'), state: q.get('state'), error: q.get('error') },
      req.cookies.get(STATE_COOKIE)?.value ?? null,
      publicSiteOrigin(req)
    )
  );
}
