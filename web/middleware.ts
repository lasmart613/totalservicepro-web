import { NextResponse, type NextRequest } from 'next/server'
import { mapAndroidHtmlPath } from './lib/android-html-routes'

/**
 * Lightweight middleware for Netlify.
 * Avoids heavy Supabase SSR session refresh on the Edge runtime, which has been
 * crashing the site-wide handler with:
 *   "error decoding lambda response: unexpected end of JSON input"
 * Session refresh still happens in browser via the Supabase client.
 *
 * Also remaps leftover Android *.html notification links so Open never 404s.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const mapped = mapAndroidHtmlPath(pathname, search)
  if (mapped) {
    const dest = request.nextUrl.clone()
    const q = mapped.indexOf('?')
    dest.pathname = q >= 0 ? mapped.slice(0, q) : mapped
    dest.search = q >= 0 ? mapped.slice(q) : ''
    return NextResponse.redirect(dest)
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Skip static assets only
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
