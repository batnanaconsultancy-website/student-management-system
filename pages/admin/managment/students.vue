<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { useStudents } from '~/composables/useStudents'
import { useNotifications } from '~/composables/useNotifications'

definePageMeta({
  layout: "default",
  middleware: ["admin"],
})

const { parseCSV, importStudents, loading } = useStudents()
const { showSuccess, showError } = useNotifications()

const MAX_FILE_SIZE = 2 * 1024 * 1024
const ACCEPTED_FILE_TYPES = ['text/csv', 'application/vnd.ms-excel']

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

const schema = z.object({
  csvFile: z
    .instanceof(File, { message: 'Please select a CSV file.' })
    .refine((file) => file.size <= MAX_FILE_SIZE, {
      message: `File too large. Max size: ${formatBytes(MAX_FILE_SIZE)}.`
    })
    .refine((file) => ACCEPTED_FILE_TYPES.includes(file.type) || file.name.endsWith('.csv'), {
      message: 'Please upload a valid CSV file.'
    })
})

type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ csvFile: undefined })

// Stages: 'idle' | 'previewing' | 'importing' | 'done'
const stage = ref<'idle' | 'previewing' | 'importing' | 'done'>('idle')
const validating = ref(false)
const preview = ref<any>(null)
const uploadResult = ref<any>(null)
const parsedStudents = ref<any[]>([])

// Reset back to upload step
function reset() {
  stage.value = 'idle'
  preview.value = null
  uploadResult.value = null
  parsedStudents.value = []
  state.csvFile = undefined
}

// Step 1: validate CSV without importing
async function onSubmit(event: FormSubmitEvent<Schema>) {
  preview.value = null
  validating.value = true

  try {
    const file = event.data.csvFile
    const text = await file.text()
    parsedStudents.value = parseCSV(text)

    if (parsedStudents.value.length === 0) {
      showError('Empty File', 'The CSV file has no data rows.')
      return
    }

    // Call the validate endpoint — dry run, no DB writes
    const result = await $fetch('/api/students/validate', {
      method: 'POST',
      body: { students: parsedStudents.value }
    })

    preview.value = result
    stage.value = 'previewing'
  } catch (error: any) {
    showError('Validation Failed', error?.data?.statusMessage || error.message || 'Could not validate CSV')
  } finally {
    validating.value = false
  }
}

// Step 2: confirm and actually import
async function confirmImport() {
  if (!preview.value || preview.value.summary.will_insert === 0) return
  stage.value = 'importing'

  try {
    const data = await importStudents(parsedStudents.value)
    uploadResult.value = data
    stage.value = 'done'

    const message = data.skipped > 0
      ? `Imported ${data.inserted} students, skipped ${data.skipped} duplicates`
      : `Successfully imported ${data.inserted} students`
    showSuccess('Import Complete', message)
  } catch (error: any) {
    stage.value = 'previewing'
    showError('Import Failed', error?.data?.statusMessage || error.message || 'An error occurred during import')
  }
}
</script>

<template>
  <div class="mt-6 w-full lg:max-w-2xl mx-auto gap-0">

    <!-- Header -->
    <div class="flex justify-between items-start mb-4">
      <div>
        <h1 class="text-highlighted font-medium text-left w-full">Student Management</h1>
        <p class="text-muted text-[15px] text-pretty mt-1">Upload a CSV file to add new students to the system.</p>
      </div>
      <UTooltip
        arrow
        text="CSV columns (in order): Full Name, Qwasar ID, Email, Programme, Cohort. Header row is ignored."
        :delay-duration="0"
      >
        <UIcon name="i-lucide-info" class="text-muted size-4 cursor-pointer mt-1 mr-2" />
      </UTooltip>
    </div>

    <!-- STEP 1: Upload -->
    <UCard v-if="stage === 'idle'" variant="subtle" class="mt-4" :ui="{ body: '!py-4' }">
      <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField name="csvFile">
          <UFileUpload
            v-model="state.csvFile"
            accept=".csv"
            class="min-h-48"
            label="Drop your CSV here"
            description="or click to browse."
          />
        </UFormField>
        <UButton
          type="submit"
          label="Validate CSV"
          color="primary"
          variant="soft"
          icon="i-lucide-scan-search"
          :loading="validating"
          :disabled="validating || !state.csvFile"
        />
      </UForm>
    </UCard>

    <!-- STEP 2: Preview / dry-run results -->
    <div v-if="stage === 'previewing' && preview" class="space-y-4 mt-4">

      <!-- Summary banner -->
      <div class="grid grid-cols-3 gap-3">
        <UCard variant="subtle" :ui="{ body: '!py-3 !px-4' }">
          <p class="text-xs text-muted">Will import</p>
          <p class="text-xl font-semibold text-success">{{ preview.summary.will_insert }}</p>
        </UCard>
        <UCard variant="subtle" :ui="{ body: '!py-3 !px-4' }">
          <p class="text-xs text-muted">Will skip (exists)</p>
          <p class="text-xl font-semibold text-warning">{{ preview.summary.will_skip }}</p>
        </UCard>
        <UCard variant="subtle" :ui="{ body: '!py-3 !px-4' }">
          <p class="text-xs text-muted">Row errors</p>
          <p class="text-xl font-semibold" :class="preview.summary.has_errors > 0 ? 'text-error' : 'text-muted'">
            {{ preview.summary.has_errors }}
          </p>
        </UCard>
      </div>

      <!-- Errors list -->
      <UCard v-if="preview.errors.length > 0" variant="subtle" :ui="{ body: '!py-3 !px-4' }">
        <p class="text-sm font-medium text-error mb-2">
          <UIcon name="i-lucide-x-circle" class="inline mr-1" />
          {{ preview.errors.length }} row(s) with errors — these will NOT be imported
        </p>
        <ul class="space-y-1 max-h-40 overflow-y-auto">
          <li
            v-for="err in preview.errors"
            :key="err.row"
            class="text-xs text-muted flex gap-2"
          >
            <span class="text-error font-mono shrink-0">Row {{ err.row }}</span>
            <span>{{ err.email || '—' }} — {{ err.reason }}</span>
          </li>
        </ul>
      </UCard>

      <!-- Duplicates list -->
      <UCard v-if="preview.duplicates.length > 0" variant="subtle" :ui="{ body: '!py-3 !px-4' }">
        <p class="text-sm font-medium text-warning mb-2">
          <UIcon name="i-lucide-skip-forward" class="inline mr-1" />
          {{ preview.duplicates.length }} student(s) already exist — will be skipped
        </p>
        <ul class="space-y-1 max-h-32 overflow-y-auto">
          <li
            v-for="dup in preview.duplicates"
            :key="dup.row"
            class="text-xs text-muted flex gap-2"
          >
            <span class="font-mono shrink-0">Row {{ dup.row }}</span>
            <span>{{ dup.name }} ({{ dup.email }})</span>
          </li>
        </ul>
      </UCard>

      <!-- Valid rows preview -->
      <UCard v-if="preview.to_insert.length > 0" variant="subtle" :ui="{ body: '!py-3 !px-4' }">
        <p class="text-sm font-medium text-highlighted mb-2">
          <UIcon name="i-lucide-check-circle" class="inline mr-1 text-success" />
          {{ preview.to_insert.length }} student(s) ready to import
        </p>
        <ul class="space-y-1 max-h-40 overflow-y-auto">
          <li
            v-for="s in preview.to_insert"
            :key="s.email"
            class="text-xs text-muted flex justify-between"
          >
            <span>{{ s.name }}</span>
            <span class="text-muted/60">{{ s.programme }} · {{ s.cohort }}</span>
          </li>
        </ul>
      </UCard>

      <!-- No valid rows at all -->
      <UAlert
        v-if="preview.summary.will_insert === 0"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-circle"
        title="Nothing to import"
        description="All rows either have errors or already exist. Fix the errors in your CSV and try again."
      />

      <!-- Action buttons -->
      <div class="flex gap-3">
        <UButton
          label="Start Over"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          @click="reset"
        />
        <UButton
          v-if="preview.summary.will_insert > 0"
          :label="`Import ${preview.summary.will_insert} student${preview.summary.will_insert !== 1 ? 's' : ''}`"
          color="primary"
          variant="soft"
          icon="i-lucide-upload"
          :loading="loading"
          @click="confirmImport"
        />
      </div>
    </div>

    <!-- STEP 3: Done -->
    <UCard v-if="stage === 'done' && uploadResult" variant="subtle" class="mt-4" :ui="{ body: '!py-6 !px-6' }">
      <div class="flex flex-col items-center gap-3 text-center">
        <UIcon name="i-lucide-circle-check-big" class="size-10 text-success" />
        <div>
          <p class="font-medium text-highlighted">Import complete</p>
          <p class="text-sm text-muted mt-1">
            {{ uploadResult.inserted }} student{{ uploadResult.inserted !== 1 ? 's' : '' }} imported
            <template v-if="uploadResult.skipped > 0">, {{ uploadResult.skipped }} skipped</template>
          </p>
        </div>
        <UButton label="Import Another CSV" color="neutral" variant="outline" icon="i-lucide-plus" @click="reset" />
      </div>
    </UCard>

  </div>
</template>
