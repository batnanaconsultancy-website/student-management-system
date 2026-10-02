<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const { user, examinerProfile, signOut } = useAuth();
const router = useRouter();

const mainLinks: NavigationMenuItem[] = [
  {
    label: "My Assessments",
    to: "/examiner/dashboard",
    icon: "i-lucide-clipboard-check",
    tooltip: { text: "My Assessments" },
  },
];

async function handleSignOut() {
  await signOut();
  router.push("/");
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      collapsible
      :ui="{ footer: 'border-t border-default', header: 'flex items-center gap-2' }"
    >
      <template #header="{ collapsed }">
        <UAvatar src="../public/favicon.png" size="xs" :class="collapsed ? 'm-auto' : 'ml-2'" />
        <p v-if="!collapsed" class="text-center text-xs xl:text-base font-semibold text-highlighted">Amsterdam Tech</p>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="mainLinks" orientation="vertical" />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex items-center gap-2 w-full" :class="collapsed ? 'justify-center' : ''">
          <UAvatar :text="examinerProfile?.name?.[0] || 'E'" size="sm" />
          <div v-if="!collapsed" class="min-w-0 flex-1">
            <p class="text-xs font-medium truncate">{{ examinerProfile?.name || user?.email }}</p>
            <p class="text-[11px] text-muted truncate">Examiner</p>
          </div>
          <UButton
            v-if="!collapsed"
            icon="i-lucide-log-out"
            size="xs"
            color="neutral"
            variant="ghost"
            square
            @click="handleSignOut"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
