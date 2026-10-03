<script setup lang="ts">
type Role = "admin" | "faculty" | "examiner" | "user";

const { activeRole, availableRoles, setActiveRole } = useAuth();

const router = useRouter();

const roleLabels: Record<Role, string> = {
  admin: "Admin",
  faculty: "Faculty",
  examiner: "Examiner",
  user: "Student",
};

const roleIcons: Record<Role, string> = {
  admin: "i-lucide-shield-check",
  faculty: "i-lucide-users",
  examiner: "i-lucide-clipboard-check",
  user: "i-lucide-graduation-cap",
};

const roleDestinations: Record<Role, string> = {
  admin: "/admin/dashboard",
  faculty: "/faculty/dashboard",
  examiner: "/examiner/dashboard",
  user: "/students/dashboard",
};

const showSwitcher = computed(() => availableRoles.value.length > 1);

async function handleRoleChange(value: string) {
  const selectedRole = value as Role;

  if (!availableRoles.value.includes(selectedRole)) {
    return;
  }

  setActiveRole(selectedRole);

  const destination = roleDestinations[selectedRole];

  if (destination) {
    await router.push(destination);
  }
}
</script>

<template>
  <div v-if="showSwitcher" class="w-full px-2 py-2">
    <label class="mb-1 block text-[11px] font-medium text-muted">
      Switch dashboard
    </label>

    <USelect
      :model-value="activeRole"
      :items="
        availableRoles.map((role) => ({
          label: roleLabels[role],
          value: role,
          icon: roleIcons[role],
        }))
      "
      value-key="value"
      class="w-full"
      size="sm"
      @update:model-value="handleRoleChange"
    />
  </div>
</template>
