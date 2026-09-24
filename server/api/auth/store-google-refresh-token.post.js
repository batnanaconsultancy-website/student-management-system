import { createError, readBody, setCookie, getRequestProtocol } from 'h3'

// POST /api/auth/store-google-refresh-token
//
// Called once, right after a student signs in with Google, with the
// refresh token Supabase handed back in the client-side session
// (session.provider_refresh_token). Stores it as an httpOnly cookie
// instead of the previous approach of writing it to localStorage.
//
// Why this matters: localStorage is readable by any JavaScript running
// on the page, including injected scripts from an XSS bug anywhere in
// the app. An httpOnly cookie is invisible to JS entirely -- only the
// browser and the server can see it. Since this refresh token is
// long-lived (effectively permanent until revoked, given the
// access_type=offline + prompt=consent flow in useAuth.ts), it's a much
// higher-value target than the short-lived access token, so it's the
// one that specifically needed to move out of localStorage.
//
// `secure` is set based on the actual request protocol rather than
// hardcoded true, so this still works during bare-IP http:// testing
// (e.g. the Hostinger VPS before a domain + SSL are set up) and
// automatically tightens to secure-only once the app is served over
// https.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const refreshToken = body?.refreshToken

  if (!refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'refreshToken is required' })
  }

  const isHttps = getRequestProtocol(event) === 'https'

  setCookie(event, 'google_refresh_token', refreshToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    // Google refresh tokens from a "Testing"-status OAuth consent
    // screen expire after 7 days; from a published/verified app they're
    // effectively long-lived until revoked. 180 days comfortably covers
    // either case without the cookie itself becoming the limiting
    // factor -- worst case, Google rejects a stale token and the user
    // just gets prompted to reconnect Calendar.
    maxAge: 60 * 60 * 24 * 180,
  })

  return { success: true }
})
