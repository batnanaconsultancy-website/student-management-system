import { getHeader, setResponseHeader } from 'h3'

const COOKIE_BUDGET_WARNING = 8 * 1024
const COOKIE_BUDGET_CRITICAL = 12 * 1024

export default defineEventHandler((event) => {
  const cookieHeader = getHeader(event, 'cookie') || ''
  const cookieBytes = Buffer.byteLength(cookieHeader, 'utf8')

  let level = 'ok'

  if (cookieBytes >= COOKIE_BUDGET_CRITICAL) {
    level = 'critical'
  } else if (cookieBytes >= COOKIE_BUDGET_WARNING) {
    level = 'warning'
  }

  setResponseHeader(event, 'Cache-Control', 'no-store')

  return {
    cookieBytes,
    warningThreshold: COOKIE_BUDGET_WARNING,
    criticalThreshold: COOKIE_BUDGET_CRITICAL,
    level,
  }
})
