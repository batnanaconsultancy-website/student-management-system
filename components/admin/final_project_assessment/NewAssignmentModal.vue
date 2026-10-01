<script setup lang="ts">
// Implements the Admin workflow from the spec, in one modal:
//   Add Examiners -> Select Instructor(s) -> Activate Assessment ->
//   Select Student(s) -> Confirm Season 04 Completion -> Save
//
// Built as one linear form with clearly separated sections rather than
// a multi-step wizard -- lets the admin see and adjust everything at
// once before saving, and keeps re-opening an existing assignment (to
// edit examiners or re-activate) a single view rather than a re-run of
// several wizard steps.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [] }>()

const { showSuccess, showError } = useNotifications()

// ── Examiners ────────────────────────────────────────────────
const examiners = ref<Array<{ id: string; name: string; email: string; is_active: boolean }>>([])
const selectedExaminerIds = ref<string[]>([])
const loadingExaminers = ref(false)

const showAddExaminer = ref(false)
const newExaminerName = ref('')
const newExaminerEmail = ref('')
const addingExaminer = ref(false)

async function fetchExaminers() {
  loadingExaminers.value = true
  try {
    const res = await $fetch('/api/admin/final-project-assessment/examiners')
    examiners.value = (res?.data?.examiners || []).filter((e: any) => e.is_active)
  } catch (err: any) {
    showError('Failed to load examiners', err?.data?.statusMessage || err?.message)
  } finally {
    loadingExaminers.value = false
  }
}

async function handleAddExaminer() {
  if (!newExaminerName.value.trim() || !newExaminerEmail.value.trim()) {
    showError('Missing info', 'Name and email are both required.')
    return
  }
  addingExaminer.value = true
  try {
    const res = await $fetch('/api/admin/final-project-assessment/examiner-entry', {
      method: 'POST',
      body: { name: newExaminerName.value.trim(), email: newExaminerEmail.value.trim() },
    })
    await fetchExaminers()
    // Auto-select the newly added examiner.
    const newId = res?.data?.examiner?.id
    if (newId) selectedExaminerIds.value = [...selectedExaminerIds.value, newId]
    newExaminerName.value = ''
    newExaminerEmail.value = ''
    showAddExaminer.value = false
    showSuccess('Examiner added')
  } catch (err: any) {
    showError('Failed to add examiner', err?.data?.statusMessage || err?.message)
  } finally {
    addingExaminer.value = false
  }
}

const examinerOptions = computed(() =>
  examiners.value.map((e) => ({ label: `${e.name} (${e.email})`, value: e.id }))
)

// ── Students ─────────────────────────────────────────────────
type EligibleStudent = {
  id: string
  name: string
  email: string
  program: string | null
  cohort: string | null
  season4: { isCompleted: boolean; progressPercentage: number; seasonName: string | null }
  existingAssignment: { id: string; assessmentActivated: boolean; archived: boolean } | null
}

const studentSearch = ref('')
const studentSearchResults = ref<EligibleStudent[]>([])
const searchingStudents = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

const selectedStudents = ref<EligibleStudent[]>([])
// studentId -> whether Season 4 is checked as complete (defaults to
// the actual computed value; admin can override it on).
const season04Checked = ref<Record<string, boolean>>({})

watch(studentSearch, (val) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  if (!val.trim()) {
    studentSearchResults.value = []
    return
  }
  searchDebounce = setTimeout(async () => {
    searchingStudents.value = true
    try {
      const res = await $fetch('/api/admin/final-project-assessment/eligible-students', {
        query: { search: val.trim() },
      })
      studentSearchResults.value = res?.data?.students || []
    } catch (err: any) {
      showError('Student search failed', err?.data?.statusMessage || err?.message)
    } finally {
      searchingStudents.value = false
    }
  }, 300)
})

function addStudent(student: EligibleStudent) {
  if (selectedStudents.value.some((s) => s.id === student.id)) return
  selectedStudents.value = [...selectedStudents.value, student]
  season04Checked.value = { ...season04Checked.value, [student.id]: student.season4.isCompleted }
  studentSearch.value = ''
  studentSearchResults.value = []
}

function removeStudent(studentId: string) {
  selectedStudents.value = selectedStudents.value.filter((s) => s.id !== studentId)
  const { [studentId]: _, ...rest } = season04Checked.value
  season04Checked.value = rest
}

// ── Activation + Save ────────────────────────────────────────
const assessmentActivated = ref(false)
const saving = ref(false)

async function handleSave() {
  if (selectedExaminerIds.value.length === 0) {
    showError('No examiner selected', 'Select at least one instructor.')
    return
  }
  if (selectedStudents.value.length === 0) {
    showError('No students selected', 'Select at least one student.')
    return
  }

  // Overrides: students checked complete despite actual computed
  // status being false.
  const season04Overrides: Record<string, boolean> = {}
  for (const student of selectedStudents.value) {
    if (season04Checked.value[student.id] && !student.season4.isCompleted) {
      season04Overrides[student.id] = true
    }
  }

  saving.value = true
  try {
    await $fetch('/api/admin/final-project-assessment/save-assignment', {
      method: 'POST',
      body: {
        studentIds: selectedStudents.value.map((s) => s.id),
        examinerIds: selectedExaminerIds.value,
        assessmentActivated: assessmentActivated.value,
        season04Overrides,
      },
    })
    showSuccess(
      'Assignment saved',
      `${selectedStudents.value.length} student(s) assigned to ${selectedExaminerIds.value.length} examiner(s).`
    )
    emit('saved')
    handleClose()
  } catch (err: any) {
    showError('Failed to save', err?.data?.statusMessage || err?.message || 'Please try again.')
  } finally {
    saving.value = false
  }
}

function handleClose() {
  selectedExaminerIds.value = []
  selectedStudents.value = []
  season04Checked.value = {}
  assessmentActivated.value = false
  studentSearch.value = ''
  studentSearchResults.value = []
  showAddExaminer.value = false
  emit('update:open', false)
}

watch(() => props.open, (isOpen) => {
  if (isOpen) fetchExaminers()
})
</script>

<template>
  <UModal :open="open" @update:open="(v) => (v ? emit('update:open', true) : handleClose())" :ui="{ content: 'max-w-2xl' }">
    <template #content>
      <UCard>
        <template #header>
          <p class="font-medium text-highlighted">New Final Project Assessment Assignment</p>
          <p class="text-xs text-muted mt-1">Add examiners, select students, confirm Season 4, and activate.</p>
        </template>

        <div class="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
          <!-- 1. Select Instructor(s) -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-sm font-medium">Select Instructor(s)</label>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="showAddExaminer ? 'i-lucide-x' : 'i-lucide-plus'"
                @click="showAddExaminer = !showAddExaminer"
              >
                {{ showAddExaminer ? 'Cancel' : 'Add New Examiner' }}
              </UButton>
            </div>

            <div v-if="showAddExaminer" class="flex gap-2 mb-2 p-2 rounded-lg bg-elevated/40">
              <UInput v-model="newExaminerName" placeholder="Name" class="flex-1" />
              <UInput v-model="newExaminerEmail" type="email" placeholder="Email" class="flex-1" />
              <UButton size="sm" :loading="addingExaminer" @click="handleAddExaminer">Add</UButton>
            </div>

            <USelectMenu
              v-model="selectedExaminerIds"
              :items="examinerOptions"
              value-key="value"
              multiple
              searchable
              :loading="loadingExaminers"
              placeholder="Select one or more instructors"
              class="w-full"
            />
          </div>

          <!-- 2. Activate -->
          <div class="flex items-center justify-between p-3 rounded-lg border border-default">
            <div>
              <p class="text-sm font-medium">Activate Project Assessment Form</p>
              <p class="text-xs text-muted">Examiners can only access the assessment forms once activated.</p>
            </div>
            <USwitch v-model="assessmentActivated" />
          </div>

          <!-- 3. Select Student(s) -->
          <div>
            <label class="text-sm font-medium mb-1.5 block">Select Student(s)</label>
            <UInput
              v-model="studentSearch"
              icon="i-lucide-search"
              placeholder="Search by name or email..."
              class="w-full"
            />
            <div v-if="searchingStudents" class="text-xs text-muted mt-1.5">Searching...</div>
            <div
              v-else-if="studentSearchResults.length > 0"
              class="mt-1.5 rounded-lg border border-default divide-y divide-default max-h-40 overflow-y-auto"
            >
              <button
                v-for="s in studentSearchResults"
                :key="s.id"
                class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-elevated/40"
                @click="addStudent(s)"
              >
                <span class="truncate">
                  {{ s.name }} <span class="text-muted">· {{ s.email }}</span>
                </span>
                <UBadge v-if="s.existingAssignment" color="warning" variant="subtle" size="sm">already assigned</UBadge>
              </button>
            </div>
          </div>

          <!-- 4. Selected students + Season 04 confirmation -->
          <div v-if="selectedStudents.length > 0">
            <label class="text-sm font-medium mb-1.5 block">Season 04 Completion</label>
            <div class="rounded-lg border border-default divide-y divide-default">
              <div
                v-for="s in selectedStudents"
                :key="s.id"
                class="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">{{ s.name }}</p>
                  <p class="text-xs text-muted truncate">{{ s.program }} · {{ s.cohort }}</p>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                  <span
                    v-if="!s.season4.isCompleted"
                    class="text-xs text-warning"
                  >
                    {{ s.season4.progressPercentage }}% (not yet 75%)
                  </span>
                  <UCheckbox
                    v-model="season04Checked[s.id]"
                    :label="season04Checked[s.id] && !s.season4.isCompleted ? 'Completed (override)' : 'Season 04 Completed'"
                  />
                  <UButton
                    icon="i-lucide-x"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    square
                    @click="removeStudent(s.id)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" :disabled="saving" @click="handleClose">Cancel</UButton>
            <UButton :loading="saving" @click="handleSave">Save</UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
