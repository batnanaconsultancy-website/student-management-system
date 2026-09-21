<script setup lang="ts">
const props = defineProps<{
  student: {
    name: string | null
    email: string
    program: string
    cohortLabel: string
    canvasSynced: boolean
  }
}>()

const initials = computed(() => {
  const source = props.student.name || props.student.email
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
})

function handleSendEmail() {
  window.location.href = `mailto:${props.student.email}`
}
</script>

<template>
  <UCard class="w-full h-full" :ui="{ body: 'h-full flex flex-col justify-between gap-5' }">
    <div class="flex gap-4 items-center">
      <UAvatar :text="initials" size="xl" class="shrink-0" />
      <div class="flex flex-col min-w-0">
        <h2 class="text-xl font-bold truncate">{{ student.name || 'Not yet resolved on Canvas' }}</h2>
        <p class="text-muted text-sm truncate">{{ student.email }}</p>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        <p class="text-highlighted text-sm font-medium whitespace-nowrap">Program:</p>
        <p class="text-muted text-sm truncate">{{ student.program || 'N/A' }}</p>
      </div>
      <div class="flex gap-2">
        <p class="text-highlighted text-sm font-medium whitespace-nowrap">Cohort:</p>
        <p class="text-muted text-sm truncate">{{ student.cohortLabel || 'N/A' }}</p>
      </div>
    </div>

    <div class="w-full mt-auto flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <span class="text-xs text-muted">Canvas status</span>
        <UBadge :color="student.canvasSynced ? 'success' : 'warning'" variant="subtle" size="xs">
          {{ student.canvasSynced ? 'Synced' : 'Not synced yet' }}
        </UBadge>
      </div>

      <UButton
        color="neutral"
        variant="outline"
        class="w-full justify-center"
        icon="i-lucide-mail"
        @click="handleSendEmail"
      >
        Send Email
      </UButton>
    </div>
  </UCard>
</template>
