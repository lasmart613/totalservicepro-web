import { NextRequest, NextResponse } from 'next/server';
import {
  ANDROID_NONCE_COOKIE,
  androidHandoffSecret,
  stampNonceOnAuthorizeUrl,
  supabaseAuthHosts,
  verifyAndroidNonceProof,
} from '@/lib/android-handoff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Custom Tab entry. A valid proof sets the session cookie, then continues to
 * the authorize URL with that same nonce on our callback.
 */
export async function GET(req: NextRequest) {
  const secret = androidHandoffSecret();
  if (!secret) {
    return new NextResponse('Sign-in is not available.', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const nonce = req.nextUrl.searchParams.get('nonce') || '';
  const proof = req.nextUrl.searchParams.get('proof') || '';
  const exp = Number(req.nextUrl.searchParams.get('exp') || '');
  const continueUrl = req.nextUrl.searchParams.get('continue_url') || '';
  if (!verifyAndroidNonceProof(secret, nonce, proof, exp)) {
    return new NextResponse('This sign-in link is not valid.', { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const dest = stampNonceOnAuthorizeUrl(continueUrl, nonce, supabaseAuthHosts());
  if (!dest) {
    return new NextResponse('This sign-in link is not valid.', { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const now = Math.floor(Date.now() / 1000);
  const res = NextResponse.redirect(dest, 302);
  res.cookies.set(ANDROID_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(1, exp - now),
  });
  res.headers.set('cache-control', 'no-store');
  return res;
}
