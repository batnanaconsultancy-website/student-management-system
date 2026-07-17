<script setup lang="ts">
const props = defineProps<{
  open: boolean
  students: Array<{ id: string; name: string; username?: string }>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  updated: []
}>()

const selectedIds = ref<string[]>([])
const targetStatus = ref<string>('Active')
const loading = ref(false)
const error = ref<string | null>(null)

const statusOptions = [
  { label: 'Active', value: 'Active' },
  { label: 'Inactive', value: 'Inactive' },
  { label: 'Frozen', value: 'Frozen' },
  { label: 'Graduated', value: 'Graduated' },
]

// USelectMenu items: label is what's shown/searched, value is the student id
const studentItems = computed(() =>
  props.students.map((s) => ({ label: s.name || s.username || s.id, value: s.id }))
)

function reset() {
  selectedIds.value = []
  targetStatus.value = 'Active'
  error.value = null
}

watch(() => props.open, (isOpen) => {
  if (isOpen) reset()
})

async function applyBulkStatus() {
  if (selectedIds.value.length === 0) {
    error.value = 'Select at least one student.'
    return
  }

  loading.value = true
  error.value = null
  try {
    await $fetch('/api/students/bulk-update-status', {
      method: 'POST',
      body: {
        student_ids: selectedIds.value,
        account_status: targetStatus.value,
      },
    })
    emit('updated')
    emit('update:open', false)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Failed to update students'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal :open="open" @update:open="(v) => emit('update:open', v)" title="Bulk Change Student Status">
    <template #body>
      <div class="space-y-5">
        <div class="space-y-2">
          <label class="text-sm font-medium text-highlighted">
            Students <span class="text-muted text-xs">({{ selectedIds.length }} selected)</span>
          </label>
          <USelectMenu
            v-model="selectedIds"
            :items="studentItems"
            value-key="value"
            multiple
            searchable
            searchable-placeholder="Search students..."
            placeholder="Select students to update"
            class="w-full"
            :ui="{ content: 'max-h-72 overflow-y-auto' }"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-highlighted">New Status</label>
          <USelect
            v-model="targetStatus"
            :items="statusOptions"
            value-key="value"
            class="w-full"
          />
        </div>

        <p v-if="error" class="text-sm text-error">{{ error }}</p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="outline" color="neutral" :disabled="loading" @click="emit('update:open', false)">
          Cancel
        </UButton>
        <UButton :loading="loading" @click="applyBulkStatus">
          Update {{ selectedIds.length || '' }} Student{{ selectedIds.length === 1 ? '' : 's' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
