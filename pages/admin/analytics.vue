<script setup lang="ts">
definePageMeta({
    layout: "default",
    middleware: ["admin"], 
});

import type { NavigationMenuItem } from '@nuxt/ui'

const open = ref(false)

const links = [[ {
  label: 'Overall',
  icon: 'i-pajamas:users',
  to: '/admin/analytics/overall'
}, {
  label: 'Cohort',
  icon: 'i-pajamas:group',
  to: '/admin/analytics/cohort'
},],] satisfies NavigationMenuItem[][]
</script>

<template>
    <UDashboardPanel id="analytics">
        <template #header>
            <UDashboardNavbar title="Analytics" >
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