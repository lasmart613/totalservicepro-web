import { NextRequest } from 'next/server';
import { runStripeConnectGet, runStripeConnectPost } from '@/lib/billing/stripe-connect-access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return runStripeConnectGet(req);
}

export async function POST(req: NextRequest) {
  return runStripeConnectPost(req);
}
