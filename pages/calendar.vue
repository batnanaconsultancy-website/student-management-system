<script setup lang="ts">
// pages/students/notifications.vue
// Student-facing inbox: their own status-change / general notifications.
definePageMeta({
  layout: "custom",
  middleware: ["auth", "student-only"],
});

const { data, status, refresh } = useFetch('/api/student/notifications')

const rows = computed(() => data.value?.data || [])
const loading = computed(() => status.value === 'pending')

async function markRead(id?: string) {
  await $fetch('/api/student/notifications-read', {
    method: 'POST',
    body: id ? { notification_ids: [id] } : {}
  })
  await refresh()
}

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <UDashboardPanel id="studentNotifications">
    <template #header>
      <UDashboardNavbar title="Notifications">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="rows.some(r => !r.is_read)"
            label="Mark all read"
            size="xs"
            color="neutral"
            variant="outline"
            @click="markRead()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto w-full">
        <div v-if="loading" class="text-center text-sm text-muted py-8">Loading...</div>

        <div v-else-if="rows.length === 0" class="text-center text-sm text-muted py-8">
          <UIcon name="i-lucide-bell-off" class="size-6 mx-auto mb-2 text-dimmed" />
          No notifications yet.
        </div>

        <UCard
          v-else
          v-for="row in rows"
          :key="row.id"
          variant="subtle"
          class="mb-3"
          :class="!row.is_read ? 'ring-1 ring-primary/40' : ''"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium text-highlighted">{{ row.title }}</p>
              <p v-if="row.body" class="text-sm text-muted mt-1">{{ row.body }}</p>
              <p class="text-xs text-dimmed mt-2">{{ formatDate(row.created_at) }}</p>
            </div>
            <UButton
              v-if="!row.is_read"
              icon="i-lucide-check"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="markRead(row.id)"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
