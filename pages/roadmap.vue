<template>
  <UDashboardPanel id="timeline">
    <template #header>
      <UDashboardNavbar title="Timeline">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="relative flex items-center justify-center">
        <UFieldGroup size="xl" class="absolute left-0">
          <UButton
            @click="previousMonth"
            color="neutral"
            variant="outline"
            icon="i-lucide:chevron-left"
            class="text-muted"
          />

          <UButton
            @click="goToToday"
            color="neutral"
            variant="outline"
            class="text-muted"
          >
            Today
          </UButton>

          <UButton
            @click="nextMonth"
            color="neutral"
            variant="outline"
            icon="i-lucide:chevron-right"
            class="text-muted"
          />
        </UFieldGroup>

        <h2 class="text-2xl font-semibold">
          {{ formatMonthYear(currentDate) }}
        </h2>

        <USelect
          v-model="selectedSeasonId"
          size="lg"
          :items="studentSeasons"
          :ui="{
            trailingIcon:
              'group-data-[state=open]:rotate-180 transition-transform duration-200',
          }"
          class="absolute right-0 !w-90"
          placeholder="Filter by Seasons"
        />
      </div>

      <div
        class="relative h-full overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div
          ref="timelineContainer"
          class="timeline h-full overflow-x-auto overflow-y-hidden"
        >
          <div
            class="relative h-full"
            :style="{
              width: `${timelineWidth}px`,
              minHeight: `${dynamicTimelineHeight}px`,
            }"
          >
            <div
              v-if="todayLinePosition !== null"
              :style="{
                left: `${todayLinePosition + 30}px`,
                height: '92%',
                width: '2px',
              }"
              class="pointer-events-none absolute bottom-0 bg-primary-500"
            ></div>

            <div class="pointer-events-none absolute inset-0 flex">
              <div
                v-for="day in daysInMonth"
                :key="`border-${day}`"
                :style="{ width: `${columnWidth}px` }"
              />
            </div>

            <div class="sticky top-0 z-10">
              <div class="flex">
                <div
                  v-for="day in daysInMonth"
                  :key="day"
                  class="rounded-md p-2 text-center"
                  :style="{ width: `${columnWidth}px` }"
                >
                  <div
                    :class="[
                      isToday(day)
                        ? 'bg-primary-100 font-semibold text-primary-600'
                        : 'font-semibold text-primary-600',
                      !isToday(day) && !isWeekend(day)
                        ? 'bg-white dark:bg-transparent'
                        : '',
                    ]"
                    class="flex flex-row-reverse items-center justify-center gap-1.5 rounded-md px-1 py-1"
                  >
                    <div class="text-sm uppercase text-primary-400">
                      {{ getDayOfWeek(day) }}
                    </div>

                    <div
                      class="text-sm font-semibold"
                      :class="{
                        'text-gray-900 dark:text-primary-800': !isToday(day),
                      }"
                    >
                      {{ day }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="relative" style="height: 100%; padding-top: 16px">
              <div
                class="pointer-events-none absolute inset-0 flex"
                style="z-index: 0"
              >
                <div
                  v-for="day in daysInMonth"
                  :key="`bg-${day}`"
                  class="border-r border-neutral-200 dark:border-neutral-700"
                  :style="{
                    width: `${columnWidth}px`,
                    height: '100%',
                  }"
                >
                  <svg v-if="isWeekend(day)" height="100%" width="100%">
                    <defs>
                      <pattern
                        id="doodad"
                        width="16"
                        height="16"
                        viewBox="0 0 40 40"
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(135)"
                        class="dark:hidden"
                      >
                        <rect
                          width="100%"
                          height="100%"
                          class="fill-white dark:fill-[#18181b]"
                        />
                        <path
                          d="M-10 30h60v1h-60zM-10-10h60v1h-60"
                          fill="rgba(203, 213, 224,1)"
                        />
                        <path
                          d="M-10 10h60v1h-60zM-10-30h60v1h-60z"
                          fill="rgba(203, 213, 224,1)"
                        />
                      </pattern>

                      <pattern
                        id="doodad-dark"
                        width="16"
                        height="16"
                        viewBox="0 0 40 40"
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(135)"
                        class="hidden dark:block"
                      >
                        <rect
                          width="100%"
                          height="100%"
                          class="fill-white dark:fill-[#18181b]"
                        />
                        <path
                          d="M-10 30h60v1h-60zM-10-10h60v1h-60"
                          fill="rgba(51, 65, 85,1)"
                        />
                        <path
                          d="M-10 10h60v1h-60zM-10-30h60v1h-60z"
                          fill="rgba(51, 65, 85,1)"
                        />
                      </pattern>
                    </defs>

                    <rect
                      fill="url(#doodad)"
                      height="200%"
                      width="200%"
                      class="dark:hidden"
                    />

                    <rect
                      fill="url(#doodad-dark)"
                      height="200%"
                      width="200%"
                      class="hidden dark:block"
                    />
                  </svg>
                </div>
              </div>

              <div
                v-for="item in projectItems"
                :key="item.id"
                class="absolute flex h-14 cursor-pointer items-center justify-between bg-white px-3 py-2 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:bg-neutral-800"
                :class="[
                  item.crossMonth
                    ? 'rounded-l-lg border-r-2 border-dashed border-gray-300 dark:border-gray-600'
                    : 'rounded-lg',
                  item.title.includes('(cont.)')
                    ? 'rounded-l-none rounded-r-lg border-l-2 border-dashed border-gray-300 dark:border-gray-600'
                    : '',
                ]"
                :style="getItemStyle(item)"
              >
                <div
                  v-if="!item.title.includes('(cont.)')"
                  class="absolute -top-5 left-0 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                  :style="{
                    backgroundColor:
                      item.seasonColor || 'var(--color-primary-500)',
                  }"
                >
                  <UIcon name="i-lucide-pin" class="size-2.5" />
                  Start
                </div>

                <div
                  v-if="!item.crossMonth"
                  class="absolute -top-5 right-0 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                  :style="{
                    backgroundColor:
                      item.seasonColor || 'var(--color-primary-500)',
                  }"
                >
                  <UIcon name="i-lucide-pin" class="size-2.5" />
                  End
                </div>

                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    :class="getItemClasses(item.type)"
                    :style="{ backgroundColor: item.seasonColor }"
                  ></div>

                  <div class="flex w-full min-w-0 items-center justify-between">
                    <span
                      class="overflow-hidden text-sm font-medium text-ellipsis whitespace-nowrap text-gray-700 dark:text-white"
                    >
                      {{ item.title }}
                    </span>

                    <span
                      v-if="item.season"
                      class="w-fit rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      :style="{
                        backgroundColor: `${item.seasonColor || 'var(--color-primary-500)'}90`,
                      }"
                    >
                      {{ getSeasonInitials(item.season) }}
                    </span>
                  </div>
                </div>

                <div
                  v-if="item.crossMonth"
                  class="ml-2 flex items-center text-xs text-gray-400"
                >
                  <UIcon
                    v-if="item.title.includes('(cont.)')"
                    name="lucide:chevron-left"
                    class="size-4"
                  />

                  <UIcon v-else name="lucide:chevron-right" class="size-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({
  layout: "custom",
});

interface ProjectItem {
  id: string;
  title: string;
  type: 1 | 2 | 3 | 4;
  startDate: number;
  endDate: number;
  avatars: string[];
  crossMonth?: boolean;
  season?: string;
  seasonColor?: string;
  calculatedRow?: number;
}

interface SeasonDeadline {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  type: number;
}

interface StudentRecord {
  cohort_id: string;
  program_id: string;
  current_season_id: string | null;
}

interface ProgramCohortSeasonRow {
  id: string;
  start_date: string;
  end_date: string;
}

interface ProjectScheduleRow {
  id: string;
  start_date: string;
  end_date: string;
  projects: {
    id: string;
    name: string;
    description: string | null;
  };
}

interface SeasonProgressRow {
  start_date: string;
  end_date: string;
  cohort_id: string;
  seasons: {
    id: string;
    name: string;
    program_id: string;
  };
}

interface SeasonGroup {
  baseName: string;
  displayName: string;
  specializations: string[];
  start_date: string;
  end_date: string;
  ids: string[];
}

interface SeasonSourceRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

const today = new Date();
const currentDate = ref(new Date());
const zoomLevel = ref(50);
const timelineContainer = ref<HTMLElement>();

const allowedStartDate = ref<Date | undefined>(undefined);
const allowedEndDate = ref<Date | undefined>(undefined);

const projectItems = ref<ProjectItem[]>([]);

const studentSeasons = ref<Array<{ label: string; value: string }>>([]);
const selectedSeasonId = ref<string | undefined>(undefined);

const studentProgramId = ref<string | null>(null);
const studentCohortId = ref<string | null>(null);

const cohortSeasonsDeadlines = ref<SeasonDeadline[]>([]);

const supabase = useSupabaseClient();

const goToToday = () => {
  selectedSeasonId.value = undefined;
  allowedStartDate.value = undefined;
  allowedEndDate.value = undefined;

  currentDate.value = new Date(today.getFullYear(), today.getMonth(), 1);

  loadProjectsForCurrentMonth();
};

watch(
  () => selectedSeasonId.value,
  async (newVal) => {
    const selectedSeason = cohortSeasonsDeadlines.value.find(
      (season) => season.id === newVal,
    );

    if (!selectedSeason) return;

    const startDate = new Date(selectedSeason.start_date);
    const endDate = new Date(selectedSeason.end_date);

    allowedStartDate.value = startDate;
    allowedEndDate.value = endDate;

    const now = new Date();
    const todayInSeason = now >= startDate && now <= endDate;
    const targetDate = todayInSeason ? now : startDate;

    currentDate.value = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      1,
    );

    console.log("🔍 Season selected:", selectedSeason);

    await loadProjectsForSeason(selectedSeason.id);

    scrollToDay(targetDate.getDate());
  },
);

const scrollToDay = (day: number) => {
  if (!timelineContainer.value) return;

  const scrollLeft = (day - 1) * columnWidth.value;

  timelineContainer.value.scrollTo({
    left: scrollLeft,
    behavior: "smooth",
  });
};

const loadProjectsForSeason = async (seasonId: string) => {
  console.log("🔍 loadProjectsForSeason called with seasonId:", seasonId);

  if (!seasonId) {
    console.warn("❌ No seasonId provided");
    return;
  }

  const programId = studentProgramId.value;
  const cohortId = studentCohortId.value;

  console.log("📋 Student info:", {
    programId,
    cohortId,
    seasonId,
  });

  if (!programId || !cohortId) {
    console.warn("❌ Missing programId or cohortId");
    return;
  }

  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);

  const selectedSeason = cohortSeasonsDeadlines.value.find(
    (season) => season.id === seasonId,
  );

  const seasonName = selectedSeason?.name || "Unknown Season";
  const isFinalProjectSeason = seasonName
    .toLowerCase()
    .includes("final project");

  const { data: rawPcsData, error: pcsError } = await supabase
    .from("program_cohort_seasons")
    .select("id, start_date, end_date")
    .eq("season_id", seasonId)
    .eq("cohort_id", cohortId)
    .eq("program_id", programId)
    .single();

  const pcsData = rawPcsData as unknown as ProgramCohortSeasonRow | null;

  console.log("🔗 program_cohort_seasons query result:", {
    pcsData,
    pcsError,
  });

  if (pcsError || !pcsData) {
    console.error("❌ Error fetching program_cohort_season:", pcsError);
    return;
  }

  const programCohortSeasonId = pcsData.id;
  const seasonStartDate = new Date(pcsData.start_date);
  const seasonEndDate = new Date(pcsData.end_date);

  let seasonMarkerItems: ProjectItem[] = [];

  if (!(seasonEndDate < monthStart || seasonStartDate > monthEnd)) {
    const startDay = Math.max(
      1,
      seasonStartDate > monthStart ? seasonStartDate.getDate() : 1,
    );

    const endDay = Math.min(
      monthEnd.getDate(),
      seasonEndDate < monthEnd ? seasonEndDate.getDate() : monthEnd.getDate(),
    );

    seasonMarkerItems = [
      {
        title: seasonName,
        type: 4,
        startDate: startDay,
        endDate: endDay,
        season: seasonName,
        seasonColor: "var(--color-primary-500)",
        id: `season-marker-${programCohortSeasonId}`,
        crossMonth: seasonEndDate > monthEnd,
        avatars: [],
      },
    ];
  }

  if (isFinalProjectSeason) {
    console.log(
      "🎓 Final Project season -- using the season marker as the only item",
    );

    projectItems.value = calculateNonOverlappingPositions(seasonMarkerItems);

    return;
  }

  const { data: rawProjectSchedules, error: scheduleError } = await supabase
    .from("program_cohort_season_projects")
    .select(
      `
        id,
        start_date,
        end_date,
        projects!inner (
          id,
          name,
          description
        )
      `,
    )
    .eq("program_cohort_season_id", programCohortSeasonId);

  const projectSchedules = rawProjectSchedules as unknown as
    | ProjectScheduleRow[]
    | null;

  if (scheduleError) {
    console.error("❌ Error fetching project schedules:", scheduleError);
    return;
  }

  const schedules = projectSchedules ?? [];

  if (schedules.length === 0) {
    projectItems.value = calculateNonOverlappingPositions(seasonMarkerItems);

    return;
  }

  const timelineProjects: ProjectItem[] = [...seasonMarkerItems];

  schedules.forEach((schedule) => {
    const start = new Date(schedule.start_date);
    const end = new Date(schedule.end_date);

    if (end < monthStart || start > monthEnd) {
      return;
    }

    const startDay = start < monthStart ? 1 : start.getDate();

    const endDay = end > monthEnd ? monthEnd.getDate() : end.getDate();

    timelineProjects.push({
      title: schedule.projects.name,
      type: 4,
      startDate: startDay,
      endDate: endDay,
      season: seasonName,
      seasonColor: "var(--color-primary-500)",
      crossMonth: end > monthEnd,
      id: `proj-${schedule.id}`,
      avatars: [],
    });
  });

  projectItems.value = calculateNonOverlappingPositions(timelineProjects);
};

const projectTemplates: Record<string, ProjectItem[]> = {
  "2025-08": [
    {
      id: "loading",
      title: "Loading...",
      type: 1,
      startDate: 4,
      endDate: 9,
      season: "Loading...",
      seasonColor: "var(--color-primary-500)",
      avatars: [],
    },
  ],
};

const addSeasonMarkerAcrossMonths = (
  timelineProjects: Record<string, ProjectItem[]>,
  seasonName: string,
  startDate: Date,
  endDate: Date,
  idPrefix: string,
) => {
  let currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (currentMonth <= lastMonth) {
    const monthKey = `${currentMonth.getFullYear()}-${String(
      currentMonth.getMonth() + 1,
    ).padStart(2, "0")}`;

    if (!timelineProjects[monthKey]) {
      timelineProjects[monthKey] = [];
    }

    const monthStart = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      1,
    );

    const monthEnd = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0,
    );

    const itemStartInMonth = Math.max(
      startDate.getTime(),
      monthStart.getTime(),
    );

    const itemEndInMonth = Math.min(endDate.getTime(), monthEnd.getTime());

    const startDay = new Date(itemStartInMonth).getDate();
    const endDay = new Date(itemEndInMonth).getDate();

    timelineProjects[monthKey].push({
      title: seasonName,
      type: 4,
      startDate: startDay,
      endDate: endDay,
      crossMonth: endDate > monthEnd,
      season: seasonName,
      seasonColor: "var(--color-primary-500)",
      id: `${idPrefix}-${monthKey}`,
      avatars: [],
    });

    currentMonth.setMonth(currentMonth.getMonth() + 1);
  }
};

const addSeasonsToTimeline = async (seasons: SeasonSourceRow[]) => {
  console.log("🌟 addSeasonsToTimeline called with", seasons.length, "seasons");

  const timelineProjects: Record<string, ProjectItem[]> = {};

  const groupedSeasons = groupSeasonsByBaseName(seasons);

  for (const seasonGroup of groupedSeasons) {
    const startDate = new Date(seasonGroup.start_date);
    const endDate = new Date(seasonGroup.end_date);

    const isFinalProjectSeason = seasonGroup.baseName
      .toLowerCase()
      .includes("final project");

    addSeasonMarkerAcrossMonths(
      timelineProjects,
      seasonGroup.baseName,
      startDate,
      endDate,
      `season-${seasonGroup.ids.join("-")}`,
    );

    if (isFinalProjectSeason) {
      continue;
    }

    const cohortId = studentCohortId.value;
    const programId = studentProgramId.value;

    if (!cohortId || !programId) {
      continue;
    }

    for (const seasonId of seasonGroup.ids) {
      const { data: rawPcsData, error: pcsError } = await supabase
        .from("program_cohort_seasons")
        .select("id")
        .eq("season_id", seasonId)
        .eq("cohort_id", cohortId)
        .eq("program_id", programId)
        .maybeSingle();

      const pcsData = rawPcsData as unknown as {
        id: string;
      } | null;

      if (pcsError || !pcsData) {
        continue;
      }

      const { data: rawProjectSchedules, error: projError } = await supabase
        .from("program_cohort_season_projects")
        .select(
          `
            id,
            start_date,
            end_date,
            projects!inner (
              id,
              name,
              description
            )
          `,
        )
        .eq("program_cohort_season_id", pcsData.id);

      const projectSchedules = rawProjectSchedules as unknown as
        | ProjectScheduleRow[]
        | null;

      if (projError || !projectSchedules || projectSchedules.length === 0) {
        continue;
      }

      projectSchedules.forEach((schedule) => {
        const projStart = new Date(schedule.start_date);
        const projEnd = new Date(schedule.end_date);

        let currentMonth = new Date(
          projStart.getFullYear(),
          projStart.getMonth(),
          1,
        );

        const lastMonth = new Date(
          projEnd.getFullYear(),
          projEnd.getMonth(),
          1,
        );

        while (currentMonth <= lastMonth) {
          const monthKey = `${currentMonth.getFullYear()}-${String(
            currentMonth.getMonth() + 1,
          ).padStart(2, "0")}`;

          if (!timelineProjects[monthKey]) {
            timelineProjects[monthKey] = [];
          }

          const monthStart = new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth(),
            1,
          );

          const monthEnd = new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth() + 1,
            0,
          );

          const itemStartInMonth = Math.max(
            projStart.getTime(),
            monthStart.getTime(),
          );

          const itemEndInMonth = Math.min(
            projEnd.getTime(),
            monthEnd.getTime(),
          );

          const startDay = new Date(itemStartInMonth).getDate();

          const endDay = new Date(itemEndInMonth).getDate();

          timelineProjects[monthKey].push({
            title: schedule.projects.name,
            type: 4,
            startDate: startDay,
            endDate: endDay,
            crossMonth: projEnd > monthEnd,
            season: seasonGroup.baseName,
            seasonColor: "var(--color-primary-500)",
            id: `proj-${schedule.id}-${monthKey}`,
            avatars: [],
          });

          currentMonth.setMonth(currentMonth.getMonth() + 1);
        }
      });
    }
  }

  Object.keys(projectTemplates).forEach((key) => {
    delete projectTemplates[key];
  });

  Object.assign(projectTemplates, timelineProjects);

  loadProjectsForCurrentMonth();
};

const todayLinePosition = computed(() => {
  const todayDate = new Date();

  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();

  if (todayDate.getFullYear() === year && todayDate.getMonth() === month) {
    return (todayDate.getDate() - 1) * columnWidth.value;
  }

  return null;
});

const groupSeasonsByBaseName = (seasons: SeasonSourceRow[]): SeasonGroup[] => {
  const seasonGroups = new Map<string, SeasonGroup>();

  seasons.forEach((season) => {
    const seasonInfo = extractSeasonInfo(season.name);

    const existingGroup = seasonGroups.get(seasonInfo.baseName);

    if (existingGroup) {
      if (
        seasonInfo.specialization &&
        !existingGroup.specializations.includes(seasonInfo.specialization)
      ) {
        existingGroup.specializations.push(seasonInfo.specialization);
      }

      existingGroup.ids.push(season.id);

      if (new Date(season.start_date) < new Date(existingGroup.start_date)) {
        existingGroup.start_date = season.start_date;
      }

      if (new Date(season.end_date) > new Date(existingGroup.end_date)) {
        existingGroup.end_date = season.end_date;
      }

      return;
    }

    seasonGroups.set(seasonInfo.baseName, {
      baseName: seasonInfo.baseName,
      displayName: seasonInfo.baseName,
      specializations: seasonInfo.specialization
        ? [seasonInfo.specialization]
        : [],
      start_date: season.start_date,
      end_date: season.end_date,
      ids: [season.id],
    });
  });

  return Array.from(seasonGroups.values()).map((group) => ({
    ...group,
    displayName:
      group.specializations.length > 0
        ? `${group.baseName} (${group.specializations.join(", ")})`
        : group.baseName,
  }));
};

const extractSeasonInfo = (
  seasonName: string,
): {
  baseName: string;
  specialization: string | null;
} => {
  const patterns: Array<{
    regex: RegExp;
    baseGroup: number;
    specializationGroup: number;
  }> = [
    {
      regex: /^(Season \d+ Software Engineer)\s+(Cpp|Go|Rust)$/i,
      baseGroup: 1,
      specializationGroup: 2,
    },
    {
      regex: /^(Season \d+ Machine Learning)\s+(Python|R|TensorFlow)$/i,
      baseGroup: 1,
      specializationGroup: 2,
    },
    {
      regex: /^(Season \d+ Data Science)\s+(Advanced|Basic|Intermediate)$/i,
      baseGroup: 1,
      specializationGroup: 2,
    },
  ];

  for (const pattern of patterns) {
    const match = seasonName.match(pattern.regex);

    if (match) {
      return {
        baseName: match[pattern.baseGroup] ?? seasonName,
        specialization: match[pattern.specializationGroup] ?? null,
      };
    }
  }

  return {
    baseName: seasonName,
    specialization: null,
  };
};

const generateProjectsForMonth = (
  year: number,
  month: number,
): ProjectItem[] => {
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  return projectTemplates[monthKey] ?? [];
};

const loadProjectsForCurrentMonth = () => {
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();

  const projects = generateProjectsForMonth(year, month);

  const processedProjects = calculateNonOverlappingPositions(projects);

  projectItems.value = processedProjects.map((project, index) => ({
    ...project,
    id: `${year}-${month}-${index}`,
    avatars: project.avatars.length
      ? project.avatars
      : ["/avatar1.jpg", "/avatar2.jpg"],
  }));
};

const calculateNonOverlappingPositions = (
  projects: ProjectItem[],
): ProjectItem[] => {
  if (!projects.length) {
    return projects;
  }

  const sortedProjects = [...projects].sort(
    (a, b) => a.startDate - b.startDate,
  );

  const occupiedRows: Array<{
    endDate: number;
    row: number;
  }> = [];

  return sortedProjects.map((project) => {
    let assignedRow = -1;

    for (let i = 0; i < occupiedRows.length; i++) {
      const existingRow = occupiedRows[i];

      if (!existingRow) {
        continue;
      }

      if (project.startDate > existingRow.endDate + 1) {
        assignedRow = existingRow.row;

        existingRow.endDate = project.endDate;

        break;
      }
    }

    if (assignedRow === -1) {
      assignedRow = occupiedRows.length;

      occupiedRows.push({
        endDate: project.endDate,
        row: assignedRow,
      });
    }

    return {
      ...project,
      calculatedRow: assignedRow,
    };
  });
};

const daysInMonth = computed(() => {
  const year = currentDate.value.getFullYear();

  const month = currentDate.value.getMonth();

  const days = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: days }, (_, i) => i + 1);
});

const columnWidth = computed(() => {
  return Math.max(60, (zoomLevel.value / 100) * 80);
});

const timelineWidth = computed(() => {
  return daysInMonth.value.length * columnWidth.value;
});

const dynamicTimelineHeight = computed(() => {
  if (!projectItems.value.length) {
    return 364;
  }

  const maxRow = Math.max(
    ...projectItems.value.map((item) => item.calculatedRow ?? 0),
    0,
  );

  const baseRowHeight = 64;
  const startOffset = 16;
  const bottomPadding = 20;

  return startOffset + (maxRow + 1) * baseRowHeight + bottomPadding;
});

const formatMonthYear = (date: Date) => {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
};

const getDayOfWeek = (day: number) => {
  const year = currentDate.value.getFullYear();

  const month = currentDate.value.getMonth();

  const date = new Date(year, month, day);

  return date.toLocaleDateString("en-US", {
    weekday: "narrow",
  });
};

const isToday = (day: number) => {
  const currentToday = new Date();

  const year = currentDate.value.getFullYear();

  const month = currentDate.value.getMonth();

  return (
    currentToday.getFullYear() === year &&
    currentToday.getMonth() === month &&
    currentToday.getDate() === day
  );
};

const isWeekend = (day: number) => {
  const year = currentDate.value.getFullYear();

  const month = currentDate.value.getMonth();

  const date = new Date(year, month, day);

  const dayOfWeek = date.getDay();

  return dayOfWeek === 0 || dayOfWeek === 6;
};

const getItemStyle = (item: ProjectItem) => {
  const startPosition = (item.startDate - 1) * columnWidth.value;

  const duration = item.endDate - item.startDate + 1;

  const itemWidth = duration * columnWidth.value;

  const baseRowHeight = 64;
  const startOffset = 16;

  const calculatedRow = item.calculatedRow;

  const verticalPosition =
    calculatedRow !== undefined
      ? startOffset + calculatedRow * baseRowHeight
      : getTypeBasedPosition(item.type);

  return {
    left: `${startPosition}px`,
    width: `${itemWidth}px`,
    top: `${verticalPosition}px`,
  };
};

const getTypeBasedPosition = (type: number) => {
  const positions: Record<number, number> = {
    1: 16,
    2: 80,
    3: 144,
    4: 208,
  };

  return positions[type] ?? 16;
};

const getItemClasses = (type: number) => {
  const classes: Record<number, string> = {
    1: "h-8 w-1.5 bg-blue-600 rounded-md",
    2: "h-8 w-1.5 bg-green-600 rounded-md",
    3: "h-8 w-1.5 bg-yellow-600 rounded-md",
    4: "h-8 w-1.5 bg-red-600 rounded-md",
  };

  return classes[type] ?? "h-8 w-1.5 bg-gray-600 rounded-md";
};

const getSeasonInitials = (seasonName: string) => {
  if (!seasonName) {
    return "";
  }

  const patterns: Array<{
    regex: RegExp;
    format: (match: RegExpMatchArray) => string;
  }> = [
    {
      regex: /Season (\d+) Arc (\d+)/i,
      format: (match) => `S${match[1] ?? ""}A${match[2] ?? ""}`,
    },
    {
      regex: /Season (\d+) Software Engineer/i,
      format: (match) => `S${match[1] ?? ""}`,
    },
    {
      regex: /Season (\d+) Software Engineer Cpp/i,
      format: (match) => `S${match[1] ?? ""}C++`,
    },
    {
      regex: /Season (\d+) Software Engineer Rust/i,
      format: (match) => `S${match[1] ?? ""}R`,
    },
    {
      regex: /Season (\d+) Software Engineer Go/i,
      format: (match) => `S${match[1] ?? ""}Go`,
    },
    {
      regex: /Season (\d+) Machine Learning/i,
      format: (match) => `S${match[1] ?? ""}ML`,
    },
    {
      regex: /Season (\d+) Data Science/i,
      format: (match) => `S${match[1] ?? ""}DS`,
    },
    {
      regex: /Season (\d+)/i,
      format: (match) => `S${match[1] ?? ""}`,
    },
    {
      regex: /Preseason Data/i,
      format: () => "PD",
    },
    {
      regex: /Preseason Web/i,
      format: () => "PW",
    },
  ];

  for (const pattern of patterns) {
    const match = seasonName.match(pattern.regex);

    if (match) {
      return pattern.format(match);
    }
  }

  return seasonName
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 4);
};

const previousMonth = () => {
  const newDate = new Date(currentDate.value);

  newDate.setMonth(newDate.getMonth() - 1);

  if (
    allowedStartDate.value &&
    (newDate.getFullYear() < allowedStartDate.value.getFullYear() ||
      (newDate.getFullYear() === allowedStartDate.value.getFullYear() &&
        newDate.getMonth() < allowedStartDate.value.getMonth()))
  ) {
    return;
  }

  currentDate.value = newDate;

  const lastDay = new Date(
    newDate.getFullYear(),
    newDate.getMonth() + 1,
    0,
  ).getDate();

  scrollToDay(lastDay);

  if (selectedSeasonId.value) {
    loadProjectsForSeason(selectedSeasonId.value);
  } else {
    loadProjectsForCurrentMonth();
  }
};

const nextMonth = () => {
  const newDate = new Date(currentDate.value);

  newDate.setMonth(newDate.getMonth() + 1);

  if (
    allowedEndDate.value &&
    (newDate.getFullYear() > allowedEndDate.value.getFullYear() ||
      (newDate.getFullYear() === allowedEndDate.value.getFullYear() &&
        newDate.getMonth() > allowedEndDate.value.getMonth()))
  ) {
    return;
  }

  currentDate.value = newDate;

  scrollToDay(1);

  if (selectedSeasonId.value) {
    loadProjectsForSeason(selectedSeasonId.value);
  } else {
    loadProjectsForCurrentMonth();
  }
};

const loadSeasonDeadlines = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const email = session?.user?.email;

  if (!email) {
    console.error("Unable to determine the signed-in student's email.");
    return;
  }

  const { data: rawStudent, error: studentError } = await supabase
    .from("students")
    .select("cohort_id, program_id, current_season_id")
    .eq("email", email)
    .single();

  const student = rawStudent as unknown as StudentRecord | null;

  if (studentError || !student) {
    console.error("Unable to load student:", studentError);
    return;
  }

  studentProgramId.value = student.program_id;

  studentCohortId.value = student.cohort_id;

  const cohortId = student.cohort_id;

  const programId = student.program_id;

  const { data: rawSeasonsProgress, error: progressError } = await supabase
    .from("program_cohort_seasons")
    .select(
      `
          start_date,
          end_date,
          cohort_id,
          seasons!inner (
            id,
            name,
            program_id
          )
        `,
    )
    .eq("cohort_id", cohortId)
    .eq("program_id", programId)
    .order("start_date", {
      ascending: true,
      nullsFirst: false,
    });

  const seasonsProgress = rawSeasonsProgress as unknown as
    | SeasonProgressRow[]
    | null;

  studentSeasons.value = (seasonsProgress ?? []).map((season) => ({
    label: season.seasons.name,
    value: String(season.seasons.id),
  }));

  console.log("Fetched seasons progress:", {
    seasonsProgress,
    progressError,
  });

  const seasons: SeasonSourceRow[] = (seasonsProgress ?? []).map((season) => ({
    id: season.seasons.id,
    name: season.seasons.name,
    start_date: season.start_date,
    end_date: season.end_date,
  }));

  cohortSeasonsDeadlines.value = seasons.map((season) => ({
    id: season.id,
    name: season.name,
    start_date: season.start_date,
    end_date: season.end_date,
    type: 2,
  }));

  if (seasons.length > 0) {
    await addSeasonsToTimeline(seasons);
  }

  if (student.current_season_id && !selectedSeasonId.value) {
    const currentSeasonMatch = cohortSeasonsDeadlines.value.find(
      (season) => String(season.id) === String(student.current_season_id),
    );

    if (currentSeasonMatch) {
      selectedSeasonId.value = String(student.current_season_id);
    }
  }
};

onMounted(() => {
  loadProjectsForCurrentMonth();
  loadSeasonDeadlines();

  const handleKeydown = (event: KeyboardEvent) => {
    if (!timelineContainer.value) {
      return;
    }

    const scrollAmount = columnWidth.value * 2;

    if (event.key === "ArrowLeft") {
      event.preventDefault();

      timelineContainer.value.scrollBy({
        left: -scrollAmount,
        behavior: "smooth",
      });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();

      timelineContainer.value.scrollBy({
        left: scrollAmount,
        behavior: "smooth",
      });
    }
  };

  window.addEventListener("keydown", handleKeydown);

  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
});
</script>

<style scoped>
.timeline {
  scrollbar-width: 6px;
  scrollbar-color: #c2c2c2a2 transparent;
}
</style>
