<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const appConfig = useAppConfig();

const { user, facultyProfile, isExaminer } = useAuth();

const userName = computed(
  () =>
    facultyProfile.value?.name ||
    user.value?.user_metadata?.full_name ||
    "Faculty Member",
);

const userImg = computed(() => user.value?.user_metadata?.picture || "");

const mainLinks = computed<NavigationMenuItem[]>(() => {
  const links: NavigationMenuItem[] = [
    {
      label: "Dashboard",
      to: "/faculty/dashboard",
      ariaLabel: "Faculty Dashboard",
      icon: "i-lucide-house",
      tooltip: {
        text: "Dashboard",
      },
    },
    {
      label: "Attendance",
      to: "/faculty/attendance",
      ariaLabel: "Attendance",
      icon: "i-lucide-clipboard-check",
      tooltip: {
        text: "Attendance",
      },
    },
    {
      label: "Analytics",
      to: "/faculty/analytics",
      ariaLabel: "Analytics",
      icon: "i-pajamas:chart",
      tooltip: {
        text: "Analytics",
      },
    },
    {
      label: "Guidance Inbox",
      to: "/faculty/guidance-inbox",
      ariaLabel: "Guidance Inbox",
      icon: "i-lucide-life-buoy",
      tooltip: {
        text: "Guidance Inbox",
      },
    },
  ];

  if (isExaminer.value) {
    links.push({
      label: "Examiner Assignments",
      to: "/faculty/examiner",
      ariaLabel: "Examiner Assignments",
      icon: "i-lucide-clipboard-list",
      tooltip: {
        text: "Examiner Assignments",
      },
    });
  }

  return links;
});

onMounted(() => {
  appConfig.ui.colors.primary = "blue";
  appConfig.ui.colors.neutral = "stone";
});
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      collapsible
      :ui="{
        footer: 'border-t border-default',
        header: 'flex items-center gap-2',
      }"
    >
      <template #header="{ collapsed }">
        <UAvatar
          src="/favicon.png"
          size="xs"
          :class="collapsed ? 'm-auto' : 'ml-2'"
        />

        <p
          v-if="!collapsed"
          class="text-center text-xs xl:text-base font-semibold text-highlighted"
        >
          Amsterdam Tech
        </p>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="mainLinks"
          orientation="vertical"
          :ui="{
            childItem: 'mt-1',
            link: 'mt-1',
          }"
        />
      </template>

      <template #footer="{ collapsed }">
        <RoleSwitcher />

        <div
          class="flex items-center gap-2 p-2"
          :class="collapsed ? 'justify-center' : ''"
        >
          <UAvatar :src="userImg" :alt="userName" size="sm" />

          <div v-if="!collapsed" class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ userName }}
            </p>

            <p class="truncate text-xs text-muted">Faculty</p>
          </div>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
