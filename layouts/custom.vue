<script setup lang="ts">
  import { onMounted, watch } from "vue";
  import type {  NavigationMenuItem } from "@nuxt/ui";

  const supabase = useSupabaseClient();

  const userName = ref<string | null>(null);
  const userImg = ref<string | null>(null);
  const userLoading = ref(true);
  const studentData = ref(null);

  const mainLinks: NavigationMenuItem[] = [
    {
      label: "Home",
      to: "/students/dashboard",
      icon: "i-lucide:house",
      tooltip: {
        text: "Home",
      },
    },
    {
      label: "Calendar",
      to: "/students/calendar",
      ariaLabel: "Calendar",
      icon: "i-lucide-calendar",
      tooltip: {
        text: "Calendar",
      },
    },
    {
      label: "Timeline",
      to: "/students/timeline",
      icon: "i-lucide:folder-clock",
      tooltip: {
        text: "Timeline",
      },
    },
    {
      label: "Roadmap",
      to: "/students/roadmap",
      icon: "i-lucide-map",
      tooltip: {
        text: "Roadmap",
      },
    },
    {
      label: "AI-Mentor",
      to: "/students/ai-mentor",
      ariaLabel: "AI-Mentor",
      icon: "i-lucide:bot",
      tooltip: {
        text: "AI-Mentor",
      },
    },
    {
      label: "Notifications",
      to: "/students/notifications",
      ariaLabel: "Notifications",
      icon: "i-lucide-bell",
      tooltip: {
        text: "Notifications",
      },
    },
  ];

  const secondaryLinks: NavigationMenuItem[] = [
    {
      label: "Notion",
      icon: "i-lineicons:notion",
      to: "https://www.notion.so/elu-programme/Help-Sheet-5ee210707ad24004b0d35473d7fb6f4e",
      target: "_blank",
      tooltip: {
        text: "Go to Notion docs",
      },
    },
  ];

  onMounted(async () => {
    // Initialize active link based on current route or default to first link
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userName.value = user?.user_metadata?.full_name || "Unknown User";
    userImg.value = user?.user_metadata?.picture;

    // Fetch student data for the student card feature
    if (user?.email) {
      const { data, error } = await supabase
        .from("students")
        .select(`
          *,
          programs:program_id ( name ),
          cohorts:cohort_id ( name )
        `)
        .eq("email", user.email)
        .single();

      if (!error && data) {
        studentData.value = data;
      }
    }

    userLoading.value = false;
  });
</script>

<template>
   <UDashboardGroup>
        <UDashboardSidebar 
            collapsible 
            :ui="{ 
                footer: 'border-t border-default', 
                header: 'flex items-center gap-2'
            }"
        >
            <template #header="{ collapsed }">
                <UAvatar src="../public/favicon.png" size="xs" :class="collapsed ? 'm-auto' : 'ml-2'" />
                <!-- <NuxtImg src="../public/favicon.png" alt="Logo" class="h-6" :class="collapsed ? 'm-auto' : 'ml-2'" /> -->
                <p v-if="!collapsed" class="text-center text-xs xl:text-base font-semibold text-highlighted">Amsterdam Tech</p>
            </template>

            <template #default="{ collapsed }">
                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="mainLinks"
                    orientation="vertical"
                    :ui="{
                      childItem: 'mt-1',
                      link: 'mt-1'
                    }"
                />

                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="secondaryLinks"
                    orientation="vertical"
                    class="mt-auto"
                />
            </template>

            <template #footer="{ collapsed }">
                <StudentsUserMenu :collapsed="collapsed" :userLabel="userName" :userAvatar="userImg" :student="studentData"/>
            </template>
        </UDashboardSidebar>

        <slot />

  </UDashboardGroup>
</template>
