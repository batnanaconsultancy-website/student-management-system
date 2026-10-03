<script setup lang="ts">
definePageMeta({
  layout: "faculty",
  middleware: ["faculty"],
});

const { data, pending, error, refresh } = await useFetch(
  "/api/faculty/guidance-requests",
);

const requests = computed(() => data.value?.data || []);

const statusOptions = ["New", "In Progress", "Resolved"];

const updatingId = ref<string | null>(null);

const statusColor = (status: string) => {
  if (status === "Resolved") return "success";
  if (status === "In Progress") return "warning";
  return "primary";
};

const formatDate = (value: string) => {
  if (!value) return "";

  return new Date(value).toLocaleString();
};

const updateStatus = async (id: string, status: string) => {
  updatingId.value = id;

  try {
    await $fetch("/api/faculty/guidance-requests/update-status", {
      method: "POST",
      body: {
        id,
        status,
      },
    });

    await refresh();
  } catch (err: any) {
    console.error("Failed to update guidance request:", err);
  } finally {
    updatingId.value = null;
  }
};
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar>
        <template #left>
          <div>
            <h1 class="text-xl font-semibold">Guidance Inbox</h1>

            <p class="text-sm text-muted">
              Review and manage student guidance requests.
            </p>
          </div>
        </template>

        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="soft"
            :loading="pending"
            @click="refresh()"
          >
            Refresh
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <UAlert
          v-if="error"
          title="Unable to load guidance requests"
          :description="error.message"
          icon="i-lucide-alert-circle"
          color="error"
          variant="soft"
        />

        <UAlert
          title="Faculty guidance access"
          description="Guidance requests are shown without student names, email addresses, usernames, or other student profile information."
          icon="i-lucide-shield-check"
          color="primary"
          variant="soft"
        />

        <div
          v-if="pending && !requests.length"
          class="flex items-center justify-center py-12"
        >
          <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin" />
        </div>

        <div v-else-if="!requests.length" class="py-12 text-center">
          <UIcon name="i-lucide-inbox" class="mx-auto h-10 w-10 text-muted" />

          <p class="mt-3 font-medium">No guidance requests</p>

          <p class="mt-1 text-sm text-muted">
            There are currently no guidance requests to review.
          </p>
        </div>

        <div v-else class="space-y-4">
          <UCard v-for="request in requests" :key="request.id">
            <div class="space-y-4">
              <div
                class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                      v-for="category in request.categories || []"
                      :key="category"
                      color="neutral"
                      variant="soft"
                    >
                      {{ category }}
                    </UBadge>
                  </div>

                  <p class="mt-2 text-xs text-muted">
                    {{ formatDate(request.created_at) }}
                  </p>
                </div>

                <UBadge :color="statusColor(request.status)" variant="soft">
                  {{ request.status }}
                </UBadge>
              </div>

              <div class="rounded-lg bg-elevated/50 p-4">
                <p class="whitespace-pre-wrap text-sm leading-6">
                  {{ request.message }}
                </p>
              </div>

              <div
                class="flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p class="text-sm text-muted">Update request status</p>

                <USelect
                  :model-value="request.status"
                  :items="statusOptions"
                  :disabled="updatingId === request.id"
                  class="w-full sm:w-48"
                  @update:model-value="updateStatus(request.id, $event)"
                />
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
