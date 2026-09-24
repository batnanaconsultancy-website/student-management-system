import { deleteCookie } from 'h3'

// POST /api/auth/clear-google-tokens
//
// Called on sign-out to remove the httpOnly google_refresh_token
// cookie set by store-google-refresh-token.post.js. This has to happen
// server-side -- unlike the old localStorage.removeItem() approach,
// client-side JS has no visibility into an httpOnly cookie at all, so
// clearing it requires a server round-trip (a Set-Cookie header with
// an expired cookie, which is what deleteCookie does under the hood).
export default defineEventHandler(async (event) => {
  deleteCookie(event, 'google_refresh_token', { path: '/' })
  return { success: true }
})
