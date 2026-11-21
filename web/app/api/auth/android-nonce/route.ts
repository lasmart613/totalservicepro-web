import { NextResponse } from 'next/server';
import { androidHandoffSecret, issueAndroidNonce } from '@/lib/android-handoff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Official app asks for a nonce before it opens the Custom Tab. */
export async function GET() {
  const secret = androidHandoffSecret();
  if (!secret) {
    return NextResponse.json({ error: 'Sign-in is not available.' }, { status: 503 });
  }
  const issued = issueAndroidNonce(secret);
  const res = NextResponse.json(issued);
  res.headers.set('cache-control', 'no-store');
  return res;
}
