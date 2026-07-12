<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useScheduledMeetings, DAY_OPTIONS } from '~/composables/useScheduledMeetings'
import { usePrograms } from '~/composables/usePrograms'
import { useCohorts } from '~/composables/useCohorts'
import { useNotifications } from '~/composables/useNotifications'
import ScheduleMeetingModal from '~/components/admin/ScheduleMeetingModal.vue'

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const { meetings, loading, fetchMeetings, createMeeting, updateMeeting, removeMeeting, dayLabel } = useScheduledMeetings()
const { programs, programOptions, fetchPrograms } = usePrograms()
const { cohorts, fetchCohorts } = useCohorts()
const { showSuccess, showError } = useNotifications()

const cohortOptions = computed(() =>
  cohorts.value.map((c: any) => ({ label: c.name, value: c.id }))
)

const isModalOpen = ref(false)
const editingMeeting = ref<any>(null)
const deletingId = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([fetchMeetings(), fetchPrograms(), fetchCohorts()])
})

function openCreateModal() {
  editingMeeting.value = null
  isModalOpen.value = true
}

function openEditModal(meeting: any) {
  editingMeeting.value = meeting
  isModalOpen.value = true
}

function closeModal() {
  isModalOpen.value = false
  editingMeeting.value = null
}

async function handleSubmit(payload: Record<string, any>) {
  try {
    if (editingMeeting.value) {
      await updateMeeting(editingMeeting.value.id, payload)
      showSuccess('Meeting updated', `"${payload.title}" has been updated.`)
    } else {
      await createMeeting(payload)
      showSuccess('Meeting scheduled', `"${payload.title}" will now be pinned to matching students' calendars.`)
    }
    closeModal()
  } catch (err: any) {
    showError('Something went wrong', err?.data?.statusMessage || err?.message || 'Please try again.')
  }
}

async function handleDelete(meeting: any) {
  if (!confirm(`Remove "${meeting.title}" from all student calendars? This cannot be undone.`)) return
  deletingId.value = meeting.id
  try {
    await removeMeeting(meeting.id)
    showSuccess('Meeting removed', `"${meeting.title}" has been deleted.`)
  } catch (err: any) {
    showError('Failed to delete', err?.data?.statusMessage || err?.message || 'Please try again.')
  } finally {
    deletingId.value = null
  }
}

async function handleToggleActive(meeting: any) {
  try {
    await updateMeeting(meeting.id, { is_active: !meeting.is_active })
    showSuccess(meeting.is_active ? 'Meeting deactivated' : 'Meeting activated')
  } catch (err: any) {
    showError('Failed to update', err?.data?.statusMessage || err?.message || 'Please try again.')
  }
}

function formatTime(t: string) {
  if (!t) return ''
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}
</script>

<template>
  <div class="mt-6 w-full max-w-5xl mx-auto">
    <div class="flex justify-between items-start mb-4">
      <div>
        <h1 class="text-highlighted font-medium">Scheduled Meetings</h1>
        <p class="text-muted text-[15px] mt-1">
          Weekly meetings pinned automatically to matching students' calendars, with a reminder notification on the day of.
        </p>
      </div>
      <UButton label="Schedule Meeting" icon="i-lucide-plus" @click="openCreateModal" />
    </div>

    <UCard variant="subtle" :ui="{ body: '!p-0' }">
      <div v-if="loading && meetings.length === 0" class="py-12 text-center text-muted text-sm">
        Loading meetings...
      </div>
      <div v-else-if="meetings.length === 0" class="py-12 text-center text-muted text-sm">
        <UIcon name="i-lucide-calendar-plus" class="size-6 mx-auto mb-2 text-dimmed" />
        No meetings scheduled yet. Click "Schedule Meeting" to pin one to student calendars.
      </div>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-default">
            <th class="text-left px-4 py-2 text-muted font-medium">Title</th>
            <th class="text-left px-4 py-2 text-muted font-medium">When</th>
            <th class="text-left px-4 py-2 text-muted font-medium">Scope</th>
            <th class="text-left px-4 py-2 text-muted font-medium">Status</th>
            <th class="text-right px-4 py-2 text-muted font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="meeting in meetings" :key="meeting.id" class="border-b border-default last:border-0">
            <td class="px-4 py-3">
              <p class="font-medium text-highlighted">{{ meeting.title }}</p>
              <p v-if="meeting.description" class="text-xs text-muted mt-0.5">{{ meeting.description }}</p>
            </td>
            <td class="px-4 py-3 text-muted">
              <p>Every {{ dayLabel(meeting.day_of_week) }}</p>
              <p class="text-xs">{{ formatTime(meeting.start_time) }} – {{ formatTime(meeting.end_time) }}</p>
            </td>
            <td class="px-4 py-3 text-muted">
              <p>{{ meeting.program_name }}</p>
              <p class="text-xs">{{ meeting.cohort_name }}</p>
            </td>
            <td class="px-4 py-3">
              <UBadge
                :color="meeting.is_active ? 'success' : 'neutral'"
                variant="subtle"
                class="cursor-pointer"
                @click="handleToggleActive(meeting)"
              >
                {{ meeting.is_active ? 'Active' : 'Inactive' }}
              </UBadge>
            </td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="openEditModal(meeting)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  :loading="deletingId === meeting.id"
                  @click="handleDelete(meeting)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </UCard>

    <ScheduleMeetingModal
      :is-open="isModalOpen"
      :editing-meeting="editingMeeting"
      :program-options="programOptions"
      :cohort-options="cohortOptions"
      @update:is-open="isModalOpen = $event"
      @close="closeModal"
      @submit="handleSubmit"
    />
  </div>
</template>
