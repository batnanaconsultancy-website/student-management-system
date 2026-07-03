<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCohorts } from '~/composables/useCohorts'
import { usePrograms } from '~/composables/usePrograms'
import { useNotifications } from '~/composables/useNotifications'
import { useValidation } from '~/composables/useValidation'
import CohortsTable from '~/components/admin/CohortsTable.vue'
import * as z from 'zod'

definePageMeta({
    layout: "default",
    middleware: ["admin"],
});

// Use composables
const { cohorts, loading, fetchCohorts, createCohort, toggleCohortStatus } = useCohorts()
const { programs, programOptions, fetchPrograms } = usePrograms()
const { showSuccess, showError } = useNotifications()
const { validateRequiredFields, validateDateRange } = useValidation()

const isModalOpen = ref(false)
const formRef = ref(null)

const selectedPrograms = ref<string[]>([])
const programDates = ref<Record<string, { start_date: string; end_date: string }>>({})

const schema = z.object({
  cohortName: z.string().min(1, 'Cohort name is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  meetingId: z.string().optional(),
  isActive: z.boolean(),
})

type Schema = z.output<typeof schema>

const state = ref<Schema>({
  cohortName: '',
  startDate: '',
  endDate: '',
  meetingId: '',
  isActive: true,
})

onMounted(async () => {
  await Promise.all([fetchCohorts(), fetchPrograms()])
})

function openModal() {
  isModalOpen.value = true
}

function closeModal() {
  isModalOpen.value = false
  // Reset form on close
  state.value = {
    cohortName: '',
    startDate: '',
    endDate: '',
    meetingId: '',
    isActive: true,
  }
  selectedPrograms.value = []
  programDates.value = {}
}

async function handleToggleStatus({ cohortName, isActive }: { cohortName: string, isActive: boolean }) {
  try {
    const response = await toggleCohortStatus(cohortName, isActive)
    showSuccess(
      'Success',
      response.message || `Cohort ${isActive ? 'activated' : 'deactivated'} successfully`,
      'i-lucide-check-circle'
    )
  } catch (err: any) {
    showError(
      'Error',
      err?.data?.statusMessage || 'Failed to update cohort status',
      'i-lucide-x-circle'
    )
  }
}

const submitForm = async () => {
  try {
    // Validate required fields
    const validation = validateRequiredFields(
      {
        cohortName: state.value.cohortName,
        startDate: state.value.startDate,
        endDate: state.value.endDate,
        programs: selectedPrograms.value
      },
      ['cohortName', 'startDate', 'endDate', 'programs']
    )

    if (!validation.isValid) {
      throw new Error(`Missing required fields: ${validation.missingFields.join(', ')}`)
    }

    // Validate date range
    const dateValidation = validateDateRange(state.value.startDate, state.value.endDate)
    if (!dateValidation.isValid) {
      throw new Error(dateValidation.error)
    }

    // Extract program IDs from the selected objects
    const programsPayload = selectedPrograms.value.map((item: any) => {
      const programId = typeof item === 'string' ? item : item.value
      return {
        program_id: programId,
        start_date: state.value.startDate,
        end_date: state.value.endDate,
      }
    })

    const payload = {
      name: state.value.cohortName,
      meeting_id: state.value.meetingId || undefined,
      is_active: state.value.isActive,
      programs: programsPayload,
    }

    await createCohort(payload)
    showSuccess('Cohort created', 'Cohort(s) created successfully', 'i-lucide-check-circle')

    // Refresh cohorts and close modal
    await fetchCohorts()
    closeModal()
  } catch (err: any) {
    showError(
      'Error',
      err?.message || err?.data?.statusMessage || 'Failed to create cohort',
      'i-lucide-x-circle'
    )
    throw err
  }
}
</script>

<template>
    <UDashboardPanel id="cohorts">
        <template #header>
            <UDashboardNavbar title="Cohorts" >
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            <template #right>
                <NotificationBell />
            </template>
            </UDashboardNavbar>
        </template>

        <template #body>
          <!-- Stats Card -->
          <UPageGrid class="lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-px">
            <StudentStatCard
              title="Total Cohorts"
              :count="cohorts.length"
              icon="i-pajamas:subgroup"
              icon-color="info"
              rounded-class="rounded-lg xl:rounded-none xl:rounded-l-lg lg:rounded-r-none"
            />
            
            <StudentStatCard
              title="Active Cohorts"
              :count="cohorts.filter(cohort => cohort.is_active).length"
              icon="i-pajamas:status-health"
              icon-color="success"
              rounded-class="rounded-lg xl:rounded-none xl:rounded-r-lg lg:rounded-l-none"
            />
          </UPageGrid>
        
          <div class="flex justify-end mb-4">
            <UButton
              label="Add Cohort"
              color="neutral"
              variant="outline"
              icon="i-codex:plus"
              class="w-fit"
              @click="openModal"
            />
          </div>

          <UModal
            v-model:open="isModalOpen"
            title="Create New Cohort"
            description="Add new cohort details below"
            :ui="{
              content: 'sm:max-w-2xl',
              body: 'p-6',
              footer: 'flex justify-end gap-2 p-4'
            }"
          >
            <template #body>
              <UForm ref="formRef" :schema="schema" :state="state" class="space-y-6 px-10">
                <UFormField label="Cohort Name" name="cohortName" description="e.g., Sep 24, Mar 25" required>
                  <UInput v-model="state.cohortName" placeholder="e.g., Sep 24" class="w-full"/>
                </UFormField>

                <UFormField label="Programs" description="Select programs for this cohort" required>
                  <USelectMenu
                    v-model="selectedPrograms"
                    multiple
                    :items="programOptions"
                    placeholder="Select programs"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="Meeting ID" name="meetingId" description="Optional meeting ID for cohort sessions">
                  <UInput v-model="state.meetingId" placeholder="Enter meeting ID" class="w-full"/>
                </UFormField>

                <div class="flex gap-4 w-full">
                  <UFormField label="Start Date" name="startDate" description="Cohort start date" required class="w-full">
                    <UInput
                      v-model="state.startDate"
                      type="date"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField label="End Date" name="endDate" description="Cohort end date" required class="w-full">
                    <UInput
                      v-model="state.endDate"
                      type="date"
                      class="w-full"
                    />
                  </UFormField>
                </div>
          
                <UFormField label="Active Status" name="isActive" description="Set cohort as active or inactive">
                  <div class="flex items-center gap-2">
                    <USwitch v-model="state.isActive" />
                    <span class="text-sm">{{ state.isActive ? 'Active' : 'Inactive' }}</span>
                  </div>
                </UFormField>
              </UForm>
            </template>

            <template #footer="{ close }">
              <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
              <UButton label="Create Cohort" color="success" icon="i-lucide-plus" @click="submitForm" :loading="loading" />
            </template>
          </UModal>

          <CohortsTable :data="cohorts" :loading="loading" @toggle-status="handleToggleStatus" />
        </template>
    </UDashboardPanel>
</template>