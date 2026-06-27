// plugins/sessionTimeout.client.ts
// Monitors user activity and logs out admin users after 60 minutes of inactivity.
// Students get a longer 4-hour window since they use the system less frequently.
// Only runs client-side (no SSR).

export default defineNuxtPlugin(() => {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const ADMIN_TIMEOUT_MS = 60 * 60 * 1000       // 60 minutes
  const STUDENT_TIMEOUT_MS = 4 * 60 * 60 * 1000 // 4 hours
  const WARNING_MS = 5 * 60 * 1000              // warn 5 min before logout

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let warningId: ReturnType<typeof setTimeout> | null = null
  let warningToast: any = null

  const { add: addToast, remove: removeToast } = useToast()

  function getTimeout() {
    const path = window.location.pathname
    return path.startsWith('/admin') ? ADMIN_TIMEOUT_MS : STUDENT_TIMEOUT_MS
  }

  async function doLogout() {
    clearTimers()
    await supabase.auth.signOut()
    await navigateTo('/?reason=session_expired')
  }

  function clearTimers() {
    if (timeoutId) clearTimeout(timeoutId)
    if (warningId) clearTimeout(warningId)
    if (warningToast) {
      removeToast(warningToast.id)
      warningToast = null
    }
    timeoutId = null
    warningId = null
  }

  function resetTimer() {
    if (!user.value) return
    clearTimers()

    const timeout = getTimeout()

    warningId = setTimeout(() => {
      warningToast = addToast({
        title: 'Session expiring soon',
        description: 'You will be logged out in 5 minutes due to inactivity. Move your mouse or press any key to stay logged in.',
        color: 'warning',
        duration: WARNING_MS
      })
    }, timeout - WARNING_MS)

    timeoutId = setTimeout(doLogout, timeout)
  }

  // Track activity events
  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']

  // Throttle: only reset timer at most once every 30 seconds to avoid thrashing
  let lastReset = 0
  function onActivity() {
    const now = Date.now()
    if (now - lastReset > 30_000) {
      lastReset = now
      resetTimer()
    }
  }

  // Start/stop watching based on auth state
  watch(user, (newUser) => {
    if (newUser) {
      resetTimer()
      ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    } else {
      clearTimers()
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity))
    }
  }, { immediate: true })
})
