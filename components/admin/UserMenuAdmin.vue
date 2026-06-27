<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const props = defineProps<{
  collapsed?: boolean,
  userLabel?: any,
  userAvatar?: any
}>()

const colorMode = useColorMode()
const supabase = useSupabaseClient();

const userLabel = computed(() => props.userLabel ?? 'Guest')
const userAvatar = computed(() => props.userAvatar ? { src: props.userAvatar } : undefined)

const items = computed<DropdownMenuItem[][]>(() => ([[{
  type: 'label',
  label: userLabel.value,
  avatar: userAvatar.value
}], [ {
  label: 'Settings',
  icon: 'i-lucide-settings',
  to: '/admin/settings',
  type: 'trigger',
  children: [{
    label: 'Admin',
    icon: 'i-pajamas:users',
    to: '/admin/settings/admins'
  }, {
    label: 'Notifications',
    icon: 'i-pajamas:group',
    to: '/admin/settings/notifications'
  },
  {
    label: 'Audit Log',
    icon: 'i-lucide-shield-check',
    to: '/admin/settings/audit-log'
  }]

}], [{
  label: 'Appearance',
  icon: 'i-lucide-sun-moon',
  children: [{
    label: 'Light',
    icon: 'i-lucide-sun',
    type: 'checkbox',
    checked: colorMode.value === 'light',
    onSelect(e: Event) {
      e.preventDefault()

      colorMode.preference = 'light'
    }
  }, {
    label: 'Dark',
    icon: 'i-lucide-moon',
    type: 'checkbox',
    checked: colorMode.value === 'dark',
    onUpdateChecked(checked: boolean) {
      if (checked) {
        colorMode.preference = 'dark'
      }
    },
    onSelect(e: Event) {
      e.preventDefault()
    }
  }]
}],[ {
  label: 'Log out',
  icon: 'i-lucide-log-out',
  onClick: async (e: Event) => {
    e.preventDefault()
    try {
        await supabase.auth.signOut();
        navigateTo("/");
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }
}]]))
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      :avatar="userAvatar"
      :label="collapsed ? undefined : userLabel"
      :trailingIcon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'text-dimmed'
      }"
    />

    <template #chip-leading="{ item }">
      <span
        :style="{
          '--chip-light': `var(--color-${(item as any).chip}-500)`,
          '--chip-dark': `var(--color-${(item as any).chip}-400)`
        }"
        class="ms-0.5 size-2 rounded-full bg-(--chip-light) dark:bg-(--chip-dark)"
      />
    </template>
  </UDropdownMenu>
</template>
