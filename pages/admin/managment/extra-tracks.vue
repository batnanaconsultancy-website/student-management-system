<script setup lang="ts">
// pages/admin/managment/extra-tracks.vue
// Lists students deliberately tracking an extra season/course
// (e.g. an extra-fee Fullstack/Backend add-on), with both the kept
// (higher, counted) and discarded (lower, preserved for the record)
// progress values.
definePageMeta({
    layout: "default",
    middleware: ["admin"],
});

const { data, status, refresh } = useFetch('/api/admin/duplicate-tracks')

const rows = computed(() => data.value?.data || [])
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'student_first_name', header: 'Student' },
  { accessorKey: 'student_email', header: 'Email' },
  { accessorKey: 'season_name', header: 'Season' },
  { accessorKey: 'kept_raw_label', header: 'Counted track' },
  { accessorKey: 'kept_progress_percentage', header: 'Counted %' },
  { accessorKey: 'discarded_raw_label', header: 'Extra track' },
  { accessorKey: 'discarded_progress_percentage', header: 'Extra %' },
  { accessorKey: 'scraped_at', header: 'Last updated' },
]

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="mt-6 w-full">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-highlighted font-medium text-left w-full">Extra Course Tracking</h1>
        <p class="text-muted text-[15px] text-pretty mt-1">
          Students deliberately enrolled in an additional season/track. Only the higher
          progress value is counted toward status; the other is kept here for the record.
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <UCard variant="subtle" class="mt-4">
      <UTable :data="rows" :columns="columns" :loading="loading">
        <template #student_first_name-cell="{ row }">
          <div class="font-medium text-highlighted">
            {{ row.original.student_first_name }} {{ row.original.student_last_name }}
          </div>
          <div class="text-xs text-muted">@{{ row.original.student_username }}</div>
        </template>

        <template #kept_progress_percentage-cell="{ row }">
          <UBadge color="success" variant="subtle">{{ row.original.kept_progress_percentage }}%</UBadge>
        </template>

        <template #discarded_progress_percentage-cell="{ row }">
          <UBadge color="neutral" variant="subtle">{{ row.original.discarded_progress_percentage }}%</UBadge>
        </template>

        <template #scraped_at-cell="{ row }">
          {{ formatDate(row.original.scraped_at) }}
        </template>
      </UTable>

      <div v-if="!loading && rows.length === 0" class="text-center text-sm text-muted py-8">
        No extra-course tracking records yet.
      </div>
    </UCard>
  </div>
</template>
