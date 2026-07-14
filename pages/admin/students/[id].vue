<script setup>
definePageMeta({
  layout: 'default',
  middleware: ['admin']
})

const route = useRoute()
const studentId = route.params.id

// Use the new composable for data fetching
const {
  student,
  projectCompletions,
  seasonProgress,
  loading,
  error,
  fetchAllStudentData
} = useStudentDetails()

// Fetch all data when component mounts. Always force a fresh fetch --
// this page exists so admins can check a student's *current* standing,
// so silently serving a stale in-memory cache (which has no expiry and
// nothing else invalidates) would be actively misleading.
onMounted(async () => {
  await fetchAllStudentData(studentId, true)
})

const handleSendEmail = (student) => {
  // TODO: Implement email functionality
  console.log('Send email to:', student.email)
}

const handleSendSlackMessage = (student) => {
  // TODO: Implement Slack message functionality
  console.log('Send Slack message to:', student.first_name, student.last_name)
}
</script>

<template>
  <UDashboardPanel id="student-detail"
    :ui="{body: 'overflow-auto'}"
  >
    <template #header>
      <UDashboardNavbar title="Students Details">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      <template #right>
          <NotificationBell />
      </template>
      </UDashboardNavbar>
    </template>

    <template #body>
        <!-- Loading Skeletons -->
        <div v-if="loading" class="space-y-6">
          <!-- Header and Stats Section Skeleton -->
          <div class="grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-4 gap-6">
            <!-- Student Header Card Skeleton -->
            <div class="lg:col-span-4 xl:col-span-1">
              <UPageCard>
                <div class="flex flex-col items-center space-y-4 p-4">
                  <USkeleton class="h-24 w-24 rounded-full" />
                  <USkeleton class="h-6 w-32" />
                  <USkeleton class="h-4 w-40" />
                  <div class="w-full space-y-2">
                    <USkeleton class="h-10 w-full" />
                    <USkeleton class="h-10 w-full" />
                  </div>
                </div>
              </UPageCard>
            </div>

            <!-- Stats Cards Skeleton -->
            <div class="lg:col-span-4 xl:col-span-3">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 h-full">
                <UPageCard v-for="i in 6" :key="i">
                  <div class="space-y-3 p-4">
                    <div class="flex items-center gap-3">
                      <USkeleton class="h-10 w-10 rounded-full" />
                      <USkeleton class="h-4 w-24" />
                    </div>
                    <USkeleton class="h-8 w-16" />
                  </div>
                </UPageCard>
              </div>
            </div>
          </div>

          <!-- Season Progress Table Skeleton -->
          <UPageCard>
            <div class="space-y-4 p-4">
              <USkeleton class="h-6 w-48" />
              <div class="space-y-3">
                <USkeleton v-for="i in 5" :key="i" class="h-16 w-full" />
              </div>
            </div>
          </UPageCard>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="flex items-center justify-center h-64">
          <UCard class="max-w-md">
            <div class="text-center space-y-3">
              <div class="text-red-500 text-4xl">⚠️</div>
              <h3 class="text-lg font-semibold">Error Loading Student</h3>
              <p class="text-muted text-sm">{{ error }}</p>
              <UButton @click="fetchAllStudentData(studentId, true)" variant="outline">
                Try Again
              </UButton>
            </div>
          </UCard>
        </div>

        <!-- Actual Content -->
        <div v-else-if="student" class="space-y-6">
          <!-- Header and Stats Section -->
          <div class="grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-4 gap-6">
            <!-- Student Header Card - takes 1 column on large screens -->
            <div class="lg:col-span-4 xl:col-span-1">
              <AdminStudentDetailsStudentHeaderCard
                :student="student"
                @send-email="handleSendEmail"
                @send-slack-message="handleSendSlackMessage"
              />
            </div>

            <!-- Stats Cards - takes 3 columns on large screens -->
            <div class="lg:col-span-4 xl:col-span-3 h-full w-full">
              <AdminStudentDetailsStudentStats :student="student" />
            </div>
          </div>

          <!-- Season Progress -->
          <AdminStudentDetailsSeasonProgressTable :season-progress="seasonProgress" />
        </div>
    </template>
  </UDashboardPanel>
</template>
