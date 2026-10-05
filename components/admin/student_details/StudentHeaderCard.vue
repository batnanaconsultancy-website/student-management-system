<script setup lang="ts">
interface StudentCohort {
  id: string;
  name: string;
}

interface StudentProgram {
  id: string;
  name: string;
}

interface Student {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  username: string | null;
  profile_image_url: string | null;
  slack_id: string | null;
  program_id: string | null;
  cohort_id: string | null;
  account_status: string | null;
  is_active: boolean | null;
  last_login: string | null;
  cohorts?: StudentCohort | null;
  programs?: StudentProgram | null;
}

interface CohortRecord {
  id?: string;
  name: string;
  cohort_ids?: string[];
  programs?: Array<{
    id: string;
    cohort_id: string;
  }>;
}

interface ProgramRecord {
  id: string;
  name: string;
}

interface SelectItem {
  label: string;
  value: string;
}

type BadgeColor =
  | "warning"
  | "primary"
  | "secondary"
  | "success"
  | "info"
  | "error"
  | "neutral";

interface UpdateStatusResponse {
  data?: {
    account_status: string;
    is_active: boolean;
  };
  message: string;
}

const props = defineProps<{
  student: Student;
}>();

const emit = defineEmits<{
  (event: "send-email"): void;
  (event: "send-slack-message"): void;
}>();

const supabase = useSupabaseClient();
const toast = useToast();

const { cohorts, fetchCohorts } = useCohorts();
const { programs, programOptions, fetchPrograms } = usePrograms();

const items = ref<SelectItem[]>([]);
const isUpdating = ref(false);
const isModalOpen = ref(false);

const selectedCohortId = ref<string | undefined>(
  props.student.cohort_id ?? undefined,
);

const isProgramModalOpen = ref(false);
const selectedProgramId = ref<string | undefined>(
  props.student.program_id ?? undefined,
);

const isUpdatingProgram = ref(false);

const buildCohortItems = (
  cohortList: CohortRecord[],
  programId: string | null,
): SelectItem[] => {
  if (!programId) {
    return [];
  }

  return cohortList.map((cohort) => {
    const matchingId = cohort.cohort_ids?.find(
      (id: string) =>
        cohort.programs?.some(
          (program) => program.id === programId && program.cohort_id === id,
        ) ?? false,
    );

    return {
      label: cohort.name,
      value: matchingId ?? "",
    };
  });
};

onMounted(async () => {
  await fetchCohorts({
    program_id: props.student.program_id,
  });

  const cohortList = cohorts.value as unknown as CohortRecord[];

  items.value = buildCohortItems(cohortList, props.student.program_id);

  await fetchPrograms();

  selectedCohortId.value = props.student.cohort_id ?? undefined;

  selectedProgramId.value = props.student.program_id ?? undefined;
});

const handleCohortChange = async () => {
  if (
    !selectedCohortId.value ||
    selectedCohortId.value === props.student.cohort_id
  ) {
    isModalOpen.value = false;
    return;
  }

  try {
    isUpdating.value = true;

    const { error } = await supabase
      .from("students")
      .update({
        cohort_id: selectedCohortId.value,
      } as never)
      .eq("id", props.student.id);

    if (error) {
      throw error;
    }

    props.student.cohort_id = selectedCohortId.value;

    const cohortList = cohorts.value as unknown as CohortRecord[];

    const selectedCohort = cohortList.find((cohort) =>
      cohort.cohort_ids?.includes(selectedCohortId.value as string),
    );

    if (selectedCohort && props.student.cohorts) {
      props.student.cohorts.name = selectedCohort.name;
    }

    toast.add({
      title: "Success",
      description: "Student cohort updated successfully",
      color: "success",
    });

    isModalOpen.value = false;
  } catch (error) {
    console.error("Error updating cohort:", error);

    toast.add({
      title: "Error",
      description: "Failed to update student cohort",
      color: "error",
    });
  } finally {
    isUpdating.value = false;
  }
};

const handleProgramChange = async () => {
  console.log("Selected program ID:", selectedProgramId.value);

  if (
    !selectedProgramId.value ||
    selectedProgramId.value === props.student.program_id
  ) {
    isProgramModalOpen.value = false;
    return;
  }

  try {
    isUpdatingProgram.value = true;

    const currentCohortName = props.student.cohorts?.name;

    let newCohortId: string | null = null;

    if (currentCohortName) {
      const { data: rawMatchingCohort } = await supabase
        .from("cohorts")
        .select("id")
        .eq("name", currentCohortName)
        .eq("program_id", selectedProgramId.value)
        .single();

      const matchingCohort = rawMatchingCohort as unknown as {
        id: string;
      } | null;

      if (matchingCohort) {
        newCohortId = matchingCohort.id;
      }
    }

    const updateData: {
      program_id: string;
      cohort_id?: string;
    } = {
      program_id: selectedProgramId.value,
    };

    if (newCohortId) {
      updateData.cohort_id = newCohortId;
    }

    const { error } = await supabase
      .from("students")
      .update(updateData as never)
      .eq("id", props.student.id);

    if (error) {
      throw error;
    }

    props.student.program_id = selectedProgramId.value;

    if (newCohortId) {
      props.student.cohort_id = newCohortId;

      selectedCohortId.value = newCohortId;
    }

    const programList = programs.value as unknown as ProgramRecord[];

    const selectedProgram = programList.find(
      (program) => program.id === selectedProgramId.value,
    );

    if (selectedProgram && props.student.programs) {
      props.student.programs.name = selectedProgram.name;
    }

    toast.add({
      title: "Success",
      description: newCohortId
        ? "Student program and cohort updated successfully."
        : "Student program updated. Please update the cohort manually.",
      color: "success",
    });

    isProgramModalOpen.value = false;

    await fetchCohorts({
      program_id: selectedProgramId.value,
    });

    const cohortList = cohorts.value as unknown as CohortRecord[];

    items.value = buildCohortItems(cohortList, selectedProgramId.value);
  } catch (error) {
    console.error("Error updating program:", error);

    toast.add({
      title: "Error",
      description: "Failed to update student program",
      color: "error",
    });
  } finally {
    isUpdatingProgram.value = false;
  }
};

const formatDateTime = (iso: string | null | undefined): string | null => {
  if (!iso) {
    return null;
  }

  try {
    const d = new Date(iso);

    if (isNaN(d.getTime())) {
      return null;
    }

    const day = String(d.getDate()).padStart(2, "0");

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const month = monthNames[d.getMonth()] ?? "";

    const year = d.getFullYear();

    const hours = String(d.getHours()).padStart(2, "0");

    const minutes = String(d.getMinutes()).padStart(2, "0");

    return `${day} ${month}, ${year} at ${hours}:${minutes}`;
  } catch {
    return null;
  }
};

const isUpdatingStatus = ref(false);

const isStatusModalOpen = ref(false);

const selectedStatus = ref<string>(props.student.account_status ?? "Active");

const statusOptions = [
  {
    label: "Active",
    value: "Active",
  },
  {
    label: "Inactive",
    value: "Inactive",
  },
  {
    label: "Frozen",
    value: "Frozen",
  },
  {
    label: "Graduated",
    value: "Graduated",
  },
];

const statusColor = computed<BadgeColor>(() => {
  const map: Record<string, BadgeColor> = {
    Active: "success",
    Inactive: "warning",
    Frozen: "info",
    Graduated: "neutral",
  };

  return map[props.student.account_status ?? "Active"] ?? "neutral";
});

const handleStatusChange = async () => {
  if (selectedStatus.value === props.student.account_status) {
    isStatusModalOpen.value = false;
    return;
  }

  try {
    isUpdatingStatus.value = true;

    const res = await $fetch<UpdateStatusResponse>(
      "/api/students/update-status",
      {
        method: "POST",
        body: {
          student_id: props.student.id,
          account_status: selectedStatus.value,
        },
      },
    );

    if (res.data) {
      props.student.account_status = res.data.account_status;

      props.student.is_active = res.data.is_active;
    }

    toast.add({
      title: "Status updated",
      description: res.message,
      color: "success",
    });

    isStatusModalOpen.value = false;
  } catch (err: unknown) {
    const error = err as {
      data?: {
        statusMessage?: string;
      };
    };

    toast.add({
      title: "Error",
      description: error.data?.statusMessage ?? "Failed to update status",
      color: "error",
    });
  } finally {
    isUpdatingStatus.value = false;
  }
};

const handleSendEmail = () => {
  window.location.href = `mailto:${props.student.email ?? ""}`;

  emit("send-email");
};

const handleSendSlackMessage = () => {
  if (!props.student.slack_id) {
    return;
  }

  window.open(
    `https://slack.com/app_redirect?channel=${props.student.slack_id}`,
    "_blank",
  );

  emit("send-slack-message");
};
</script>

<template>
  <UCard
    class="h-full w-full"
    :ui="{
      body: 'flex h-full flex-col justify-between gap-5',
    }"
  >
    <div class="flex items-center gap-4">
      <UAvatar
        :src="student.profile_image_url ?? undefined"
        :alt="`${student.first_name} ${student.last_name}`"
        class="mt-1 h-12 w-12 flex-shrink-0"
      />

      <div class="flex min-w-0 flex-col">
        <h2 class="truncate text-xl font-bold">
          {{ student.first_name }}
          {{ student.last_name }}
        </h2>

        <p class="text-muted truncate text-sm">
          {{ student.email || "N/A" }}
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex gap-2">
        <p class="text-highlighted whitespace-nowrap text-sm font-medium">
          Username:
        </p>

        <p class="text-muted truncate text-sm">
          {{ student.username || "N/A" }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <p class="text-highlighted whitespace-nowrap text-sm font-medium">
          Cohort:
        </p>

        <p class="text-muted truncate text-sm">
          {{ student.cohorts?.name || "N/A" }}
        </p>

        <UModal
          v-model:open="isModalOpen"
          title="Change Cohort"
          :ui="{
            footer: 'justify-end',
          }"
          class="ml-auto"
        >
          <UButton color="neutral" icon="i-lucide-edit" variant="soft" />

          <template #body>
            <div class="space-y-4">
              <div>
                <label class="mb-2 block text-sm font-medium">
                  Select New Cohort
                </label>

                <USelect
                  v-model="selectedCohortId"
                  :items="items"
                  :disabled="isUpdating"
                  :loading="isUpdating"
                  placeholder="Select Cohort"
                  class="w-full"
                />
              </div>
            </div>
          </template>

          <template #footer="{ close }">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              :disabled="isUpdating"
              @click="close"
            />

            <UButton
              label="Save"
              variant="subtle"
              color="primary"
              :loading="isUpdating"
              :disabled="isUpdating || !selectedCohortId"
              @click="handleCohortChange"
            />
          </template>
        </UModal>
      </div>

      <div class="flex items-center gap-2">
        <p class="text-highlighted whitespace-nowrap text-sm font-medium">
          Program:
        </p>

        <p class="text-muted truncate text-sm">
          {{ student.programs?.name || "N/A" }}
        </p>

        <UModal
          v-model:open="isProgramModalOpen"
          title="Change Program"
          :ui="{
            footer: 'justify-end',
          }"
          class="ml-auto"
        >
          <UButton color="neutral" icon="i-lucide-edit" variant="soft" />

          <template #body>
            <div class="space-y-4">
              <div>
                <label class="mb-2 block text-sm font-medium">
                  Select New Program
                </label>

                <USelect
                  v-model="selectedProgramId"
                  :items="programOptions"
                  :disabled="isUpdatingProgram"
                  :loading="isUpdatingProgram"
                  placeholder="Select Program"
                  class="w-full"
                />
              </div>
            </div>
          </template>

          <template #footer="{ close }">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              :disabled="isUpdatingProgram"
              @click="close"
            />

            <UButton
              label="Save"
              variant="subtle"
              color="primary"
              :loading="isUpdatingProgram"
              :disabled="isUpdatingProgram || !selectedProgramId"
              @click="handleProgramChange"
            />
          </template>
        </UModal>
      </div>

      <div class="flex gap-2">
        <p class="text-highlighted whitespace-nowrap text-sm font-medium">
          Last Activity:
        </p>

        <p class="text-muted text-sm">
          {{ formatDateTime(student.last_login) || "N/A" }}
        </p>
      </div>
    </div>

    <div class="mt-auto flex w-full flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <span class="text-muted text-xs"> Account status </span>

        <UBadge :color="statusColor" variant="subtle" size="xs">
          {{ student.account_status || "Active" }}
        </UBadge>
      </div>

      <UModal v-model:open="isStatusModalOpen">
        <UButton
          color="neutral"
          variant="outline"
          class="w-full justify-center"
          icon="i-lucide-shield"
          @click="
            selectedStatus = student.account_status ?? 'Active';
            isStatusModalOpen = true;
          "
        >
          Change Status
        </UButton>

        <template #content>
          <UCard>
            <template #header>
              <p class="text-highlighted font-medium">Change Account Status</p>

              <p class="text-muted mt-1 text-xs">
                Inactive, Frozen or Graduated stops this student being scraped.
              </p>
            </template>

            <USelect
              v-model="selectedStatus"
              :items="statusOptions"
              value-key="value"
              placeholder="Select status"
            />

            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="Cancel"
                  color="neutral"
                  variant="outline"
                  :disabled="isUpdatingStatus"
                  @click="isStatusModalOpen = false"
                />

                <UButton
                  label="Update Status"
                  color="primary"
                  :loading="isUpdatingStatus"
                  @click="handleStatusChange"
                />
              </div>
            </template>
          </UCard>
        </template>
      </UModal>

      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="outline"
          class="flex-1 justify-center"
          @click="handleSendEmail"
        >
          Send Email
        </UButton>

        <UButton
          color="neutral"
          variant="outline"
          class="flex-1 justify-center"
          :disabled="!student.slack_id"
          @click="handleSendSlackMessage"
        >
          Slack Message
        </UButton>
      </div>
    </div>
  </UCard>
</template>
