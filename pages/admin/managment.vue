<script setup lang="ts">
definePageMeta({
    layout: "default",
    middleware: ["admin"], 
});

import type { NavigationMenuItem } from '@nuxt/ui'

const links = [[ {
  label: 'Students',
  icon: 'i-pajamas:users',
  to: '/admin/managment/students'
}, {
  label: 'Seasons',
  icon: 'i-pajamas:issue-type-objective',
  to: '/admin/managment/seasons'
},
{
    label: 'Projects',
    icon: 'i-pajamas:book',
    to: '/admin/managment/pcs-projects'
},
{
    label: 'Meetings',
    icon: 'i-lucide-calendar-clock',
    to: '/admin/managment/meetings'
}],] satisfies NavigationMenuItem[][]
</script>

<template>
    <UDashboardPanel id="managment">
        <template #header>
            <UDashboardNavbar title="Managment" >
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            <template #right>
                <NotificationBell />
            </template>
            </UDashboardNavbar>

            <UDashboardToolbar>
                <UNavigationMenu :items="links" highlight class="-mx-1 flex-1" />
            </UDashboardToolbar>
        </template>

        <template #body>
            <NuxtPage />
        </template>
    </UDashboardPanel>
</template>