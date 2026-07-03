export function useAdminNotifications() {
  const notifications = ref<any[]>([])
  const unreadCount = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Fetch notifications for the logged-in admin
   */
  async function fetchNotifications() {
    loading.value = true
    error.value = null
    try {
      const response = await $fetch('/api/admin/notifications')
      notifications.value = response?.data || []
      unreadCount.value = response?.unread_count || 0
      return notifications.value
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch notifications'
      error.value = errorMessage
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Mark specific notifications (or all, if no ids given) as read.
   * Updates local state optimistically so the badge/list feel instant.
   */
  async function markAsRead(notificationIds?: string[]) {
    try {
      await $fetch('/api/admin/notifications-read', {
        method: 'POST',
        body: notificationIds ? { notification_ids: notificationIds } : {}
      })

      if (notificationIds) {
        notifications.value = notifications.value.map(n =>
          notificationIds.includes(n.id) ? { ...n, is_read: true } : n
        )
      } else {
        notifications.value = notifications.value.map(n => ({ ...n, is_read: true }))
      }

      unreadCount.value = notifications.value.filter(n => !n.is_read).length
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to mark notifications as read'
      error.value = errorMessage
      throw err
    }
  }

  return {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    markAsRead
  }
}
