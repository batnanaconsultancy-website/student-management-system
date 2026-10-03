<script setup lang="ts">
definePageMeta({
  layout: "default",
  middleware: ["admin"],
})

type UserRow = {
  email: string
  name: string | null
  type: string
  staff_type: string | null
  is_active: boolean
  is_admin: boolean
  is_faculty: boolean
  is_examiner: boolean
  student_id: string | null
  faculty_id: string | null
  admin_id: string | null
  examiner_id: string | null
  created_at: string | null
  last_login: string | null
}

const { data, status, refresh } = useFetch("/api/admin/users")

const rows = computed<UserRow[]>(() => data.value?.data || [])
const loading = computed(() => status.value === "pending")

const search = ref("")
const selectedType = ref("All")
const selectedStatus = ref("All")

const typeOptions = [
  { label: "All types", value: "All" },
  { label: "Students", value: "Student" },
  { label: "Faculty", value: "Faculty" },
  { label: "Admin", value: "Admin" },
  { label: "Examiner", value: "Examiner" },
]

const statusOptions = [
  { label: "All statuses", value: "All" },
  { label: "Active", value: "Active" },
  { label: "Inactive", value: "Inactive" },
]

const filteredRows = computed(() => {
  const query = search.value.trim().toLowerCase()

  return rows.value.filter((row) => {
    const matchesSearch =
      !query ||
      String(row.name || "").toLowerCase().includes(query) ||
      row.email.toLowerCase().includes(query)

    const matchesType =
      selectedType.value === "All" ||
      row.type === selectedType.value

    const matchesStatus =
      selectedStatus.value === "All" ||
      (selectedStatus.value === "Active" && row.is_active) ||
      (selectedStatus.value === "Inactive" && !row.is_active)

    return matchesSearch && matchesType && matchesStatus
  })
})

const columns = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "type", header: "Type" },
  { accessorKey: "staff_type", header: "Staff Type" },
  { accessorKey: "is_admin", header: "Admin" },
  { accessorKey: "is_faculty", header: "Faculty" },
  { accessorKey: "is_examiner", header: "Examiner" },
  { accessorKey: "is_active", header: "Status" },
]

function formatStaffType(value: string | null) {
  if (value === "teaching") return "Teaching"
  if (value === "non_teaching") return "Non-teaching"
  return "—"
}
</script>

<template>
  <div class="mt-6 w-full">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-highlighted font-medium text-left w-full">
          Users
        </h1>
        <p class="text-muted text-[15px] text-pretty mt-1">
          Preview all people registered across the SIS user and staff records.
        </p>
      </div>

      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <UCard variant="subtle" class="mt-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search name or email..."
          class="w-full md:max-w-md"
        />

        <USelect
          v-model="selectedType"
          :items="typeOptions"
          value-key="value"
          class="w-full md:w-48"
        />

        <USelect
          v-model="selectedStatus"
          :items="statusOptions"
          value-key="value"
          class="w-full md:w-40"
        />
      </div>

      <div class="mt-4 text-sm text-muted">
        Showing {{ filteredRows.length }} of {{ rows.length }} users
      </div>

      <div class="mt-3 overflow-x-auto">
        <UTable
          :data="filteredRows"
          :columns="columns"
          :loading="loading"
        >
          <template #name-cell="{ row }">
            <div class="font-medium text-highlighted">
              {{ row.original.name || "—" }}
            </div>
          </template>

          <template #email-cell="{ row }">
            <span class="text-sm">
              {{ row.original.email }}
            </span>
          </template>

          <template #type-cell="{ row }">
            <UBadge color="neutral" variant="subtle">
              {{ row.original.type }}
            </UBadge>
          </template>

          <template #staff_type-cell="{ row }">
            {{ formatStaffType(row.original.staff_type) }}
          </template>

          <template #is_admin-cell="{ row }">
            <UBadge
              v-if="row.original.is_admin"
              color="primary"
              variant="subtle"
            >
              Yes
            </UBadge>
            <span v-else class="text-muted">—</span>
          </template>

          <template #is_faculty-cell="{ row }">
            <UBadge
              v-if="row.original.is_faculty"
              color="success"
              variant="subtle"
            >
              Yes
            </UBadge>
            <span v-else class="text-muted">—</span>
          </template>

          <template #is_examiner-cell="{ row }">
            <UBadge
              v-if="row.original.is_examiner"
              color="warning"
              variant="subtle"
            >
              Yes
            </UBadge>
            <span v-else class="text-muted">—</span>
          </template>

          <template #is_active-cell="{ row }">
            <UBadge
              :color="row.original.is_active ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ row.original.is_active ? "Active" : "Inactive" }}
            </UBadge>
          </template>
        </UTable>
      </div>

      <div
        v-if="!loading && filteredRows.length === 0"
        class="text-center text-sm text-muted py-8"
      >
        No users match the current filters.
      </div>
    </UCard>
  </div>
</template>
