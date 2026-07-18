<script setup lang="ts">
definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const requests = ref<any[]>([])
const loading = ref(false)
const statusFilter = ref('all')

async function fetchRequests() {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/guidance-requests')
    requests.value = res?.data || []
  } catch (err) {
    console.error('Failed to fetch guidance requests:', err)
  } finally {
    loading.value = false
  }
}

onMounted(fetchRequests)

const filteredRequests = computed(() => {
  if (statusFilter.value === 'all') return requests.value
  return requests.value.filter((r) => r.status === statusFilter.value)
})

const statusOptions = [
  { label: 'All', value: 'all' },
  { label: 'New', value: 'New' },
  { label: 'In Progress', value: 'In Progress' },
  { label: 'Resolved', value: 'Resolved' },
]

const updatingId = ref<string | null>(null)

async function updateStatus(id: string, status: string) {
  updatingId.value = id
  try {
    await $fetch('/api/admin/guidance-requests/update-status', {
      method: 'POST',
      body: { id, status },
    })
    const row = requests.value.find((r) => r.id === id)
    if (row) row.status = status
  } catch (err) {
    console.error('Failed to update status:', err)
  } finally {
    updatingId.value = null
  }
}

function statusColor(status: string) {
  if (status === 'Resolved') return 'success'
  if (status === 'In Progress') return 'warning'
  return 'neutral'
}

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <UDashboardPanel id="guidanceInbox">
    <template #header>
      <UDashboardNavbar title="Guidance Inbox">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-muted">
          Every student's guidance/request submission, visible to all admins.
        </p>
        <USelect
          v-model="statusFilter"
          :items="statusOptions"
          value-key="value"
          class="w-44"
        />
      </div>

      <div v-if="loading" class="text-sm text-muted py-8 text-center">Loading...</div>
      <div v-else-if="filteredRequests.length === 0" class="text-sm text-muted py-8 text-center">
        No requests found.
      </div>

      <div v-else class="space-y-3">
        <UCard v-for="req in filteredRequests" :key="req.id">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-2 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-medium text-highlighted">
                  {{ req.students?.first_name }} {{ req.students?.last_name }}
                </p>
                <span class="text-xs text-muted">{{ req.students?.email }}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <UBadge v-for="c in req.categories" :key="c" variant="subtle" size="sm">
                  {{ c }}
                </UBadge>
              </div>
              <p v-if="req.message" class="text-sm text-default whitespace-pre-wrap">{{ req.message }}</p>
              <p class="text-xs text-muted/70">{{ formatDate(req.created_at) }}</p>
            </div>

            <div class="flex flex-col items-end gap-2 shrink-0">
              <UBadge :color="statusColor(req.status)" variant="subtle">{{ req.status }}</UBadge>
              <USelect
                :model-value="req.status"
                :items="[
                  { label: 'New', value: 'New' },
                  { label: 'In Progress', value: 'In Progress' },
                  { label: 'Resolved', value: 'Resolved' },
                ]"
                value-key="value"
                :loading="updatingId === req.id"
                size="sm"
                class="w-36"
                @update:model-value="(val) => updateStatus(req.id, val)"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
