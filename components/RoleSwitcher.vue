<script setup lang="ts">
type Role = "admin" | "faculty" | "examiner" | "user" | "guest";

const { activeRole, availableRoles, setActiveRole } = useAuth();

const router = useRouter();

function getRoleLabel(role: Role): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "faculty":
      return "Faculty";
    case "examiner":
      return "Examiner";
    case "user":
      return "Student";
    case "guest":
      return "Guest";
  }
}

function getRoleIcon(role: Role): string {
  switch (role) {
    case "admin":
      return "i-lucide-shield-check";
    case "faculty":
      return "i-lucide-users";
    case "examiner":
      return "i-lucide-clipboard-check";
    case "user":
      return "i-lucide-graduation-cap";
    case "guest":
      return "i-lucide-user";
  }
}

function getRoleDestination(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin/dashboard";
    case "faculty":
      return "/faculty/dashboard";
    case "examiner":
      return "/examiner/dashboard";
    case "user":
      return "/students/dashboard";
    case "guest":
      return "/";
  }
}

const showSwitcher = computed(() => availableRoles.value.length > 1);

async function handleRoleChange(value: string) {
  const selectedRole = value as Role;

  if (!availableRoles.value.includes(selectedRole)) {
    return;
  }

  setActiveRole(selectedRole);

  const destination = getRoleDestination(selectedRole);

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
          label: getRoleLabel(role),
          value: role,
          icon: getRoleIcon(role),
        }))
      "
      value-key="value"
      class="w-full"
      size="sm"
      @update:model-value="handleRoleChange"
    />
  </div>
</template>
