import { NextRequest, NextResponse } from 'next/server';
import { ANDROID_NONCE_COOKIE, androidNonceMatchesSession } from '@/lib/android-handoff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Callback asks before it puts session tokens on a handoff URL.
 * ok is true only when tsp_nonce is the one bind stored for this browser.
 * A match clears the cookie so the nonce is single-use. A mismatch leaves it.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { nonce?: unknown };
  const nonce = String(body?.nonce || '');
  const cookie = req.cookies.get(ANDROID_NONCE_COOKIE)?.value;
  const ok = androidNonceMatchesSession(cookie, nonce);
  const res = NextResponse.json({ ok });
  if (ok) {
    res.cookies.set(ANDROID_NONCE_COOKIE, '', {
      httpOnly: true,
      secure: req.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
  res.headers.set('cache-control', 'no-store');
  return res;
}
