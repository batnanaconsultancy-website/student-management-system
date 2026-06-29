<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: ['admin'] })

const limit = 50
const offset = ref(0)
const filterAdmin = ref('')
const filterAction = ref('__all__')

const { data, refresh } = useFetch('/api/audit/log', {
  query: computed(() => ({
    limit,
    offset: offset.value,
    admin: filterAdmin.value || undefined,
    action: filterAction.value === '__all__' ? undefined : filterAction.value
  }))
})

const logs = computed(() => data.value?.data || [])
const total = computed(() => data.value?.total || 0)

const actionLabels: Record<string, string> = {
  import_students: 'Import students',
  change_student_status: 'Change student status',
  bulk_action: 'Bulk action',
  add_admin: 'Add admin',
  remove_admin: 'Remove admin',
  create_cohort: 'Create cohort',
  update_cohort_status: 'Update cohort status',
  schedule_season: 'Schedule season',
  pipeline_failed: 'Pipeline failure'
}

const actionColor: Record<string, string> = {
  import_students: 'info',
  change_student_status: 'warning',
  bulk_action: 'warning',
  add_admin: 'success',
  remove_admin: 'error',
  create_cohort: 'info',
  pipeline_failed: 'error'
}

// Note: value must NOT be empty string in Nuxt UI v3 USelect
const actionFilterOptions = [
  { label: 'All actions', value: '__all__' },
  ...Object.entries(actionLabels).map(([v, l]) => ({ label: l, value: v }))
]

function formatDate(d: string) {
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<template>
  <div class="mt-6 w-full max-w-5xl mx-auto">
    <div class="flex justify-between items-start mb-4">
      <div>
        <h1 class="text-highlighted font-medium">Audit Log</h1>
        <p class="text-muted text-[15px] mt-1">All admin actions — {{ total }} total entries</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex gap-3 mb-4">
      <UInput
        v-model="filterAdmin"
        placeholder="Filter by admin email"
        icon="i-lucide-search"
        size="sm"
        class="min-w-56"
        @update:model-value="offset = 0; refresh()"
      />
      <USelect
        v-model="filterAction"
        :items="actionFilterOptions"
        size="sm"
        class="min-w-52"
        @update:model-value="offset = 0; refresh()"
      />
    </div>

    <!-- Table -->
    <UCard variant="subtle" :ui="{ body: '!p-0' }">
      <div v-if="logs.length === 0" class="py-12 text-center text-muted text-sm">
        No audit log entries found.
      </div>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-default">
            <th class="text-left px-4 py-2 text-muted font-medium">Time</th>
            <th class="text-left px-4 py-2 text-muted font-medium">Admin</th>
            <th class="text-left px-4 py-2 text-muted font-medium">Action</th>
            <th class="text-left px-4 py-2 text-muted font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="log in logs"
            :key="log.id"
            class="border-b border-default/50 hover:bg-elevated/50"
          >
            <td class="px-4 py-2 text-muted whitespace-nowrap">{{ formatDate(log.created_at) }}</td>
            <td class="px-4 py-2 text-highlighted">{{ log.admin_email }}</td>
            <td class="px-4 py-2">
              <UBadge
                :color="actionColor[log.action] || 'neutral'"
                variant="subtle"
                size="xs"
              >
                {{ actionLabels[log.action] || log.action }}
              </UBadge>
            </td>
            <td class="px-4 py-2 text-muted text-xs max-w-xs truncate">
              {{ log.details ? JSON.stringify(log.details) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </UCard>

    <!-- Pagination -->
    <div v-if="total > limit" class="flex justify-between items-center mt-4">
      <span class="text-xs text-muted">
        Showing {{ offset + 1 }}–{{ Math.min(offset + limit, total) }} of {{ total }}
      </span>
      <div class="flex gap-2">
        <UButton
          size="xs"
          :disabled="offset === 0"
          label="Previous"
          @click="offset = Math.max(0, offset - limit); refresh()"
        />
        <UButton
          size="xs"
          :disabled="offset + limit >= total"
          label="Next"
          @click="offset += limit; refresh()"
        />
      </div>
    </div>
  </div>
</template>
