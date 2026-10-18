import type { NextRequest } from 'next/server';
import { runDirectoryClaim } from '@/lib/directory-claim-api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return runDirectoryClaim(req);
}
