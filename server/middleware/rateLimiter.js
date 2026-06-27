// server/middleware/rateLimiter.js
// Simple in-memory rate limiter for public-facing routes.
// Limits: /auth/ routes get 10 req/min, all other /api/ routes get 60 req/min.
// In production with multiple server instances, replace the Map with Redis.

const store = new Map() // key -> { count, resetAt }

const LIMITS = {
  auth: { max: 10, windowMs: 60_000 },
  default: { max: 60, windowMs: 60_000 }
}

export default defineEventHandler((event) => {
  const path = event.path || ''

  // Only rate-limit API routes
  if (!path.startsWith('/api/')) return

  const isAuthRoute = path.startsWith('/api/auth/')
  const limit = isAuthRoute ? LIMITS.auth : LIMITS.default

  // Get client identifier — prefer real IP, fall back to forwarded
  const ip =
    getRequestHeader(event, 'x-real-ip') ||
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'

  const key = `${ip}:${isAuthRoute ? 'auth' : 'api'}`
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + limit.windowMs })
    return
  }

  entry.count++

  if (entry.count > limit.max) {
    setResponseStatus(event, 429)
    setResponseHeaders(event, {
      'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
      'X-RateLimit-Limit': String(limit.max),
      'X-RateLimit-Remaining': '0'
    })
    return sendError(event, createError({
      statusCode: 429,
      statusMessage: 'Too many requests — please wait before trying again'
    }))
  }

  setResponseHeader(event, 'X-RateLimit-Remaining', String(limit.max - entry.count))
})
