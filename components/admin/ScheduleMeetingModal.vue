<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { DAY_OPTIONS } from '~/composables/useScheduledMeetings'

const props = defineProps({
  isOpen: { type: Boolean, required: true },
  editingMeeting: { type: Object, default: null },
  programOptions: { type: Array, default: () => [] },
  cohortOptions: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'submit', 'update:isOpen'])

const dayItems = DAY_OPTIONS.map(d => ({ label: d.label, value: String(d.value) }))

// Bridge to a string value for the Select (avoids item value 0 being treated
// as empty/falsy by the underlying Select primitive) while keeping
// formData.day_of_week as the integer the API expects.
const dayOfWeekStr = computed({
  get: () => String(formData.value.day_of_week),
  set: (val: string) => { formData.value.day_of_week = Number(val) }
})

function emptyForm() {
  return {
    title: '',
    description: '',
    meeting_link: '',
    day_of_week: 1,
    start_time: '10:00',
    end_time: '11:00',
    starts_on: new Date().toISOString().slice(0, 10),
    ends_on: '',
    program_id: 'all' as string,
    cohort_id: 'all' as string,
    is_active: true,
  }
}

const formData = ref(emptyForm())
const errors = ref<Record<string, string>>({})
const loading = ref(false)

watch(
  () => props.editingMeeting,
  (meeting) => {
    if (meeting) {
      formData.value = {
        title: meeting.title || '',
        description: meeting.description || '',
        meeting_link: meeting.meeting_link || '',
        day_of_week: meeting.day_of_week ?? 1,
        start_time: (meeting.start_time || '10:00').slice(0, 5),
        end_time: (meeting.end_time || '11:00').slice(0, 5),
        starts_on: meeting.starts_on || new Date().toISOString().slice(0, 10),
        ends_on: meeting.ends_on || '',
        program_id: meeting.program_id || 'all',
        cohort_id: meeting.cohort_id || 'all',
        is_active: meeting.is_active !== false,
      }
    } else {
      formData.value = emptyForm()
    }
  },
  { immediate: true }
)

function validateForm() {
  errors.value = {}
  let isValid = true

  if (!formData.value.title.trim()) {
    errors.value.title = 'Title is required'
    isValid = false
  }
  if (!formData.value.start_time) {
    errors.value.start_time = 'Start time is required'
    isValid = false
  }
  if (!formData.value.end_time) {
    errors.value.end_time = 'End time is required'
    isValid = false
  }
  if (formData.value.start_time && formData.value.end_time && formData.value.end_time <= formData.value.start_time) {
    errors.value.end_time = 'End time must be after start time'
    isValid = false
  }
  if (formData.value.ends_on && formData.value.ends_on < formData.value.starts_on) {
    errors.value.ends_on = 'End date must be after start date'
    isValid = false
  }

  return isValid
}

async function handleSubmit() {
  if (!validateForm()) return

  loading.value = true
  try {
    emit('submit', {
      ...formData.value,
      ends_on: formData.value.ends_on || null,
      description: formData.value.description || null,
      meeting_link: formData.value.meeting_link || null,
      program_id: formData.value.program_id === 'all' ? null : formData.value.program_id,
      cohort_id: formData.value.cohort_id === 'all' ? null : formData.value.cohort_id,
    })
  } finally {
    loading.value = false
  }
}

function handleClose() {
  formData.value = emptyForm()
  errors.value = {}
  emit('close')
}
</script>

<template>
  <UModal
    :open="isOpen"
    @update:open="emit('update:isOpen', $event)"
    @close="handleClose"
    :ui="{ content: 'max-w-lg' }"
  >
    <template #header="{ close }">
      <div class="flex items-center gap-3 flex-1">
        <div class="bg-primary/10 border-primary flex h-10 w-10 items-center justify-center rounded-full border">
          <UIcon name="i-lucide-calendar-plus" class="text-primary size-5" />
        </div>
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            {{ editingMeeting ? 'Edit Scheduled Meeting' : 'Schedule Weekly Meeting' }}
          </h2>
          <p class="text-sm text-muted">Pins automatically to every matching student's calendar</p>
        </div>
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Close"
        @click="close"
      />
    </template>

    <template #body>
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <!-- Title -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-highlighted">
            Title <span class="text-error">*</span>
          </label>
          <UInput
            v-model="formData.title"
            placeholder="e.g., Weekly Mentoring Session"
            :error="!!errors.title"
            :disabled="loading"
          />
          <p v-if="errors.title" class="text-xs text-error">{{ errors.title }}</p>
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-highlighted">
            Description <span class="text-muted text-xs">(optional)</span>
          </label>
          <UTextarea
            v-model="formData.description"
            placeholder="What this meeting covers"
            :disabled="loading"
          />
        </div>

        <!-- Day of week + times -->
        <div class="grid grid-cols-3 gap-3">
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">Day <span class="text-error">*</span></label>
            <select
              v-model="dayOfWeekStr"
              :disabled="loading"
              class="w-full rounded-md border-0 appearance-none px-2.5 py-1.5 text-sm text-highlighted bg-default ring ring-inset ring-accented focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75"
            >
              <option v-for="d in dayItems" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">Start <span class="text-error">*</span></label>
            <UInput v-model="formData.start_time" type="time" :error="!!errors.start_time" :disabled="loading" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">End <span class="text-error">*</span></label>
            <UInput v-model="formData.end_time" type="time" :error="!!errors.end_time" :disabled="loading" />
          </div>
        </div>
        <p v-if="errors.end_time" class="text-xs text-error">{{ errors.end_time }}</p>

        <!-- Recurrence window -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">Starts on</label>
            <UInput v-model="formData.starts_on" type="date" :disabled="loading" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">
              Ends on <span class="text-muted text-xs">(optional — recurs indefinitely if blank)</span>
            </label>
            <UInput v-model="formData.ends_on" type="date" :error="!!errors.ends_on" :disabled="loading" />
            <p v-if="errors.ends_on" class="text-xs text-error">{{ errors.ends_on }}</p>
          </div>
        </div>

        <!-- Meeting link -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-highlighted">
            Meeting Link <span class="text-muted text-xs">(optional -- leave blank to auto-generate a Google Meet link)</span>
          </label>
          <UInput
            v-model="formData.meeting_link"
            placeholder="Leave blank for an auto-generated Google Meet link"
            :disabled="loading"
          />
        </div>

        <!-- Scope -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">
              Program <span class="text-muted text-xs">(blank = all)</span>
            </label>
            <select
              v-model="formData.program_id"
              :disabled="loading"
              class="w-full rounded-md border-0 appearance-none px-2.5 py-1.5 text-sm text-highlighted bg-default ring ring-inset ring-accented focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75"
            >
              <option value="all">All Programs</option>
              <option v-for="p in programOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-highlighted">
              Cohort <span class="text-muted text-xs">(blank = all)</span>
            </label>
            <select
              v-model="formData.cohort_id"
              :disabled="loading"
              class="w-full rounded-md border-0 appearance-none px-2.5 py-1.5 text-sm text-highlighted bg-default ring ring-inset ring-accented focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75"
            >
              <option value="all">All Cohorts</option>
              <option v-for="c in cohortOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>
        </div>

        <!-- Active toggle -->
        <div class="flex items-center gap-2">
          <USwitch v-model="formData.is_active" :disabled="loading" />
          <span class="text-sm text-highlighted">Active (unpins from calendars when off)</span>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton color="neutral" variant="outline" label="Cancel" @click="handleClose" :disabled="loading" />
        <UButton
          color="primary"
          :label="editingMeeting ? 'Save Changes' : 'Schedule Meeting'"
          :icon="editingMeeting ? 'i-lucide-check' : 'i-lucide-plus'"
          @click="handleSubmit"
          :loading="loading"
          :disabled="loading"
        />
      </div>
    </template>
  </UModal>
</template>
