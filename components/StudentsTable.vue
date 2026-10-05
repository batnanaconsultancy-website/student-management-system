<script setup lang="ts">
import { getPaginationRowModel } from "@tanstack/vue-table";
import { resolveComponent, ref, computed, watch, h } from "vue";
import {
  STATUS_OPTIONS,
  PROGRAM_OPTIONS,
  STUDENT_CLASS_OPTIONS,
} from "~/constants/options";

import * as z from "zod";
import type { FormSubmitEvent } from "@nuxt/ui";

const toast = useToast();

const UBadge = resolveComponent("UBadge");
const UAvatar = resolveComponent("UAvatar");
const UDropdownMenu = resolveComponent("UDropdownMenu");
const UButton = resolveComponent("UButton");

const schema = z.object({
  points: z.number().min(0),
});

type Schema = z.output<typeof schema>;

interface StudentRow {
  id: number;
  name: string;
  username: string;
  email: string;
  profileImgUrl?: string | null;
  program?: string | null;
  cohort?: string | null;
  studentClass?: string | null;
  points_assigned?: number | null;
  status?: string | null;
  accountStatus?: string | null;
}

interface StudentPointsRow {
  points_assigned: number | null;
}

interface SelectItem {
  label: string;
  value: string;
}

interface FilterItem {
  id: string;
  value: string;
}

interface TableColumnContext {
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
}

interface TableCellContext {
  row: {
    original: StudentRow;
    getValue: (columnId: string) => unknown;
  };
}

const state = ref<Schema>({
  points: 0,
});

const props = defineProps<{
  data: StudentRow[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggleActiveStatus", ...args: unknown[]): void;
  (e: "refreshData"): void;
}>();

const table = useTemplateRef("table");

const columnFilters = ref<FilterItem[]>([
  { id: "name", value: "" },
  { id: "status", value: "" },
  { id: "accountStatus", value: "Active" },
]);

const pagination = ref({
  pageIndex: 0,
  pageSize: 10,
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
const accountStatusFilter = ref("Active");

const cohortItems = ref<SelectItem[]>([]);

const open = ref(false);
const openModal = ref(false);

const selectedStudentId = ref<number | null>(null);
const selectedStudentName = ref("");

const supabase = useSupabaseClient();

const items: SelectItem[] = [
  { label: "Active", value: "Active" },
  { label: "Inactive", value: "Inactive" },
  { label: "Frozen", value: "Frozen" },
  { label: "Graduated", value: "Graduated" },
];

const value = ref("Active");

const changeStatus = async (studentId: number | null, newStatus: string) => {
  if (studentId === null) {
    return;
  }

  try {
    const { error } = await supabase
      .from("students")
      .update({ account_status: newStatus } as never)
      .eq("id", studentId);

    if (error) {
      throw error;
    }

    toast.add({
      title: "Success",
      description: `Account status updated to ${newStatus}`,
      color: "success",
    });

    openModal.value = false;

    emit("refreshData");
  } catch (error) {
    console.error("Error changing account status:", error);

    toast.add({
      title: "Error",
      description: "Failed to change account status. Please try again.",
      color: "error",
    });
  }
};

async function addPoints(points: number) {
  if (selectedStudentId.value === null) {
    toast.add({
      title: "Error",
      description: "No student selected",
      color: "error",
    });

    return;
  }

  if (points <= 0) {
    return;
  }

  try {
    const { data: student, error: fetchError } = await supabase
      .from("students")
      .select("points_assigned")
      .eq("id", selectedStudentId.value)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const typedStudent = student as unknown as StudentPointsRow | null;

    const currentPoints = typedStudent?.points_assigned ?? 0;
    const newPoints = currentPoints + points;

    const { error: updateError } = await supabase
      .from("students")
      .update({ points_assigned: newPoints } as never)
      .eq("id", selectedStudentId.value);

    if (updateError) {
      throw updateError;
    }

    toast.add({
      title: "Success",
      description: `Added ${points} points to ${selectedStudentName.value}. New total: ${newPoints}`,
      color: "success",
    });

    state.value.points = 0;
    open.value = false;

    emit("refreshData");
  } catch (error) {
    console.error("Error adding points:", error);

    toast.add({
      title: "Error",
      description: "Failed to add points. Please try again.",
      color: "error",
    });
  }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  await addPoints(event.data.points);
}

watch(
  () => props.data,
  (newData) => {
    const cohorts = [
      ...new Set(
        newData
          .map((item: StudentRow) => item.cohort)
          .filter((cohort): cohort is string => Boolean(cohort)),
      ),
    ];

    const monthMap: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };

    const sortedCohorts = cohorts.sort((a, b) => {
      const [monthA = "", yearA = ""] = a.split(" ");
      const [monthB = "", yearB = ""] = b.split(" ");

      const parsedYearA = parseInt(yearA, 10);
      const parsedYearB = parseInt(yearB, 10);

      const numericYearA = Number.isNaN(parsedYearA) ? 0 : parsedYearA;

      const numericYearB = Number.isNaN(parsedYearB) ? 0 : parsedYearB;

      const dateA = new Date(2000 + numericYearA, monthMap[monthA] ?? 0);

      const dateB = new Date(2000 + numericYearB, monthMap[monthB] ?? 0);

      const diff = dateA.getTime() - dateB.getTime();

      return Number.isNaN(diff) ? a.localeCompare(b) : diff;
    });

    cohortItems.value = sortedCohorts.map(
      (cohort): SelectItem => ({
        label: cohort,
        value: cohort,
      }),
    );

    cohortItems.value.unshift({
      label: "All",
      value: "all",
    });
  },
  { immediate: true },
);

function setColumnFilter(columnId: string, newVal: string) {
  const next = columnFilters.value.filter((filter) => filter.id !== columnId);

  if (newVal && newVal !== "all") {
    next.push({
      id: columnId,
      value: newVal,
    });
  }

  columnFilters.value = next;
}

watch(
  () => cohortFilter.value,
  (newVal) => {
    setColumnFilter("cohort", newVal);
  },
);

watch(
  () => programFilter.value,
  (newVal) => {
    setColumnFilter("program", newVal);
  },
);

watch(
  () => classFilter.value,
  (newVal) => {
    setColumnFilter("studentClass", newVal);
  },
);

watch(
  () => statusFilter.value,
  (newVal) => {
    setColumnFilter("status", newVal);
  },
);

watch(
  () => accountStatusFilter.value,
  (newVal) => {
    setColumnFilter("accountStatus", newVal);
  },
);

const tableKey = computed(() =>
  columnFilters.value.map((filter) => `${filter.id}:${filter.value}`).join("|"),
);

const getStatusColor = (
  status: string | null | undefined,
): "success" | "error" | "warning" | "neutral" => {
  const colors: Record<string, "success" | "error" | "warning" | "neutral"> = {
    "On Track": "success",
    "At Risk": "error",
    Monitor: "warning",
  };

  return colors[status ?? ""] ?? "neutral";
};

const getAccountStatusColor = (
  accountStatus: string | null | undefined,
): "success" | "neutral" | "info" => {
  const colors: Record<string, "success" | "neutral" | "info"> = {
    Active: "success",
    Inactive: "neutral",
    Frozen: "info",
    Graduated: "success",
  };

  return colors[accountStatus ?? ""] ?? "neutral";
};

const columns = [
  {
    accessorKey: "name",

    header: ({ column }: TableColumnContext) => {
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

    cell: ({ row }: TableCellContext) => {
      const student = row.original;
      const imgUrl = student.profileImgUrl;

      return h(
        "div",
        {
          class: "flex items-center gap-3",
        },
        [
          h(UAvatar, {
            src: imgUrl ?? undefined,
            size: "lg",
            alt: "User Avatar",
          }),

          h("div", undefined, [
            h(
              "p",
              {
                class: "font-medium text-highlighted",
              },
              student.name,
            ),

            h("p", { class: "" }, `@${student.username}`),
          ]),
        ],
      );
    },
  },

  {
    accessorKey: "email",
    header: "Email",
  },

  {
    accessorKey: "program",
    header: "Program",
  },

  {
    accessorKey: "cohort",
    header: "Cohort",
  },

  {
    accessorKey: "studentClass",

    header: "Class",

    cell: ({ row }: TableCellContext) => {
      const studentClass = row.getValue("studentClass") as
        | string
        | null
        | undefined;

      const color = studentClass === "Code Academy" ? "info" : "neutral";

      return h(
        UBadge,
        {
          variant: "subtle",
          color,
        },
        () => studentClass ?? "",
      );
    },
  },

  {
    accessorKey: "points_assigned",
    header: "Points",
  },

  {
    accessorKey: "status",

    header: "Status",

    cell: ({ row }: TableCellContext) => {
      const status = row.getValue("status") as string | null | undefined;

      return h(
        UBadge,
        {
          class: "capitalize",
          variant: "subtle",
          color: getStatusColor(status),
        },
        () => status ?? "",
      );
    },
  },

  {
    accessorKey: "accountStatus",

    header: "Account Status",

    filterFn: "equalsString",

    cell: ({ row }: TableCellContext) => {
      const accountStatus = row.getValue("accountStatus") as
        | string
        | null
        | undefined;

      return h(
        UBadge,
        {
          variant: "subtle",
          color: getAccountStatusColor(accountStatus),
        },
        () => accountStatus ?? "",
      );
    },
  },

  {
    id: "actions",

    cell: ({ row }: TableCellContext) => {
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
            }),
        ),
      );
    },
  },
];

function getRowItems(row: TableCellContext["row"]) {
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
        selectedStudentId.value = row.original.id;

        selectedStudentName.value = row.original.name;

        value.value = row.original.accountStatus ?? "Active";

        openModal.value = true;
      },
    },

    {
      label: "Add points",

      onSelect: () => {
        selectedStudentId.value = row.original.id;

        selectedStudentName.value = row.original.name;

        state.value.points = 0;

        open.value = true;
      },
    },
  ];
}

const onSelect = async (row: TableCellContext["row"]) => {
  const student = row.original;

  if (!student.id) {
    return;
  }

  await navigateTo(`/admin/students/${student.id}`, {
    open: {
      target: "_blank",
    },
  });
};
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <UModal
      v-model:open="openModal"
      :title="`Change Account Status for ${selectedStudentName}`"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <USelectMenu
          v-model="value"
          :items="items"
          value-key="value"
          class="w-full"
        />
      </template>

      <template #footer="{ close }">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="close"
        />

        <UButton
          label="Change Status"
          color="primary"
          @click="changeStatus(selectedStudentId, value)"
        />
      </template>
    </UModal>

    <UModal
      v-model:open="open"
      :title="`Add Points to ${selectedStudentName}`"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UForm
          :schema="schema"
          :state="state"
          class="w-full space-y-4"
          @submit="onSubmit"
        >
          <UFormField
            label="Points to Add"
            name="points"
            class="w-full"
            required
          >
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
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="close"
        />

        <UButton
          label="Add Points"
          color="primary"
          :disabled="!state.points || state.points <= 0"
          @click="addPoints(state.points)"
        />
      </template>
    </UModal>

    <div
      class="flex w-full flex-col items-start justify-between gap-4 lg:flex-row lg:items-center"
    >
      <UInput
        size="md"
        color="info"
        icon="i-lucide-search"
        :model-value="
          String(table?.tableApi?.getColumn('name')?.getFilterValue() ?? '')
        "
        class="min-w-[13.05rem]"
        placeholder="Filter names..."
        @update:model-value="
          table?.tableApi?.getColumn('name')?.setFilterValue($event)
        "
      />

      <div class="flex flex-col items-center gap-4 lg:flex-row">
        <USelect
          v-model="programFilter"
          size="md"
          :items="[{ label: 'All', value: 'all' }, ...PROGRAM_OPTIONS]"
          :ui="{
            trailingIcon:
              'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter program"
          class="min-w-[11.7rem]"
        />

        <USelect
          v-model="cohortFilter"
          size="md"
          :items="cohortItems"
          :ui="{
            trailingIcon:
              'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter cohort"
          class="min-w-[11.7rem]"
        />

        <USelect
          v-model="statusFilter"
          size="md"
          :items="[
            { label: 'All', value: 'all' },
            {
              label: 'On Track',
              value: 'on track',
              chip: { color: 'success' },
            },
            {
              label: 'At Risk',
              value: 'at risk',
              chip: { color: 'error' },
            },
            {
              label: 'Monitor',
              value: 'monitor',
              chip: { color: 'warning' },
            },
          ]"
          :ui="{
            trailingIcon:
              'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter status"
          class="min-w-[11.7rem]"
        />

        <USelect
          v-model="classFilter"
          size="md"
          :items="[{ label: 'All', value: 'all' }, ...STUDENT_CLASS_OPTIONS]"
          :ui="{
            trailingIcon:
              'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter class"
          class="min-w-[11.7rem]"
        />

        <USelect
          v-model="accountStatusFilter"
          size="md"
          :items="[
            { label: 'All', value: 'all' },
            ...STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
          ]"
          :ui="{
            trailingIcon:
              'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          placeholder="Filter account status"
          class="min-w-[11.7rem]"
        />
      </div>
    </div>

    <UTable
      ref="table"
      :key="tableKey"
      v-model:column-filters="columnFilters"
      v-model:pagination="pagination"
      v-model:sorting="sorting"
      sticky
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
      @select="onSelect"
    />

    <div class="border-default flex items-center justify-between border-t pt-4">
      <p class="text-muted text-xs xl:text-sm">
        {{ table?.tableApi?.getFilteredRowModel().rows.length ?? 0 }}
        students
      </p>

      <UPagination
        variant="subtle"
        active-color="primary"
        :default-page="
          (table?.tableApi?.getState().pagination.pageIndex || 0) + 1
        "
        :items-per-page="table?.tableApi?.getState().pagination.pageSize"
        :total="table?.tableApi?.getFilteredRowModel().rows.length ?? 0"
        @update:page="(page) => table?.tableApi?.setPageIndex(page - 1)"
      />
    </div>
  </div>
</template>
