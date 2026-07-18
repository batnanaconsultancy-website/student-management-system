<script setup lang="ts">
import { getPaginationRowModel } from "@tanstack/vue-table";
import { resolveComponent, ref, watch } from "vue";
import { STATUS_OPTIONS, PROGRAM_OPTIONS, STUDENT_CLASS_OPTIONS } from '~/constants/options'

import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
const toast = useToast()

const UBadge = resolveComponent("UBadge");
const UAvatar = resolveComponent("UAvatar");
const UDropdownMenu = resolveComponent("UDropdownMenu");
const UButton = resolveComponent("UButton");

const schema = z.object({
  points: z.number().min(0),
})

type Schema = z.output<typeof schema>

const state = ref<Schema>({
  points: 0,
})

const changeStatus = async (studentId: number, newStatus: string) => {
  try {
    const { error } = await supabase
      .from('students')
      .update({ account_status: newStatus })
      .eq('id', studentId)

    if (error) throw error

    toast.add({
      title: 'Success',
      description: `Account status updated to ${newStatus}`,
      color: 'success'
    })

    // Close modal
    openModal.value = false

    // Emit event to refresh the table data
    emit('refreshData')
  } catch (error) {
    console.error('Error changing account status:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to change account status. Please try again.',
      color: 'error'
    })
  }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (!selectedStudentId.value) {
    toast.add({
      title: 'Error',
      description: 'No student selected',
      color: 'error'
    })
    return
  }

  try {
    // Get current points_assigned value
    const { data: student, error: fetchError } = await supabase
      .from('students')
      .select('points_assigned')
      .eq('id', selectedStudentId.value)
      .single()

    if (fetchError) throw fetchError

    const currentPoints = student?.points_assigned || 0
    const newPoints = currentPoints + event.data.points

    // Update the student's points in the database
    const { error: updateError } = await supabase
      .from('students')
      .update({ points_assigned: newPoints })
      .eq('id', selectedStudentId.value)

    if (updateError) throw updateError

    toast.add({
      title: 'Success',
      description: `Added ${event.data.points} points to ${selectedStudentName.value}. New total: ${newPoints}`,
      color: 'success'
    })

    // Reset form and close modal
    state.value.points = 0
    open.value = false

    // Emit event to refresh the table data
    emit('refreshData')
  } catch (error) {
    console.error('Error adding points:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to add points. Please try again.',
      color: 'error'
    })
  }
}

const props = defineProps({
  data: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["toggleActiveStatus", "refreshData"]);

const table = useTemplateRef("table");

const columnFilters = ref([
  { id: "name", value: "" },
  { id: "status", value: "" },
]);

const pagination = ref({
  pageIndex: 0,
  pageSize: 7,
});

const sorting = ref([
  {
    id: "name",
    desc: false,
  },
]);

const statusFilter = ref("all");
const programFilter = ref("all");
const cohortFilter = ref("all");
const classFilter = ref("all");
const cohortItems = ref([]);
const open = ref(false)
const openModal = ref(false)
const selectedStudentId = ref(null)
const selectedStudentName = ref('')
const supabase = useSupabaseClient()

const items = ref([
  { label: 'Active',    value: 'Active' },
  { label: 'Inactive',  value: 'Inactive' },
  { label: 'Frozen',    value: 'Frozen' },
  { label: 'Graduated', value: 'Graduated' },
])
const value = ref('Active')

watch(
  () => props.data,
  (newData) => {
    const cohorts = [...new Set(newData.map(item => item.cohort))].filter(Boolean);

    // Sort cohorts by date (e.g., "Sep 22", "Mar 25") -- guard against
    // unparseable values (e.g. a missing cohort relation) so one bad
    // entry can't throw the comparator off for everything else.
    const sortedCohorts = cohorts.sort((a, b) => {
      const monthMap = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      };

      const [monthA, yearA] = (a || '').split(' ');
      const [monthB, yearB] = (b || '').split(' ');

      const dateA = new Date(2000 + (parseInt(yearA) || 0), monthMap[monthA] ?? 0);
      const dateB = new Date(2000 + (parseInt(yearB) || 0), monthMap[monthB] ?? 0);

      const diff = dateA - dateB;
      return Number.isNaN(diff) ? String(a).localeCompare(String(b)) : diff;
    });

    cohortItems.value = sortedCohorts.map(cohort => ({
      label: cohort,
      value: cohort,
    }));
    cohortItems.value.unshift({ label: 'All', value: 'all' });
  },
  { immediate: true }
);

watch(
  () => cohortFilter.value,
  (newVal) => {
    // Drive columnFilters directly (the actual v-model source of truth
    // for the table) rather than going through tableApi.getColumn(),
    // which depends on the template ref being ready at the moment this
    // watcher fires.
    const idx = columnFilters.value.findIndex((f) => f.id === 'cohort');
    if (!newVal || newVal === 'all') {
      if (idx !== -1) columnFilters.value.splice(idx, 1);
    } else if (idx !== -1) {
      columnFilters.value[idx] = { id: 'cohort', value: newVal };
    } else {
      columnFilters.value.push({ id: 'cohort', value: newVal });
    }
  }
);

watch(
  () => programFilter.value,
  (newVal) => {
    if (!table?.value?.tableApi) return;
    if (newVal === 'all') {
      table.value.tableApi.getColumn('program')?.setFilterValue(undefined)
      return
    }

    const programColumn = table.value.tableApi.getColumn("program");

    if (!programColumn) return;

    if (newVal === "all") {
      programColumn.setFilterValue(undefined);
    } else {
      programColumn.setFilterValue(newVal);
    }
  }
);

watch(
  () => classFilter.value,
  (newVal) => {
    // Driven directly through columnFilters (the table's v-model source
    // of truth), same robust approach used for the cohort filter.
    const idx = columnFilters.value.findIndex((f) => f.id === 'studentClass');
    if (!newVal || newVal === 'all') {
      if (idx !== -1) columnFilters.value.splice(idx, 1);
    } else if (idx !== -1) {
      columnFilters.value[idx] = { id: 'studentClass', value: newVal };
    } else {
      columnFilters.value.push({ id: 'studentClass', value: newVal });
    }
  }
);

watch(
  () => statusFilter.value,
  (newVal) => {
    if (!table?.value?.tableApi) return;
    if (newVal === 'all') {
      table.value.tableApi.getColumn('status')?.setFilterValue(undefined)
      return
    }

    const statusColumn = table.value.tableApi.getColumn("status");
    if (!statusColumn) return;

    if (newVal === "all") {
      statusColumn.setFilterValue(undefined);
    } else {
      statusColumn.setFilterValue(newVal);
    }
  }
);

const columns = [
  {
    accessorKey: "name",
    header: ({ column }) => {
      const isSorted = column.getIsSorted();

      return h(UButton, {
        color: "neutral",
        variant: "ghost",
        label: "Name",
        icon: isSorted
          ? isSorted === "asc"
            ? "i-lucide-chevron-up"
            : "i-lucide-chevron-down"
          : "i-lucide-chevron-up",
        class: "-mx-2.5",
        onClick: () => column.toggleSorting(column.getIsSorted() === "asc"),
      });
    },
    cell: ({ row }) => {
      const imgUrl = row.original.profileImgUrl;
      return h("div", { class: "flex items-center gap-3" }, [
        h(UAvatar, {
          src: imgUrl,
          size: "lg",
          alt: "User Avatar",
        }),
        h("div", undefined, [
          h("p", { class: "font-medium text-highlighted" }, row.original.name),
          h("p", { class: "" }, `@${row.original.username}`),
        ]),
      ]);
    },
  },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "program", header: "Program" },
  { accessorKey: "cohort", header: "Cohort" },
  {
    accessorKey: "studentClass",
    header: "Class",
    cell: ({ row }) => {
      const studentClass = row.getValue("studentClass");
      const color = studentClass === "Code Academy" ? "info" : "neutral";
      return h(UBadge, { variant: "subtle", color }, () => studentClass);
    },
  },
  { accessorKey: "points_assigned", header: "Points",  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const color =
        {
          "On Track": "success",
          "At Risk": "error",
          "Monitor": "warning",
        }[row.getValue("status")] || "neutral";

      return h(UBadge, { class: "capitalize", variant: "subtle", color }, () =>
        row.getValue("status")
      );
    },
  },
  {
    accessorKey: "accountStatus",
    header: "Account Status",
    cell: ({ row }) => {
      const accountStatus = row.getValue("accountStatus");
      const color = {
        "Active": "success",
        "Inactive": "neutral",
        "Frozen": "info",
        "Graduated": "success"
      }[accountStatus] || "neutral";

      return h(UBadge, { variant: "subtle", color }, () => accountStatus);
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      return h(
        "div",
        { class: "text-right" },
        h(
          UDropdownMenu,
          {
            content: {
              align: "end",
            },
            items: getRowItems(row),
            "aria-label": "Actions dropdown",
          },
          () =>
            h(UButton, {
              icon: "i-lucide-ellipsis-vertical",
              color: "neutral",
              variant: "ghost",
              class: "ml-auto",
              "aria-label": "Actions dropdown",
            })
        )
      );
    },
  },
];

function getRowItems(row: any) {
  return [
    {
      type: "label",
      label: "Actions",
    },
    {
      type: "separator",
    },
    {
      label: "Change Status",
      onSelect: () => {
        selectedStudentId.value = row.original.id
        selectedStudentName.value = row.original.name
        value.value = row.original.accountStatus
        openModal.value = true
      },
    },
    {
      label: "Add points",
      onSelect: () => {
        selectedStudentId.value = row.original.id
        selectedStudentName.value = row.original.name
        state.value.points = 0 // Reset form
        open.value = true
      },
    },
  ];
}

const onSelect = async (selectedRows: any[]) => {
  await navigateTo(`/admin/students/${selectedRows.original.id}`, {
    open: {
      target: "_blank",
    }
  });
}; 
</script>

<template>
  <div class="flex h-full w-full flex-col">

    <UModal v-model:open="openModal" :title="`Change Account Status for ${selectedStudentName}`" :ui="{ footer: 'justify-end' }">
      <template #body>
        <USelectMenu v-model="value" :items="items" class="w-full" />
      </template>  
       <template #footer="{ close }">
          <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
          <UButton
            label="Change Status"
            color="primary"
            @click="changeStatus(selectedStudentId, value);"
          />
        </template>
    </UModal>

    <UModal v-model:open="open" :title="`Add Points to ${selectedStudentName}`" :ui="{ footer: 'justify-end' }">
        <template #body>
            <UForm :schema="schema" :state="state" class="w-full space-y-4" @submit="onSubmit">
              <UFormField label="Points to Add" name="points" class="w-full" required>
                <UInputNumber
                  v-model="state.points"
                  class="w-full"
                  placeholder="Enter points amount"
                  :min="0"
                />
              </UFormField>
            </UForm>
        </template>

        <template #footer="{ close }">
          <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
          <UButton
            label="Add Points"
            color="primary"
            :disabled="!state.points || state.points <= 0"
            @click="onSubmit({ data: state })"
          />
        </template>
    </UModal>

    <div class="flex flex-col lg:flex-row w-full items-start gap-4 lg:items-center justify-between">
      <UInput
        size="md"
        color="info"
        icon="i-lucide-search"
        :model-value="table?.tableApi?.getColumn('name')?.getFilterValue()"
        class="min-w-58"
        placeholder="Filter names..."
        @update:model-value="table?.tableApi?.getColumn('name')?.setFilterValue($event)"
      />

      <div class="flex flex-col lg:flex-row items-center gap-4">
        <USelect
          size="md"
          v-model="cohortFilter"
          :items="cohortItems"
          :ui="{
            trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter cohort"
          class="min-w-52"
        />

        <USelect
          size="md"
          v-model="programFilter"
          :items="[{ label: 'All', value: 'all' }, ...PROGRAM_OPTIONS]"
          :ui="{
            trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter program"
          class="min-w-52"
        />

        <USelect
          size="md"
          v-model="classFilter"
          :items="[{ label: 'All', value: 'all' }, ...STUDENT_CLASS_OPTIONS]"
          :ui="{
            trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter class"
          class="min-w-52"
        />

        <USelect
          size="md"
          v-model="statusFilter"
          :items="[
            { label: 'All', value: 'all' },
            { label: 'On Track', value: 'on track', chip: { color: 'success' } },
            { label: 'At Risk', value: 'at risk', chip: { color: 'error' } },
            { label: 'Monitor', value: 'monitor', chip: { color: 'warning' } },
          ]"
          :ui="{
            trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter status"
          class="min-w-52"
        />
      </div>
    </div>

    <UTable
      sticky
      ref="table"
      v-model:column-filters="columnFilters"
      v-model:pagination="pagination"
      v-model:sorting="sorting"
      @select="onSelect"
      :pagination-options="{
        getPaginationRowModel: getPaginationRowModel(),
      }"
      :loading="loading"
      loading-color="primary"
      loading-animation="carousel"
      :data="data"
      :columns="columns"
      class="mt-4 flex-1"
      :ui="{
        base: 'border-separate border-spacing-0',
        thead: '[&>tr]:bg-elevated/50 h-10 [&>tr]:after:content-none',
        tbody: '[&>tr]:last:[&>td]:border-b-0',
        th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
        td: 'border-b border-default cursor-pointer',
      }"
    />
    <div class="border-default flex items-center justify-between border-t pt-4">
      <p class="text-muted text-xs xl:text-sm">
        {{ table?.tableApi?.getFilteredRowModel().rows.length }} students
      </p>
      <UPagination
        variant="subtle"
        active-color="primary"
        :default-page="(table?.tableApi?.getState().pagination.pageIndex || 0) + 1"
        :items-per-page="table?.tableApi?.getState().pagination.pageSize"
        :total="table?.tableApi?.getFilteredRowModel().rows.length"
        @update:page="(p) => table?.tableApi?.setPageIndex(p - 1)"
      />
    </div>
  </div>
</template>