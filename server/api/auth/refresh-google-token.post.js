import { createError, readBody } from 'h3'

// POST /api/auth/refresh-google-token
//
// Exchanges a stored Google OAuth refresh token for a fresh access
// token, server-side. This replaces two identical client-side calls
// that used to live in pages/students/dashboard.vue and
// pages/students/calendar.vue, which POSTed directly to
// https://www.googleapis.com/oauth2/v3/token from the browser --
// including the Google OAuth **client secret** in that request body.
//
// That secret came from runtimeConfig.public.googleClientSecret, and
// anything under `public` gets bundled into the client-side JS Nuxt
// ships to every visitor. So the client secret was effectively baked
// into the production JS bundle, readable by anyone who opened
// devtools on the live site -- regardless of whether Google's own
// client-vs-server OAuth model even calls for it to be secret (it
// does: this is a "confidential client" flow, since a server-side
// client secret exists for this app at all; a purely public client
// wouldn't have one).
//
// The fix: only the refresh token itself travels from the browser to
// this endpoint. The client ID and secret are read from the
// server-only half of runtimeConfig (googleClientId / googleClientSecret
// in nuxt.config.ts, NOT the `public` block), so they never reach the
// client bundle. Only the resulting access token is sent back.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const refreshToken = body?.refreshToken

  if (!refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'refreshToken is required' })
  }

  const config = useRuntimeConfig()

  const response = await fetch('https://www.googleapis.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage: data?.error_description || data?.error || 'Failed to refresh Google token',
    })
  }

  // Deliberately NOT returning the full Google response -- just the
  // pieces the client actually needs. In particular, Google won't
  // return a new refresh_token on a refresh-grant response anyway, but
  // being explicit here means this endpoint can never accidentally
  // leak anything more sensitive than an access token in the future.
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  }
})
