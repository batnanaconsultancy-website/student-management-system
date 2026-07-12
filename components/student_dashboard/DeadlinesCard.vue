<script setup></script>

<template>
  <div class="mt-4 flex flex-col">
    <div class="flex items-center justify-end">
      <nuxtLink
        to="/students/timeline"
        class="text-primary-800 underline text-sm 2xl:text-base hover:text-primary-600"
      >
        View Timeline
      </nuxtLink>
    </div>
  </div>
</template>

<!-- <script setup>
  import { useSupabaseClient } from "#imports";
  import { computed, onMounted, ref } from "vue";

  const props = defineProps({
    seasonId: { type: String, required: true },
    programId: { type: String, required: true },
    cohortId: { type: String, required: true },
  });

  const supabase = useSupabaseClient();
  const projects = ref([]);
  const season = ref(null);
  const today = new Date();

  const upcomingProjects = computed(() => {
    if (!season.value || !season.value[0]) return [];
    const seasonStart = new Date(season.value[0].start_date);
    // Map projects with deadline and start
    const mapped = projects.value.map((project) => {
      const offset = Number(project.offset_days) || 0;
      const duration = Number(project.duration_days) || 1;
      const deadline = new Date(seasonStart);
      deadline.setDate(seasonStart.getDate() + offset + duration - 1);
      const start = new Date(seasonStart);
      start.setDate(seasonStart.getDate() + offset);
      return { ...project, deadline, start };
    });

    // Group all projects with 'bootcamp' in the description (case-insensitive)
    const bootcampGroup = mapped.filter(
      (p) => p.description && p.description.toLowerCase().includes("bootcamp")
    );
    let groups = [];
    if (bootcampGroup.length > 0) {
      const minStart = bootcampGroup.reduce(
        (min, p) => (p.start < min ? p.start : min),
        bootcampGroup[0].start
      );
      const totalDuration = bootcampGroup.reduce(
        (sum, p) => sum + (Number(p.duration_days) || 1),
        0
      );
      const groupDeadline = new Date(minStart);
      groupDeadline.setDate(minStart.getDate() + totalDuration - 1);
      if (today <= groupDeadline) {
        groups.push({
          id: "bootcamp-group",
          name: bootcampGroup[0].description,
          deadline: groupDeadline,
          isGroup: true,
          projects: bootcampGroup,
        });
      }
    }
    // Add all other projects that are not in the bootcamp group and are upcoming
    groups = groups.concat(
      mapped.filter(
        (p) =>
          !(p.description && p.description.toLowerCase().includes("bootcamp")) &&
          today <= p.deadline
      )
    );
    // Sort by closest deadline to today
    return groups.sort((a, b) => a.deadline - b.deadline).slice(0, 2);
  });

  const seasonDeadline = computed(() => {
    if (!season.value || !season.value[0]) return null;
    return new Date(season.value[0].end_date);
  });

  const daysToSeasonDeadline = computed(() => {
    if (!seasonDeadline.value) return null;
    const diff = Math.ceil((seasonDeadline.value - today) / (1000 * 60 * 60 * 24));
    return diff;
  });

  const ready = computed(() => !!props.seasonId && !!props.programId && !!props.cohortId);

  watch(
    ready,
    async (isReady) => {
      if (isReady) {
        const { data: seasonData } = await supabase
          .from("program_cohort_seasons")
          .select(
            `start_date, end_date, seasons!inner (
            id,
            name,
            program_id
        )`
          )
          .eq("cohort_id", props.cohortId)
          .eq("program_id", props.programId)
          .eq("season_id", props.seasonId);

        season.value = seasonData?.map((season) => ({
          id: season.seasons.id,
          name: season.seasons.name,
          start_date: season.start_date,
          end_date: season.end_date,
        }));

        // Fetch projects for this season and program
        const { data: projectData, error } = await supabase
          .from("projects")
          .select("*")
          .eq("season_id", props.seasonId)
          .eq("program_id", props.programId);

        projects.value = Array.isArray(projectData) ? projectData : [];
        console.log("Fetched projects:", projects.value, error);
      }
    },
    { immediate: true }
  );
</script>

<template>
  <div class="mt-4 flex flex-col">
    <div class="flex items-center justify-between">
      <h2 class="font-semibold text-highlighted text-base 2xl:text-xl">Upcoming deadlines</h2>
      <nuxtLink to="/students/timeline" class="text-primary-800 underline text-sm 2xl:text-base hover:text-primary-600">
        View Timeline
      </nuxtLink>
    </div>

    <div class="mt-6 flex gap-4">
      <template v-if="upcomingProjects.length > 0">
        <UCard
          v-for="(project, idx) in upcomingProjects"
          :key="project.id"
          :class="[
            'relative w-full overflow-hidden',
            idx === 1
              ? 'bg-primary-300 dark:bg-primary-100 border-primary-400  dark:border-primary-300 border-1'
              : 'bg-primary-200 dark:bg-primary-100 border-primary-300  dark:border-primary-300 border-1',
          ]"
          variant="none"
          :ui="{
            body: 'xl:!px-4 xl:!py-4 2xl:!py-1 2xl:!px-5 flex flex-col items-start w-full h-34 relative z-10',
          }"
        >
          <div class="pointer-events-none absolute inset-0 z-0 h-full w-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              version="1.1"
              xmlns:xlink="http://www.w3.org/1999/xlink"
              xmlns:svgjs="http://svgjs.dev/svgjs"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              viewBox="0 0 1440 560"
            >
              <g mask="url(#SvgjsMask1001)" fill="none">
                <path
                  d="M522.28 651.82C715.41 619.37 811.98 147.83 1120.08 145.57 1428.18 143.31 1559.73 349.86 1717.88 352.77"
                  :stroke="'var(--color-primary-800)'"
                  stroke-width="2"
                ></path>
                <path
                  d="M365.53 647.68C466.81 645.39 441.6 512.59 745.12 505.89 1048.64 499.19 1302.06 230.31 1504.3 225.89"
                  :stroke="'var(--color-primary-800)'"
                  stroke-width="2"
                ></path>
                <path
                  d="M221.8 648.23C388.58 600.92 428.99 144.56 686.22 133.27 943.46 121.98 918.44 203.27 1150.65 203.27 1382.86 203.27 1497.65 133.47 1615.07 133.27"
                  :stroke="'var(--color-primary-800)'"
                  stroke-width="2"
                ></path>
                <path
                  d="M718.52 628.99C826.74 609.58 774.72 351.5 1049.66 339.55 1324.6 327.6 1540.05 156.47 1711.93 154.75"
                  :stroke="'var(--color-primary-800)'"
                  stroke-width="2"
                ></path>
                <path
                  d="M623.65 646.63C800.26 614.09 882.1 173.24 1161.4 170.38 1440.71 167.52 1557.91 341.85 1699.16 343.98"
                  :stroke="'var(--color-primary-800)'"
                  stroke-width="2"
                ></path>
              </g>
              <defs>
                <mask id="SvgjsMask1001">
                  <rect width="1440" height="560" fill="#ffffff"></rect>
                </mask>
              </defs>
            </svg>
          </div>
          <h3 :class="['text-primary-950 relative z-10 font-semibold text-xl xl:text-2xl']">
            {{ project.name }}
          </h3>
          <p :class="['text-primary-950 relative z-10 pt-1 text-sm xl:text-sm']">
            {{ project.deadline.toLocaleDateString() }}
          </p>
          <p
            :class="[
              'text-primary-950 relative z-10 mt-4 ml-auto text-xl font-semibold 2xl:text-3xl',
            ]"
          >
            {{ Math.max(0, Math.ceil((project.deadline - today) / (1000 * 60 * 60 * 24))) }} days
          </p>
        </UCard>
      </template>

      <template v-else>
        <UCard class="flex h-24 xl:h-30 w-full items-center justify-center ">
          <div
            class="bg-primary-200 dark:bg-primary-100 border border-primary-300 m-auto mb-4 flex p-2 xl:p-3 w-fit items-center justify-center rounded-full"
          >
            <UIcon name="i-pajamas:doc-code" class="size-6 xl:size-8 text-primary-800" />
          </div>
          <p class="text-center text-muted text-sm xl:text-base">No upcoming project</p>
        </UCard>
        <UCard class="flex h-24 xl:h-30 w-full items-center justify-center">
          <div
            class="bg-primary-200 dark:bg-primary-100 border border-primary-300 m-auto mb-4 flex p-2 xl:p-3 w-fit items-center justify-center rounded-full"
          >
            <UIcon name="i-pajamas:doc-code" class="size-6 xl:size-8 text-primary-800" />
          </div>
          <p class="text-center text-muted text-sm xl:text-base">No upcoming project</p>
        </UCard>
      </template>
    </div>

    <UCard
      class="bg-primary-400 dark:bg-primary-100 border-primary-500 dark:border-primary-300 relative mt-4 w-full overflow-hidden border-1"
      :ui="{
        body: 'xl:!px-4 xl:!py-4 2xl:!py-3 2xl:!px-4 !py-2 !px-3 flex flex-col items-start h-26 xl:h-34 relative z-10',
      }"
    >
      <div class="pointer-events-none absolute inset-0 z-0 h-full w-full">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          xmlns:svgjs="http://svgjs.dev/svgjs"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          viewBox="0 0 1440 560"
        >
          <g mask="url(#SvgjsMask1012)" fill="none">
            <path
              d="M -503.2753191494023,321 C -407.28,306.8 -215.28,231.6 -23.275319149402307,250 C 168.72,268.4 264.72,432.8 456.7246808505977,413 C 648.72,393.2 744.72,169.2 936.7246808505977,151 C 1128.72,132.8 1316.07,308.6 1416.7246808505977,322 C 1517.38,335.4 1435.34,238.8 1440,218"
              :stroke="'var(--color-primary-800)'"
            ></path>
            <path
              d="M -625.6056941241858,403 C -529.61,368.8 -337.61,216.2 -145.60569412418576,232 C 46.39,247.8 142.39,497.4 334.3943058758142,482 C 526.39,466.6 622.39,172.2 814.3943058758142,155 C 1006.39,137.8 1169.27,384.4 1294.3943058758143,396 C 1419.52,407.6 1410.88,249.6 1440,213"
              :stroke="'var(--color-primary-800)'"
            ></path>
            <path
              d="M -586.1423367867757,78 C -490.14,135 -298.14,360.8 -106.14233678677572,363 C 85.86,365.2 181.86,86.6 373.85766321322427,89 C 565.86,91.4 661.86,355 853.8576632132243,375 C 1045.86,395 1216.63,184.2 1333.8576632132242,189 C 1451.09,193.8 1418.77,357 1440,399"
              :stroke="'var(--color-primary-800)'"
            ></path>
            <path
              d="M -813.0101302759645,230 C -717.01,249.2 -525.01,348.6 -333.0101302759645,326 C -141.01,303.4 -45.01,90.2 146.9898697240355,117 C 338.99,143.8 434.99,455.2 626.9898697240355,460 C 818.99,464.8 944.39,146 1106.9898697240355,141 C 1269.59,136 1373.4,376.2 1440,435"
              :stroke="'var(--color-primary-800)'"
            ></path>
          </g>
          <defs>
            <mask id="SvgjsMask1012">
              <rect width="1440" height="560" fill="#ffffff"></rect>
            </mask>
          </defs>
        </svg>
      </div>
      <h3 class="text-primary-950 relative z-10 font-semibold text-lg xl:text-2xl">
        {{ (season && season[0]?.name) || "Season" }}
      </h3>
      <p v-if="seasonDeadline" class="text-primary-950 relative z-10 xl:pt-2 text-sm xl:text-sm">
        {{ seasonDeadline.toLocaleDateString() }}
      </p>
      <p
        v-if="daysToSeasonDeadline !== null"
        class="text-primary-950 z-10 mt-3 ml-auto text-lg font-semibold 2xl:text-3xl"
      >
        {{ daysToSeasonDeadline }} days
      </p>
    </UCard>
  </div>
</template>

<style scoped>
  .bg-gradient-to-br {
    background: linear-gradient(135deg, var(--tw-gradient-stops));
  }
</style> -->
