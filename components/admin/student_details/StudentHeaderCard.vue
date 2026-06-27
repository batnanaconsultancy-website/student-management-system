<script setup>
const props = defineProps({
  student: {
    type: Object,
    required: true
  }
})

const supabase = useSupabaseClient()
const toast = useToast()
const {cohorts, fetchCohorts} = useCohorts()
const {programs, programOptions, fetchPrograms} = usePrograms()
const items = ref([])
const isUpdating = ref(false)
const isModalOpen = ref(false)
const selectedCohortId = ref(null)
const isProgramModalOpen = ref(false)
const selectedProgramId = ref(null)
const isUpdatingProgram = ref(false)

onMounted(async () => {
  // Fetch cohorts filtered by the student's program
  await fetchCohorts({ program_id: props.student.program_id })

  items.value = cohorts.value.map(cohort => ({
    label: cohort.name,
    value: cohort.cohort_ids?.find(id => cohort.programs?.find(p => p.id === props.student.program_id && p.cohort_id === id))
  }))

  // Fetch all programs
  await fetchPrograms()

  // Set initial selected values
  selectedCohortId.value = props.student.cohort_id
  selectedProgramId.value = props.student.program_id
})

// Handle cohort change
const handleCohortChange = async () => {
  if (!selectedCohortId.value || selectedCohortId.value === props.student.cohort_id) {
    // No change needed
    isModalOpen.value = false
    return
  }

  try {
    isUpdating.value = true

    // Update student's cohort in the database
    const { error } = await supabase
      .from('students')
      .update({ cohort_id: selectedCohortId.value })
      .eq('id', props.student.id)

    if (error) throw error

    // Update the local student object
    props.student.cohort_id = selectedCohortId.value

    // Find and update the cohort name for display
    const selectedCohort = cohorts.value.find(c =>
      c.cohort_ids?.includes(selectedCohortId.value)
    )
    if (selectedCohort && props.student.cohorts) {
      props.student.cohorts.name = selectedCohort.name
    }

    toast.add({
      title: 'Success',
      description: 'Student cohort updated successfully',
      color: 'green'
    })

    // Close modal
    isModalOpen.value = false

    props.student.cohort_id = selectedCohortId.value
  } catch (error) {
    console.error('Error updating cohort:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to update student cohort',
      color: 'red'
    })
  } finally {
    isUpdating.value = false
  }
}

// Handle program change
const handleProgramChange = async () => {
  console.log("Selected program ID:", selectedProgramId.value)

  if (!selectedProgramId.value || selectedProgramId.value === props.student.program_id) {
    // No change needed
    isProgramModalOpen.value = false
    return
  }

  try {
    isUpdatingProgram.value = true

    // Get the current cohort name
    const currentCohortName = props.student.cohorts?.name

    // Find the cohort with the same name but for the new program
    let newCohortId = null
    if (currentCohortName) {
      const { data: matchingCohort } = await supabase
        .from('cohorts')
        .select('id')
        .eq('name', currentCohortName)
        .eq('program_id', selectedProgramId.value)
        .single()

      if (matchingCohort) {
        newCohortId = matchingCohort.id
      }
    }

    // Update student's program and cohort in the database
    const updateData = { program_id: selectedProgramId.value }
    if (newCohortId) {
      updateData.cohort_id = newCohortId
    }

    const { error } = await supabase
      .from('students')
      .update(updateData)
      .eq('id', props.student.id)

    if (error) throw error

    // Update the local student object
    props.student.program_id = selectedProgramId.value
    if (newCohortId) {
      props.student.cohort_id = newCohortId
      selectedCohortId.value = newCohortId
    }

    // Find and update the program name for display
    const selectedProgram = programs.value.find(p => p.id === selectedProgramId.value)
    if (selectedProgram && props.student.programs) {
      props.student.programs.name = selectedProgram.name
    }

    toast.add({
      title: 'Success',
      description: newCohortId
        ? 'Student program and cohort updated successfully.'
        : 'Student program updated. Please update the cohort manually.',
      color: 'green'
    })

    // Close modal
    isProgramModalOpen.value = false

    // Re-fetch cohorts for the new program
    await fetchCohorts({ program_id: selectedProgramId.value })

    // Update cohort items dropdown
    items.value = cohorts.value.map(cohort => ({
      label: cohort.name,
      value: cohort.cohort_ids?.find(id => cohort.programs?.find(p => p.id === selectedProgramId.value && p.cohort_id === id))
    }))
  } catch (error) {
    console.error('Error updating program:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to update student program',
      color: 'red'
    })
  } finally {
    isUpdatingProgram.value = false
  }
}

// Format ISO datetime to human friendly: "28 Oct, 2024 at 23:20"
const formatDateTime = (iso) => {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null

    const day = String(d.getDate()).padStart(2, '0')
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = monthNames[d.getMonth()]
    const year = d.getFullYear()

    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')

    return `${day} ${month}, ${year} at ${hours}:${minutes}`
  } catch (e) {
    return null
  }
}

const emit = defineEmits(['send-email', 'send-slack-message'])

// Student account status management
const isUpdatingStatus = ref(false)
const isStatusModalOpen = ref(false)
const selectedStatus = ref(props.student.account_status || 'Active')

const statusOptions = [
  { label: 'Active', value: 'Active', color: 'success' },
  { label: 'Inactive', value: 'Inactive', color: 'warning' },
  { label: 'Frozen', value: 'Frozen', color: 'info' },
  { label: 'Graduated', value: 'Graduated', color: 'neutral' },
]

const statusColor = computed(() => {
  const map = { Active: 'success', Inactive: 'warning', Frozen: 'info', Graduated: 'neutral' }
  return map[props.student.account_status] || 'neutral'
})

const handleStatusChange = async () => {
  if (selectedStatus.value === props.student.account_status) {
    isStatusModalOpen.value = false
    return
  }
  try {
    isUpdatingStatus.value = true
    const res = await $fetch('/api/students/update-status', {
      method: 'POST',
      body: { student_id: props.student.id, account_status: selectedStatus.value }
    })
    props.student.account_status = res.data.account_status
    props.student.is_active = res.data.is_active
    toast.add({ title: 'Status updated', description: res.message, color: 'success' })
    isStatusModalOpen.value = false
  } catch (err) {
    toast.add({ title: 'Error', description: err?.data?.statusMessage || 'Failed to update status', color: 'error' })
  } finally {
    isUpdatingStatus.value = false
  }
}

const handleSendEmail = () => {
  window.location.href = `mailto:${props.student.email}`
}

const handleSendSlackMessage = () => {
  window.open(`https://slack.com/app_redirect?channel=${props.student.slack_id}`, '_blank')
}
</script>

<template>
  <UCard class="w-full h-full"
    
    :ui="{
      body: 'h-full flex flex-col justify-between gap-5',
    }"
  >
      <div class="flex gap-4 items-center">
         <UAvatar
          :src="student.profile_image_url"
          :alt="`${student.first_name} ${student.last_name}`"
          class="h-12 w-12 flex-shrink-0 mt-1"
        />

        <div class="flex flex-col min-w-0">
            <h2 class="text-xl font-bold truncate">{{ student.first_name }} {{ student.last_name }}</h2>
            <p class="text-muted text-sm truncate">{{ student.email || 'N/A' }}</p>
        </div>
      </div>

        <div class="flex flex-col gap-4">
           <div class="flex gap-2">
            <p class="text-highlighted text-sm font-medium whitespace-nowrap">Username:</p>
            <p class="text-muted text-sm truncate">{{ student.username || 'N/A' }}</p>
          </div>

          <div class="flex gap-2 items-center">
            <p class="text-highlighted text-sm font-medium whitespace-nowrap">Cohort:</p>
            <p class="text-muted text-sm truncate">{{ student.cohorts?.name || 'N/A' }}</p>
            <UModal v-model:open="isModalOpen" title="Change Cohort" :ui="{ footer: 'justify-end' }" class="ml-auto">
              <UButton color="neutral" icon="i-lucide-edit" variant="soft" />

              <template #body>
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium mb-2">Select New Cohort</label>
                    <USelect
                      v-model="selectedCohortId"
                      :items="items"
                      :disabled="isUpdating"
                      :loading="isUpdating"
                      placeholder="Select Cohort"
                      class="w-full"
                    />
                  </div>
                </div>
              </template>

              <template #footer="{ close }">
                <UButton label="Cancel" color="neutral" variant="outline" @click="close" :disabled="isUpdating" />
                <UButton
                  label="Save"
                  variant="subtle"
                  color="primary"
                  @click="handleCohortChange"
                  :loading="isUpdating"
                  :disabled="isUpdating || !selectedCohortId"
                />
              </template>
            </UModal>
          </div>

          <div class="flex gap-2 items-center">
            <p class="text-highlighted text-sm font-medium whitespace-nowrap">Program:</p>
            <p class="text-muted text-sm truncate">{{ student.programs?.name || 'N/A' }}</p>
            <UModal v-model:open="isProgramModalOpen" title="Change Program" :ui="{ footer: 'justify-end' }" class="ml-auto">
              <UButton color="neutral" icon="i-lucide-edit" variant="soft" />

              <template #body>
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium mb-2">Select New Program</label>
                    <USelect
                      v-model="selectedProgramId"
                      :items="programOptions"
                      :disabled="isUpdatingProgram"
                      :loading="isUpdatingProgram"
                      placeholder="Select Program"
                      class="w-full"
                    />
                  </div>
                </div>
              </template>

              <template #footer="{ close }">
                <UButton label="Cancel" color="neutral" variant="outline" @click="close" :disabled="isUpdatingProgram" />
                <UButton
                  label="Save"
                  variant="subtle"
                  color="primary"
                  @click="handleProgramChange"
                  :loading="isUpdatingProgram"
                  :disabled="isUpdatingProgram || !selectedProgramId"
                />
              </template>
            </UModal>
          </div>

          <div class="flex gap-2">
            <p class="text-highlighted text-sm font-medium whitespace-nowrap">Last Activity:</p>
            <p class="text-muted text-sm">{{ formatDateTime(student.last_login) || 'N/A' }}</p>
          </div>
        </div>

        <div class="w-full mt-auto flex flex-col gap-2">

          <!-- Account status badge + change control -->
          <div class="flex items-center justify-between px-1">
            <span class="text-xs text-muted">Account status</span>
            <UBadge :color="statusColor" variant="subtle" size="xs">
              {{ student.account_status || 'Active' }}
            </UBadge>
          </div>

          <UModal v-model:open="isStatusModalOpen">
            <UButton
              color="neutral"
              variant="outline"
              class="w-full justify-center"
              icon="i-lucide-shield"
              @click="selectedStatus = student.account_status; isStatusModalOpen = true"
            >
              Change Status
            </UButton>
            <template #content>
              <UCard>
                <template #header>
                  <p class="font-medium text-highlighted">Change Account Status</p>
                  <p class="text-xs text-muted mt-1">
                    Setting to Inactive, Frozen, or Graduated will stop this student from
                    being scraped and exclude them from active student counts.
                  </p>
                </template>
                <URadioGroup
                  v-model="selectedStatus"
                  :options="statusOptions"
                  value-key="value"
                  label-key="label"
                  class="space-y-2"
                />
                <template #footer>
                  <div class="flex justify-end gap-2">
                    <UButton label="Cancel" color="neutral" variant="outline" @click="isStatusModalOpen = false" :disabled="isUpdatingStatus" />
                    <UButton
                      label="Update Status"
                      color="primary"
                      :loading="isUpdatingStatus"
                      @click="handleStatusChange"
                    />
                  </div>
                </template>
              </UCard>
            </template>
          </UModal>

          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="outline"
              class="flex-1 justify-center"
              @click="handleSendEmail"
            >
              Send Email
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              class="flex-1 justify-center"
              @click="handleSendSlackMessage"
            >
              Slack Message
            </UButton>
          </div>
        </div>
  </UCard>
</template>
