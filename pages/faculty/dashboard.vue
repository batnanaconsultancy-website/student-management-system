<script setup lang="ts">
definePageMeta({
  layout: "faculty",
  middleware: ["faculty"],
});

const { facultyProfile, isExaminer } = useAuth();
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar>
        <template #left>
          <div>
            <h1 class="text-xl font-semibold">Faculty Dashboard</h1>

            <p class="text-sm text-muted">
              Welcome back, {{ facultyProfile?.name || "Faculty Member" }}.
            </p>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold">Overview</h2>

          <p class="text-sm text-muted mt-1">
            Access attendance, analytics, guidance requests, and assigned
            examiner work.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-clipboard-check" class="size-5" />

                <span class="font-medium"> Attendance </span>
              </div>
            </template>

            <p class="text-sm text-muted">
              View attendance information and aggregate attendance data.
            </p>

            <template #footer>
              <UButton to="/faculty/attendance" variant="soft" block>
                Open Attendance
              </UButton>
            </template>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-pajamas:chart" class="size-5" />

                <span class="font-medium"> Analytics </span>
              </div>
            </template>

            <p class="text-sm text-muted">
              View aggregate academic and attendance analytics.
            </p>

            <template #footer>
              <UButton to="/faculty/analytics" variant="soft" block>
                Open Analytics
              </UButton>
            </template>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-life-buoy" class="size-5" />

                <span class="font-medium"> Guidance Inbox </span>
              </div>
            </template>

            <p class="text-sm text-muted">
              View and respond to guidance requests.
            </p>

            <template #footer>
              <UButton to="/faculty/guidance-inbox" variant="soft" block>
                Open Inbox
              </UButton>
            </template>
          </UCard>

          <UCard v-if="isExaminer">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-clipboard-list" class="size-5" />

                <span class="font-medium"> Examiner </span>
              </div>
            </template>

            <p class="text-sm text-muted">
              Access final-project assessments assigned to you.
            </p>

            <template #footer>
              <UButton to="/faculty/examiner" variant="soft" block>
                Open Assignments
              </UButton>
            </template>
          </UCard>
        </div>

        <UAlert
          title="Faculty access"
          description="Faculty accounts do not have access to student management or the administrative student database."
          icon="i-lucide-shield-check"
          color="primary"
          variant="soft"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
