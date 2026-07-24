<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import UserMenuAdmin from "~/components/admin/UserMenuAdmin.vue";

const supabase = useSupabaseClient();
const appConfig = useAppConfig();

const userName = ref("");
const userImg = ref("");

const mainLinks: NavigationMenuItem[] = [
  {
    label: "Dashboard",
    to: "/admin/dashboard",
    ariaLabel: "Dashboard",
    icon: "i-lucide-lab:house-roof",
    tooltip: {
      text: "Dashboard",
    },
  },
  {
    label: "Guidance Inbox",
    to: "/admin/guidance-inbox",
    ariaLabel: "Guidance Inbox",
    icon: "i-lucide-life-buoy",
    tooltip: {
      text: "Guidance Inbox",
    },
  },
  {
    label: "Attendance",
    to: "/admin/attendance",
    ariaLabel: "Attendance",
    icon: "i-lucide-clipboard-check",
    tooltip: {
      text: "Attendance",
    },
  },
  {
    label: "Analytics",
    icon: "i-pajamas:chart",
    ariaLabel: "Analytics",
    defaultOpen: false,
    to: "/admin/analytics/overall",
    type: "trigger",
    tooltip: {
      text: "Analytics",
    },
    children: [
      {
        label: "Attendance Overall ",
        description: "Overall attendance analytics among all students.",
        to: "/admin/analytics/overall",
      },
      {
        label: "Attendance Cohort ",
        description: "Cohort-based attendance analytics.",
        to: "/admin/analytics/cohort",
      },
    ],
  },
  {
    label: "Cohorts",
    to: "/admin/cohorts",
    ariaLabel: "Cohorts",
    icon: "i-pajamas:group",
    tooltip: {
      text: "Cohorts",
    },
  },
  {
    label: "Managment",
    icon: "i-pajamas:issue-type-maintenance",
    ariaLabel: "Managment",
    defaultOpen: false,
    to: "/admin/managment/students",
    type: "trigger",
    tooltip: {
      text: "Managment",
    },
    children: [
      {
        label: "Students ",
        description: "Manage students information and details.",
        to: "/admin/managment/students",
      },
      {
        label: "Seasons ",
        description: "Manage seasons start and end date.",
        to: "/admin/managment/seasons",
      },
      {
        label: "Projects",
        description: "Manage projects start and end date.",
        to: "/admin/managment/pcs-projects",
      },
      {
        label: "Curriculum",
        description: "Create new seasons and projects.",
        icon: "i-lucide-book-open",
        to: "/admin/managment/curriculum",
      },
      {
        label: "Extra Tracks",
        description: "Students tracking an additional season/course.",
        icon: "i-lucide-layers",
        to: "/admin/managment/extra-tracks",
      },
      {
        label: "Meetings",
        description: "Schedule weekly meetings pinned to student calendars.",
        icon: "i-lucide-calendar-clock",
        to: "/admin/managment/meetings",
      },
    ],
  },
];

onMounted(async () => {
  // Initialize active link based on current route or default to first link
  const {
    data: { user },
  } = await supabase.auth.getUser();
  userName.value = user?.user_metadata?.full_name || "Unknown User";
  userImg.value = user?.user_metadata?.picture;
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
          src="../public/favicon.png"
          size="xs"
          :class="collapsed ? 'm-auto' : 'ml-2'"
        />
        <!-- <NuxtImg src="../public/favicon.png" alt="Logo" class="h-6" :class="collapsed ? 'm-auto' : 'ml-2'" /> -->
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
        <UserMenuAdmin
          :collapsed="collapsed"
          :userLabel="userName"
          :userAvatar="userImg"
        />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
