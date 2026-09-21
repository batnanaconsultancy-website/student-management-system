<script setup lang="ts">
// pages/admin/canvas-masters/[email].vue
//
// The per-student dashboard that opens when an admin clicks a student
// on the Canvas Masters roster (pages/admin/canvas-masters.vue). Pulls
// together everything that used to live in that page's inline
// accordion -- name/program/cohort, attendance, and the full
// Course -> Learning Outcome -> Assignment tree -- into one focused
// view for a single student, instead of expanding in place.
//
// Route param is the student's email (URL-encoded), not the internal
// Canvas id, since a student who hasn't been Canvas-synced yet has no
// such id -- see server/utils/canvasMastersRoster.js.

definePageMeta({
  layout: 'default',
  middleware: ['admin'],
})

const route = useRoute()
const email = computed(() => decodeURIComponent(String(route.params.email)))

const student = ref<any>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function fetchStudent() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch(`/api/admin/canvas-masters/student/${encodeURIComponent(email.value)}`)
    student.value = res?.data?.student || null
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchStudent)
watch(email, fetchStudent)
</script>

<template>
  <UDashboardPanel id="canvas-masters-student" :ui="{ body: 'overflow-auto' }">
    <template #header>
      <UDashboardNavbar :title="student?.name || student?.email || 'Student Dashboard'">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            to="/admin/canvas-masters"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            class="ml-1"
          >
            Roster
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Loading -->
      <div v-if="loading" class="space-y-6">
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div class="lg:col-span-1">
            <UPageCard>
              <div class="flex flex-col items-center space-y-4 p-4">
                <USkeleton class="h-16 w-16 rounded-full" />
                <USkeleton class="h-6 w-32" />
                <USkeleton class="h-4 w-40" />
              </div>
            </UPageCard>
          </div>
          <div class="lg:col-span-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 h-full">
              <UPageCard v-for="i in 6" :key="i">
                <div class="space-y-3 p-4">
                  <USkeleton class="h-4 w-24" />
                  <USkeleton class="h-8 w-16" />
                </div>
              </UPageCard>
            </div>
          </div>
        </div>
        <UPageCard>
          <div class="space-y-3 p-4">
            <USkeleton v-for="i in 4" :key="i" class="h-10 w-full" />
          </div>
        </UPageCard>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex items-center justify-center h-64">
        <UCard class="max-w-md">
          <div class="text-center space-y-3">
            <UIcon name="i-lucide-alert-triangle" class="size-8 text-error mx-auto" />
            <h3 class="text-lg font-semibold">Couldn't load this student</h3>
            <p class="text-muted text-sm">{{ error }}</p>
            <UButton @click="fetchStudent" variant="outline">Try Again</UButton>
          </div>
        </UCard>
      </div>

      <!-- Content -->
      <div v-else-if="student" class="space-y-6">
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div class="lg:col-span-1">
            <AdminCanvasMastersStudentHeaderCard :student="student" />
          </div>
          <div class="lg:col-span-3 h-full w-full">
            <AdminCanvasMastersStudentStats :student="student" />
          </div>
        </div>

        <AdminCanvasMastersCoursesOutcomes :student="student" />
      </div>
    </template>
  </UDashboardPanel>
</template>
