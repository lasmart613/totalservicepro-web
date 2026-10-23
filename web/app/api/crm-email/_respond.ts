import { NextResponse } from 'next/server';
import type { Result } from '@/lib/crm-email/server';

export function toResponse(r: Result): NextResponse {
  const res = r.redirect ? NextResponse.redirect(r.redirect, 302) : NextResponse.json(r.body, { status: r.status });
  res.headers.set('Cache-Control', 'no-store');
  if (r.setCookie) res.headers.append('Set-Cookie', r.setCookie);
  return res;
}
