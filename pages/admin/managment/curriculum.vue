<script setup lang="ts">
definePageMeta({ layout: "default", middleware: ["admin"] });

const { showSuccess, showError } = useNotifications();

// Fetch programs for dropdowns
const { data: programsData } = useFetch("/api/programs");
const programs = computed(() =>
  (programsData.value?.data || []).map((p: any) => ({
    label: p.name,
    value: p.id,
  })),
);

// Fetch seasons for project form dropdown
const { data: seasonsData, refresh: refreshSeasons } = useFetch("/api/seasons");
const seasonsByProgram = computed(() => {
  const seasons = seasonsData.value?.data || [];
  return (programId: string) =>
    seasons
      .filter((s: any) => s.program_id === programId)
      .map((s: any) => ({ label: s.name, value: s.id }));
});

// Season form
const seasonForm = reactive({ name: "", program_id: "", order_in_program: 1 });
const savingSeason = ref(false);

async function createSeason() {
  if (!seasonForm.name.trim() || !seasonForm.program_id) {
    showError("Validation", "Season name and programme are required");
    return;
  }
  savingSeason.value = true;
  try {
    await $fetch("/api/seasons/create", {
      method: "POST",
      body: {
        name: seasonForm.name.trim(),
        program_id: seasonForm.program_id,
        order_in_program: seasonForm.order_in_program,
      },
    });
    showSuccess("Created", `Season "${seasonForm.name}" created`);
    seasonForm.name = "";
    seasonForm.order_in_program = 1;
    refreshSeasons();
  } catch (err: any) {
    showError("Error", err?.data?.statusMessage || "Failed to create season");
  } finally {
    savingSeason.value = false;
  }
}

// Project form
const projectForm = reactive({
  name: "",
  description: "",
  duration_days: null as number | null,
  program_id: "",
  season_id: "",
  order: 1,
});
const savingProject = ref(false);

const projectSeasonOptions = computed(() =>
  projectForm.program_id ? seasonsByProgram.value(projectForm.program_id) : [],
);

async function createProject() {
  if (!projectForm.name.trim() || !projectForm.program_id) {
    showError("Validation", "Project name and programme are required");
    return;
  }
  savingProject.value = true;
  try {
    await $fetch("/api/projects/create", {
      method: "POST",
      body: {
        name: projectForm.name.trim(),
        description: projectForm.description.trim() || null,
        duration_days: projectForm.duration_days || null,
        program_id: projectForm.program_id,
        season_id: projectForm.season_id || null,
        order: projectForm.order,
      },
    });
    showSuccess("Created", `Project "${projectForm.name}" created`);
    projectForm.name = "";
    projectForm.description = "";
    projectForm.duration_days = null;
    projectForm.season_id = "";
    projectForm.order = 1;
  } catch (err: any) {
    showError("Error", err?.data?.statusMessage || "Failed to create project");
  } finally {
    savingProject.value = false;
  }
}
</script>

<template>
  <div class="mt-6 w-full lg:max-w-3xl mx-auto space-y-8">
    <div>
      <h1 class="text-highlighted font-medium">Curriculum Setup</h1>
      <p class="text-muted text-[15px] mt-1">
        Define new seasons and projects. Once created, schedule them onto
        cohorts via Management → Seasons and Management → Projects.
      </p>
    </div>

    <!-- Create Season -->
    <div>
      <h2 class="text-highlighted font-medium mb-3">New Season</h2>
      <UCard variant="subtle" :ui="{ body: '!py-4 !px-6' }">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Season Name" required>
              <UInput v-model="seasonForm.name" placeholder="e.g. Season 1" />
            </UFormField>
            <UFormField label="Order in Programme">
              <UInput
                v-model.number="seasonForm.order_in_program"
                type="number"
                min="1"
              />
            </UFormField>
          </div>
          <UFormField label="Programme" required>
            <USelect
              v-model="seasonForm.program_id"
              :items="programs"
              placeholder="Select programme"
            />
          </UFormField>
          <div class="flex justify-end">
            <UButton
              label="Create Season"
              color="primary"
              variant="soft"
              icon="i-lucide-plus"
              :loading="savingSeason"
              @click="createSeason"
            />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Create Project -->
    <div>
      <h2 class="text-highlighted font-medium mb-3">New Project</h2>
      <UCard variant="subtle" :ui="{ body: '!py-4 !px-6' }">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Project Name" required>
              <UInput
                v-model="projectForm.name"
                placeholder="e.g. Building a REST API"
              />
            </UFormField>
            <UFormField label="Duration (days)">
              <UInput
                v-model.number="projectForm.duration_days"
                type="number"
                min="1"
                placeholder="e.g. 10"
              />
            </UFormField>
          </div>
          <UFormField label="Description">
            <UTextarea
              v-model="projectForm.description"
              placeholder="Optional project description"
              :rows="2"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Programme" required>
              <USelect
                v-model="projectForm.program_id"
                :items="programs"
                placeholder="Select programme"
                @update:model-value="projectForm.season_id = ''"
              />
            </UFormField>
            <UFormField label="Season (optional)">
              <USelect
                v-model="projectForm.season_id"
                :items="projectSeasonOptions"
                placeholder="Select season"
                :disabled="!projectForm.program_id"
              />
            </UFormField>
          </div>
          <UFormField label="Order within Season">
            <UInput v-model.number="projectForm.order" type="number" min="1" />
          </UFormField>
          <div class="flex justify-end">
            <UButton
              label="Create Project"
              color="primary"
              variant="soft"
              icon="i-lucide-plus"
              :loading="savingProject"
              @click="createProject"
            />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
