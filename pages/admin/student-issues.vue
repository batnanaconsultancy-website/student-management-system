<script setup lang="ts">
definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const issues = ref<any[]>([])
const loading = ref(false)
const savingId = ref<string | null>(null)
const statusFilter = ref('all')

const statusOptions = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
]

async function fetchIssues() {
  loading.value = true

  try {
    const response = await $fetch('/api/admin/student-issues')
    issues.value = response?.data || []
  } catch (error) {
    console.error('Failed to fetch student issues:', error)
  } finally {
    loading.value = false
  }
}

onMounted(fetchIssues)

const filteredIssues = computed(() => {
  if (statusFilter.value === 'all') {
    return issues.value
  }

  return issues.value.filter(
    (issue) => issue.status === statusFilter.value
  )
})

async function updateIssue(
  issue: any,
  status: string,
  adminNotes: string
) {
  savingId.value = issue.id

  try {
    const response = await $fetch('/api/admin/student-issues/update', {
      method: 'POST',
      body: {
        id: issue.id,
        status,
        admin_notes: adminNotes,
      },
    })

    if (response?.data) {
      const index = issues.value.findIndex(
        (item) => item.id === issue.id
      )

      if (index !== -1) {
        issues.value[index] = response.data
      }
    }
  } catch (error) {
    console.error('Failed to update student issue:', error)
  } finally {
    savingId.value = null
  }
}

function statusColor(status: string) {
  if (status === 'resolved') return 'success'
  if (status === 'in_progress') return 'warning'
  return 'error'
}

function statusLabel(status: string) {
  if (status === 'in_progress') return 'In Progress'
  if (status === 'resolved') return 'Resolved'
  return 'Open'
}

function formatDate(date: string) {
  if (!date) return ''

  return new Date(date).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <UDashboardPanel id="studentIssues">
    <template #header>
      <UDashboardNavbar title="Student Issues">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              Student Issues
            </h2>
            <p class="text-sm text-muted">
              Review and manage issues reported by students.
            </p>
          </div>

          <USelect
            v-model="statusFilter"
            :items="statusOptions"
            value-key="value"
            class="w-44"
          />
        </div>

        <div
          v-if="loading"
          class="py-10 text-center text-sm text-muted"
        >
          Loading student issues...
        </div>

        <div
          v-else-if="filteredIssues.length === 0"
          class="py-10 text-center text-sm text-muted"
        >
          No student issues found.
        </div>

        <div v-else class="space-y-4">
          <UCard
            v-for="issue in filteredIssues"
            :key="issue.id"
          >
            <div class="space-y-4">
              <!-- Header -->
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="font-semibold text-highlighted">
                      {{ issue.students?.first_name }}
                      {{ issue.students?.last_name }}
                    </h3>

                    <UBadge
                      :color="statusColor(issue.status)"
                      variant="subtle"
                    >
                      {{ statusLabel(issue.status) }}
                    </UBadge>
                  </div>

                  <p class="text-sm text-muted mt-1">
                    {{ issue.students?.email }}
                  </p>
                </div>

                <div class="text-xs text-muted shrink-0">
                  {{ formatDate(issue.created_at) }}
                </div>
              </div>

              <!-- Issue -->
              <div class="space-y-2">
                <p class="text-sm font-medium text-highlighted">
                  {{ issue.type }}
                </p>

                <p class="text-sm text-default whitespace-pre-wrap">
                  {{ issue.description }}
                </p>
              </div>

              <!-- Admin controls -->
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-default">
                <div>
                  <label class="block text-sm font-medium text-highlighted mb-1.5">
                    Status
                  </label>

                  <USelect
                    :model-value="issue.status"
                    :items="statusOptions.filter(option => option.value !== 'all')"
                    value-key="value"
                    :loading="savingId === issue.id"
                    @update:model-value="(value) => updateIssue(
                      issue,
                      value,
                      issue.admin_notes || ''
                    )"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-highlighted mb-1.5">
                    Admin Notes
                  </label>

                  <UTextarea
                    :model-value="issue.admin_notes || ''"
                    placeholder="Add notes about this issue..."
                    :rows="3"
                    :disabled="savingId === issue.id"
                    @blur="(event) => {
                      const value = (event.target as HTMLTextAreaElement).value
                      if (value !== (issue.admin_notes || '')) {
                        updateIssue(issue, issue.status, value)
                      }
                    }"
                  />
                </div>
              </div>

              <div
                v-if="issue.updated_at && issue.updated_at !== issue.created_at"
                class="text-xs text-muted"
              >
                Last updated: {{ formatDate(issue.updated_at) }}
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

