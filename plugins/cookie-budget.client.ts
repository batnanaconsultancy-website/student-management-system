const COOKIE_BUDGET_WARNING = 8 * 1024
const COOKIE_BUDGET_CRITICAL = 12 * 1024

const SIS_OWNED_CLEANUP_COOKIES = [
  'active-dashboard-role',
]

function getVisibleCookieBytes() {
  return new Blob([document.cookie]).size
}

function hasCookie(name: string) {
  return document.cookie
    .split(';')
    .some((cookie) => cookie.trim().startsWith(`${name}=`))
}

function deleteCookie(name: string) {
  document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax`
}

async function checkCookieBudget() {
  try {
    const visibleCookieBytes = getVisibleCookieBytes()

    const response = await fetch('/api/system/cookie-budget', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })

    if (!response.ok) {
      return
    }

    const result = await response.json()

    const cookieBytes =
      typeof result.cookieBytes === 'number'
        ? result.cookieBytes
        : visibleCookieBytes

    if (cookieBytes >= COOKIE_BUDGET_CRITICAL) {
      console.warn(
        `[SIS cookie budget] Critical cookie size: ${cookieBytes} bytes. Cleaning only SIS-owned non-auth cookies.`,
      )

      for (const cookieName of SIS_OWNED_CLEANUP_COOKIES) {
        if (hasCookie(cookieName)) {
          deleteCookie(cookieName)

          if (!hasCookie(cookieName)) {
            console.warn(
              `[SIS cookie budget] Removed SIS-owned cookie: ${cookieName}`,
            )
          } else {
            console.warn(
              `[SIS cookie budget] Could not remove SIS-owned cookie: ${cookieName}`,
            )
          }
        }
      }

      return
    }

    if (cookieBytes >= COOKIE_BUDGET_WARNING) {
      console.warn(
        `[SIS cookie budget] Cookie header is unusually large: ${cookieBytes} bytes.`,
      )
    }
  } catch {
    // Cookie monitoring must never interfere with the application.
  }
}

export default defineNuxtPlugin(() => {
  void checkCookieBudget()

  window.setInterval(() => {
    void checkCookieBudget()
  }, 15 * 60 * 1000)
})
