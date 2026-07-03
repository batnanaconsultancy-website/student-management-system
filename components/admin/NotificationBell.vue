<script setup lang="ts">
// components/admin/NotificationBell.vue
// Bell icon + unread badge for the admin navbar. Opens a popover listing
// recent admin_notifications (status changes, student issue reports,
// pipeline failures). Marks visible unread items as read when opened.

const { notifications, unreadCount, loading, fetchNotifications, markAsRead } = useAdminNotifications()

const open = ref(false)

onMounted(() => {
  fetchNotifications()
  // Poll for new notifications every 60s while the app is open
  const interval = setInterval(fetchNotifications, 60_000)
  onUnmounted(() => clearInterval(interval))
})

// When the popover opens, mark currently-unread items as read after a
// short delay (long enough for the admin to actually see them appear).
watch(open, (isOpen) => {
  if (isOpen && unreadCount.value > 0) {
    setTimeout(() => {
      const unreadIds = notifications.value.filter(n => !n.is_read).map(n => n.id)
      if (unreadIds.length > 0) markAsRead(unreadIds)
    }, 1500)
  }
})

function iconFor(type: string) {
  switch (type) {
    case 'status_change': return 'i-lucide-trending-down'
    case 'student_issue': return 'i-lucide-flag'
    case 'pipeline_failure': return 'i-lucide-triangle-alert'
    default: return 'i-lucide-bell'
  }
}

function colorFor(type: string) {
  switch (type) {
    case 'status_change': return 'warning'
    case 'student_issue': return 'error'
    case 'pipeline_failure': return 'error'
    default: return 'neutral'
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
</script>

<template>
  <UPopover v-model:open="open">
    <UChip :show="unreadCount > 0" :text="unreadCount > 99 ? '99+' : unreadCount" size="sm" color="error">
      <UButton
        icon="i-lucide-bell"
        color="neutral"
        variant="ghost"
        aria-label="Notifications"
      />
    </UChip>

    <template #content>
      <div class="w-80 max-h-96 overflow-y-auto">
        <div class="flex items-center justify-between px-3 py-2 border-b border-default">
          <p class="text-sm font-medium text-highlighted">Notifications</p>
          <UButton
            v-if="unreadCount > 0"
            label="Mark all read"
            size="xs"
            color="neutral"
            variant="link"
            @click="markAsRead()"
          />
        </div>

        <div v-if="loading && notifications.length === 0" class="p-4 text-center text-sm text-muted">
          Loading...
        </div>

        <div v-else-if="notifications.length === 0" class="p-6 text-center text-sm text-muted">
          <UIcon name="i-lucide-inbox" class="size-6 mx-auto mb-2 text-dimmed" />
          No notifications yet
        </div>

        <div v-else>
          <div
            v-for="n in notifications"
            :key="n.id"
            class="flex gap-2.5 px-3 py-2.5 border-b border-default last:border-b-0"
            :class="!n.is_read ? 'bg-primary/5' : ''"
          >
            <UIcon :name="iconFor(n.type)" :class="`text-${colorFor(n.type)} mt-0.5`" class="size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-highlighted truncate">{{ n.title }}</p>
              <p v-if="n.body" class="text-xs text-muted line-clamp-2 mt-0.5">{{ n.body }}</p>
              <p class="text-xs text-dimmed mt-1">{{ timeAgo(n.created_at) }}</p>
            </div>
            <span v-if="!n.is_read" class="size-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
