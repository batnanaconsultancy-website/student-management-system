<script setup lang="ts">
definePageMeta({
    layout: "default",
    middleware: ["admin"], 
});

import type { NavigationMenuItem } from '@nuxt/ui'

const links = [[ {
  label: 'Admin',
  icon: 'i-pajamas:users',
  to: '/admin/settings/admins'
}, {
  label: 'Notifications',
  icon: 'i-pajamas:group',
  to: '/admin/settings/notifications'
},],] satisfies NavigationMenuItem[][]
</script>

<template>
    <UDashboardPanel id="settings">
        <template #header>
            <UDashboardNavbar title="Settings" >
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