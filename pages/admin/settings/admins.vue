<script setup lang="ts">
definePageMeta({
  layout: "default",
  middleware: ["admin"],
});

const emails = ref<string[]>([])

// Use composables
const { validateEmails, isNotEmpty } = useValidation()
const { addAdmins: addAdminsApi, fetchAdmins, removeAdmin, admins, loading: adminLoading } = useAdminApi()
const { showSuccess, showError } = useNotifications()

onMounted(() => {
  fetchAdmins()
})

async function addAdmins() {
  if (!isNotEmpty(emails.value)) {
    showError('Error', 'Please enter at least one email address')
    return
  }

  const validation = validateEmails(emails.value)

  if (!validation.isValid) {
    showError('Error', `Invalid email(s): ${validation.invalid.join(', ')}`)
    return
  }

  try {
    const response = await addAdminsApi(emails.value)
    const description = response.message || `Successfully added admin user(s)`

    showSuccess('Success', description)
    emails.value = []
    await fetchAdmins()
  } catch (error: any) {
    showError('Error', error.data?.statusMessage || error.data?.message || 'Failed to add admin users')
  }
}

async function handleRemoveAdmin(email: string) {
  try {
    await removeAdmin(email)
    showSuccess('Success', `${email} removed from admins`)
  } catch (error: any) {
    showError('Error', error.data?.statusMessage || error.data?.message || 'Failed to remove admin')
  }
}
</script>

<template>
      <div class="mt-6 w-full lg:max-w-2xl mx-auto gap-6 space-y-8">
        <!-- Admin Management Section -->
        <div>
          <h1 class="text-highlighted font-medium text-left w-full">Admin Management</h1>
          <p class="text-muted text-[15px] text-pretty mt-1">Manage admin users</p>

          <UCard
            variant="subtle"
            class="mt-4"
            :ui="{ body: '!py-4 w-full !px-8' }"
          >
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-highlighted mb-2">
                  Add Admin Users
                </label>
                <p class="text-muted text-sm mb-3">
                  Enter email addresses to grant admin access. Press Enter to add multiple emails.
                </p>
                <UInputTags
                  v-model="emails"
                  placeholder="Enter email addresses..."
                  size="md"
                  class="w-full"
                />
              </div>

              <UButton
                @click="addAdmins"
                :loading="adminLoading"
                :disabled="emails.length === 0"
                color="primary"
                variant="subtle"
                block
              >
                Add {{ emails.length > 0 ? emails.length : '' }} Admin{{ emails.length !== 1 ? 's' : '' }}
              </UButton>
            </div>
          </UCard>
        </div>

        <!-- Current Admins List -->
        <div>
          <h2 class="text-highlighted font-medium text-left w-full">Current Admins</h2>
          <p class="text-muted text-[15px] text-pretty mt-1">People with admin access to this system</p>

          <UCard
            variant="subtle"
            class="mt-4"
            :ui="{ body: '!py-4 w-full !px-8' }"
          >
            <div v-if="adminLoading && admins.length === 0" class="text-muted text-sm py-4 text-center">
              Loading admins...
            </div>
            <div v-else-if="admins.length === 0" class="text-muted text-sm py-4 text-center">
              No admins found.
            </div>
            <ul v-else class="divide-y divide-default">
              <li
                v-for="admin in admins"
                :key="admin.id"
                class="flex items-center justify-between py-3"
              >
                <span class="text-sm text-highlighted">{{ admin.email }}</span>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  @click="handleRemoveAdmin(admin.email)"
                >
                  Remove
                </UButton>
              </li>
            </ul>
          </UCard>
        </div>
      </div>
</template>
