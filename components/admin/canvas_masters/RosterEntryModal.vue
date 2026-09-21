<script setup lang="ts">
const props = defineProps<{
  open: boolean
  // When editing, the existing entry; null/undefined means "add new".
  entry?: { email: string; program: string; cohortLabel: string } | null
  // Existing program/cohort values across the roster, offered as quick-pick
  // suggestions so admins reuse the same spelling instead of drifting
  // ("Data Science" vs "data science" would otherwise split the group).
  existingPrograms?: string[]
  existingCohortLabels?: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const { showSuccess, showError } = useNotifications()

const email = ref('')
const program = ref('')
const cohortLabel = ref('')
const saving = ref(false)

const isEdit = computed(() => Boolean(props.entry))

watch(
  () => [props.open, props.entry],
  () => {
    if (props.open) {
      email.value = props.entry?.email || ''
      program.value = props.entry?.program || ''
      cohortLabel.value = props.entry?.cohortLabel || ''
    }
  },
  { immediate: true }
)

async function handleSave() {
  if (!email.value.trim() || !program.value.trim() || !cohortLabel.value.trim()) {
    showError('Missing info', 'Email, program, and cohort are all required.')
    return
  }

  saving.value = true
  try {
    await $fetch('/api/admin/canvas-masters/roster-entry', {
      method: 'POST',
      body: {
        email: email.value.trim(),
        program: program.value.trim(),
        cohortLabel: cohortLabel.value.trim(),
        originalEmail: props.entry?.email || null,
      },
    })
    showSuccess(
      isEdit.value ? 'Student updated' : 'Student added',
      isEdit.value
        ? `${email.value} has been updated on the roster.`
        : `${email.value} has been added to the roster. Use "Sync From Canvas" to pull their data.`
    )
    emit('saved')
    emit('update:open', false)
  } catch (err: any) {
    showError('Failed to save', err?.data?.statusMessage || err?.message || 'Please try again.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal :open="open" @update:open="(v) => emit('update:open', v)">
    <template #content>
      <UCard>
        <template #header>
          <p class="font-medium text-highlighted">{{ isEdit ? 'Edit Student' : 'Add Student to Roster' }}</p>
          <p class="text-xs text-muted mt-1">
            This only adds them to the roster label list -- it doesn't pull Canvas data. Use
            "Sync From Canvas" afterwards to resolve and sync them.
          </p>
        </template>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1.5">Email</label>
            <UInput v-model="email" type="email" placeholder="student@amsterdam.tech" class="w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1.5">Program</label>
            <UInputMenu
              v-model="program"
              :items="existingPrograms || []"
              placeholder="e.g. Data Science"
              create-item
              class="w-full"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1.5">Cohort Label</label>
            <UInputMenu
              v-model="cohortLabel"
              :items="existingCohortLabels || []"
              placeholder="e.g. Nov2025"
              create-item
              class="w-full"
            />
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="emit('update:open', false)"
            />
            <UButton
              :label="isEdit ? 'Save Changes' : 'Add Student'"
              color="primary"
              :loading="saving"
              @click="handleSave"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>