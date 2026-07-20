<template>
      <UDashboardPanel id="timeline">
      <template #header>
          <UDashboardNavbar title="Timeline" >
              <template #leading>
                  <UDashboardSidebarCollapse />
              </template>
          </UDashboardNavbar>
      </template>

      <template #body>
        <div v-if="timelineError" class="mx-6 mt-4 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          {{ timelineError }}
        </div>

        <!-- Header with month/year and navigation -->
        <div class="flex items-center justify-center relative">
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
            <h2 class="text-2xl font-semibold">{{ formatMonthYear(currentDate) }}</h2>
            <USelect
                size="lg"
                v-model="selectedSeasonId"
                :items="studentSeasons"
                :ui="{
                  trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
                }"
                class="absolute right-0 !w-90"
                placeholder="Filter by Seasons"
            />
        </div>

        <!-- Scrollable timeline container -->
        <div class="relative h-full overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <!-- Timeline wrapper with horizontal scroll -->
          <div ref="timelineContainer" class="timeline h-full overflow-x-auto overflow-y-hidden">
            <div
              class="relative h-full"
              :style="{ width: timelineWidth + 'px', minHeight: dynamicTimelineHeight + 'px' }"
            >
              <div
                v-if="todayLinePosition !== null"
                :style="{
                  left: todayLinePosition + 30 + 'px',
                  height: '92%',
                  width: '2px',
                }"
                class="pointer-events-none absolute bottom-0 bg-primary-500"
              ></div>
              <!-- Column borders background -->
              <div class="pointer-events-none absolute inset-0 flex">
                <div
                  v-for="day in daysInMonth"
                  :key="`border-${day}`"
                  :style="{ width: columnWidth + 'px' }"
                />
              </div>

              <!-- Days header row -->
              <div class="sticky top-0 z-10">
                <div class="flex">
                  <div
                    v-for="day in daysInMonth"
                    :key="day"
                    class="rounded-md p-2 text-center"
                    :style="{ width: columnWidth + 'px' }"
                  >
                    <div
                      :class="[
                        isToday(day) ? 'bg-primary-100 font-semibold text-primary-600' : 'font-semibold text-primary-600',
                        !isToday(day) && !isWeekend(day) ? 'bg-white dark:bg-transparent' : '',
                      ]"
                      class="flex flex-row-reverse items-center justify-center gap-1.5 rounded-md px-1 py-1"
                    >
                      <div
                        class="text-sm uppercase text-primary-400"
                      >
                        {{ getDayOfWeek(day) }}
                      </div>
                      <div class="text-sm font-semibold" :class="{ 'text-gray-900 dark:text-primary-800': !isToday(day) }">{{ day }}</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Timeline content area -->
              <div class="relative" style="height: 100%; padding-top: 16px">
                <div class="pointer-events-none absolute inset-0 flex" style="z-index: 0">
                  <div
                    v-for="day in daysInMonth"
                    :key="`bg-${day}`"
                    class="border-r border-neutral-200 dark:border-neutral-700"
                    :style="{ width: columnWidth + 'px', height: '100%' }"
                  >
                    <svg height="100%" width="100%" v-if="isWeekend(day)">
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
                          <rect width="100%" height="100%" class="fill-white dark:fill-[#18181b]" />
                          <path d="M-10 30h60v1h-60zM-10-10h60v1h-60" fill="rgba(203, 213, 224,1)" />
                          <path d="M-10 10h60v1h-60zM-10-30h60v1h-60z" fill="rgba(203, 213, 224,1)" />
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
                          <rect width="100%" height="100%" class="fill-white dark:fill-[#18181b]" />
                          <path d="M-10 30h60v1h-60zM-10-10h60v1h-60" fill="rgba(51, 65, 85,1)" />
                          <path d="M-10 10h60v1h-60zM-10-30h60v1h-60z" fill="rgba(51, 65, 85,1)" />
                        </pattern>
                      </defs>
                      <rect fill="url(#doodad)" height="200%" width="200%" class="dark:hidden" />
                      <rect fill="url(#doodad-dark)" height="200%" width="200%" class="hidden dark:block" />
                    </svg>
                  </div>
                </div>
                <!-- Project items -->
                <div
                  v-for="item in projectItems"
                  :key="item.id"
                  class="absolute flex h-14 cursor-pointer items-center justify-between bg-white dark:bg-neutral-800 px-3 py-2 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  :class="[
                    item.crossMonth
                      ? 'rounded-l-lg border-r-2 border-dashed border-gray-300 dark:border-gray-600'
                      : 'rounded-lg',
                    item.title?.includes('(cont.)')
                      ? 'rounded-l-none rounded-r-lg border-l-2 border-dashed border-gray-300 dark:border-gray-600'
                      : '',
                  ]"
                  :style="getItemStyle(item)"
                >
                  <!-- Start pin (skip if this segment continues from a previous month) -->
                  <div
                    v-if="!item.title?.includes('(cont.)')"
                    class="absolute -top-5 left-0 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                    :style="{ backgroundColor: item.seasonColor || 'var(--color-primary-500)' }"
                  >
                    <UIcon name="i-lucide-pin" class="size-2.5" />
                    Start
                  </div>
                  <!-- End pin (skip if this segment continues into the next month) -->
                  <div
                    v-if="!item.crossMonth"
                    class="absolute -top-5 right-0 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                    :style="{ backgroundColor: item.seasonColor || 'var(--color-primary-500)' }"
                  >
                    <UIcon name="i-lucide-pin" class="size-2.5" />
                    End
                  </div>
                  <div class="flex min-w-0 flex-1 items-center gap-3">
                    <!-- Season color indicator -->
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
                      <!-- Season badge with initials -->
                      <span
                        v-if="item.season"
                        class="w-fit rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                        :style="{ backgroundColor: item.seasonColor + '90' }"
                      >
                        {{ getSeasonInitials(item.season) }}
                      </span>
                    </div>
                  </div>
                  <!-- Cross-month indicator -->
                  <div v-if="item.crossMonth" class="ml-2 flex items-center text-xs text-gray-400">
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

  const today = new Date();
  const currentDate = ref(new Date());
  const zoomLevel = ref(50);
  const timelineContainer = ref<HTMLElement>();

  const allowedStartDate = ref<Date | undefined>(undefined);
  const allowedEndDate = ref<Date | undefined>(undefined);

  // Dynamic project items based on month/year
  const projectItems = ref<ProjectItem[]>([]);
  const timelineError = ref<string | null>(null);

  // For season dropdown
  const studentSeasons = ref<Array<{ label: string; value: string }>>([]);
  const selectedSeasonId = ref<string | undefined>(undefined);

  // Store program_id for later use
  const studentProgramId = ref<string | null>(null);
  const studentCohortId = ref<string | null>(null);
  const cohortSeasonsDeadlines = ref<
    Array<{ id: string; name: string; start_date: string; end_date: string; type: number }>
  >([]);

  // Go to today: show previous, current, and next month
  const goToToday = () => {
    // Clear season filter to show overview
    selectedSeasonId.value = undefined;
    allowedStartDate.value = undefined;
    allowedEndDate.value = undefined;

    currentDate.value = new Date(today.getFullYear(), today.getMonth(), 1);
    loadProjectsForCurrentMonth();
  };

  // When dropdown changes show the timeline for that specific season
  watch(
    () => selectedSeasonId.value,
    async (newVal) => {
      const selectedSeason = cohortSeasonsDeadlines.value.find((season) => season.id === newVal);
      if (!selectedSeason) return;

      const startDate = new Date(selectedSeason.start_date);
      const endDate = new Date(selectedSeason.end_date);

      allowedStartDate.value = startDate;
      allowedEndDate.value = endDate;

      // If today falls within this season, jump to today's month so the
      // student immediately sees where they are -- not always the
      // season's start month, which could be many months in the past.
      const now = new Date();
      const todayInSeason = now >= startDate && now <= endDate;
      const targetDate = todayInSeason ? now : startDate;
      currentDate.value = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);

      console.log("🔍 Season selected:", selectedSeason);
      // Load projects for this season
      await loadProjectsForSeason(selectedSeason.id);

      // Scroll to today (if visible) or the season's start day otherwise
      if (
        currentDate.value.getFullYear() === targetDate.getFullYear() &&
        currentDate.value.getMonth() === targetDate.getMonth()
      ) {
        scrollToDay(targetDate.getDate());
      }
    }
  );

  // scroll to the start of the season when changinn seasons
  const scrollToDay = (day: number) => {
    if (!timelineContainer.value) return;
    // Calculate the horizontal scroll position
    const scrollLeft = (day - 1) * columnWidth.value;
    timelineContainer.value.scrollTo({ left: scrollLeft, behavior: "smooth" });
  };

  // Fetch projects for a given season using program_cohort_season_projects table
  const loadProjectsForSeason = async (seasonId: string) => {
    console.log("🔍 loadProjectsForSeason called with seasonId:", seasonId);

    if (!seasonId) {
      console.warn("❌ No seasonId provided");
      return;
    }

    const programId = studentProgramId.value;
    const cohortId = studentCohortId.value;

    console.log("📋 Student info:", { programId, cohortId, seasonId });

    if (!programId || !cohortId) {
      console.warn("❌ Missing programId or cohortId");
      return;
    }

    const year = currentDate.value.getFullYear();
    const month = currentDate.value.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    console.log("📅 Current month:", { year, month, monthStart, monthEnd });

    // Get season info to check if it's a Final Project season
    const selectedSeason = cohortSeasonsDeadlines.value.find((season) => season.id === seasonId);
    const seasonName = selectedSeason?.name || "Unknown Season";
    const isFinalProjectSeason = seasonName.toLowerCase().includes("final project");

    console.log("🎯 Season info:", { seasonName, isFinalProjectSeason });
    console.log("📋 SeasonId, cohortId, programId:", seasonId, cohortId, programId);
    // First, get the program_cohort_season_id for this season, cohort, and program
    const { data: pcsData, error: pcsError } = await supabase
      .from("program_cohort_seasons")
      .select("id, start_date, end_date")
      .eq("season_id", seasonId)
      .eq("cohort_id", cohortId)
      .eq("program_id", programId)
      .single();

    console.log("🔗 program_cohort_seasons query result:", { pcsData, pcsError });

    // If the student already switched to a different season while this
    // (async) call was still in flight, a slower older request could
    // otherwise resolve AFTER a newer one and silently overwrite it with
    // stale data -- exactly the "doesn't refresh until I switch again"
    // symptom. Bail out here rather than applying outdated results.
    if (selectedSeasonId.value !== seasonId) {
      console.log("⏭️ Stale loadProjectsForSeason call (season changed since), discarding result");
      return;
    }

    if (pcsError || !pcsData) {
      // Don't fail silently into a blank timeline -- this happens when
      // program_cohort_seasons has no row for this exact
      // season/cohort/program combination (a scheduling data gap, not
      // necessarily a code bug), and silently showing nothing made it
      // impossible to tell the difference between "no projects" and
      // "this program's schedule was never configured for this season."
      console.error("❌ Error fetching program_cohort_season:", pcsError);
      timelineError.value =
        `No schedule is configured for "${seasonName}" for your program/cohort yet. ` +
        `An admin needs to set start/end dates for this season under your program in Seasons management.`;
      projectItems.value = [];
      return;
    }

    timelineError.value = null;
    const programCohortSeasonId = pcsData.id;
    const seasonStartDate = new Date(pcsData.start_date);
    const seasonEndDate = new Date(pcsData.end_date);
    console.log("✅ Found program_cohort_season_id:", programCohortSeasonId);

    // Always add a season-boundary marker spanning the season's actual
    // start_date -> end_date, regardless of how long the season runs
    // (some seasons are a few weeks, others span several months) and
    // regardless of whether any individual projects have been scheduled
    // inside it yet. Without this, a season with no projects scheduled
    // showed a completely blank timeline -- no start/end pins at all.
    let seasonMarkerItems: any[] = [];
    if (!(seasonEndDate < monthStart || seasonStartDate > monthEnd)) {
      const startDay = Math.max(1, seasonStartDate > monthStart ? seasonStartDate.getDate() : 1);
      const endDay = Math.min(
        monthEnd.getDate(),
        seasonEndDate < monthEnd ? seasonEndDate.getDate() : monthEnd.getDate()
      );

      seasonMarkerItems = [{
        title: seasonName,
        type: 4,
        startDate: startDay,
        endDate: endDay,
        season: seasonName,
        seasonColor: "var(--color-primary-500)",
        id: `season-marker-${programCohortSeasonId}`,
        crossMonth: seasonEndDate > monthEnd,
      }];
    }

    // If this is a Final Project season, that marker IS the whole
    // timeline for it -- there's nothing else to schedule underneath.
    if (isFinalProjectSeason) {
      console.log("🎓 Final Project season -- using the season marker as the only item");
      projectItems.value = calculateNonOverlappingPositions(seasonMarkerItems);
      console.log("✨ Final Project item created:", projectItems.value);
      return;
    }

    // Now fetch all projects for this program_cohort_season with their actual dates
    const { data: projectSchedules, error: scheduleError } = await supabase
      .from("program_cohort_season_projects")
      .select(`
        id,
        start_date,
        end_date,
        projects!inner (
          id,
          name,
          description
        )
      `)
      .eq("program_cohort_season_id", programCohortSeasonId);

    console.log("🔍 Fetching projects for program_cohort_season_id:", programCohortSeasonId);
    console.log("📦 Project schedules query result:", { projectSchedules, scheduleError });

    if (selectedSeasonId.value !== seasonId) {
      console.log("⏭️ Stale loadProjectsForSeason call (season changed since), discarding result");
      return;
    }

    if (scheduleError) {
      console.error("❌ Error fetching project schedules:", scheduleError);
      return;
    }

    const schedules = (projectSchedules || []) as any[];
    console.log(`📊 Found ${schedules.length} project schedules`);

    if (schedules.length === 0) {
      console.warn("⚠️ No projects found for this season -- showing season marker only");
      projectItems.value = calculateNonOverlappingPositions(seasonMarkerItems);
      return;
    }

    let timelineProjects: any[] = [...seasonMarkerItems];

    // Handle all projects individually with their actual dates
    schedules.forEach((schedule: any) => {
      const start = new Date(schedule.start_date);
      const end = new Date(schedule.end_date);

      console.log(`📌 Processing project: ${schedule.projects.name}`, {
        start: start.toISOString(),
        end: end.toISOString(),
        startDate: start.getDate(),
        endDate: end.getDate(),
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
      });

      // Only show if overlaps with current month
      if (end < monthStart || start > monthEnd) {
        console.log(`⏭️ Skipping (no overlap with current month)`);
        return;
      }

      // Calculate the actual day numbers within the current month
      let startDay: number;
      let endDay: number;

      // If project starts before this month, start at day 1 of this month
      if (start < monthStart) {
        startDay = 1;
      } else {
        // Project starts within this month, use the actual start date
        startDay = start.getDate();
      }

      // If project ends after this month, end at last day of this month
      if (end > monthEnd) {
        endDay = monthEnd.getDate();
      } else {
        // Project ends within this month, use the actual end date
        endDay = end.getDate();
      }

      console.log(`✅ Adding project to timeline: ${schedule.projects.name} (days ${startDay}-${endDay})`);

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

    console.log(`🎯 Total timeline projects to display: ${timelineProjects.length}`);
    projectItems.value = calculateNonOverlappingPositions(timelineProjects);
    console.log("✨ Final projectItems:", projectItems.value);
  };

  interface ProjectItem {
    id: string;
    title: string;
    type: 1 | 2 | 3 | 4;
    startDate: number; // day of month
    endDate: number; // day of month
    avatars: string[];
    crossMonth?: boolean; // Indicates if this project spans multiple months
    season?: string; // Season/curriculum context
    seasonColor?: string; // Visual indicator for season
  }

  // Global project templates that can be updated with real data
  const projectTemplates: Record<
    string,
    Array<{
      title: string;
      type: 1 | 2 | 3 | 4;
      startDate: number;
      endDate: number;
      crossMonth?: boolean;
      season?: string;
      seasonColor?: string;
    }>
  > = {
    // Default fallback data - will be replaced by real data
    "2025-08": [
      {
        title: "Loading...",
        type: 1,
        startDate: 4,
        endDate: 9,
        season: "Loading...",
        seasonColor: "var(--color-primary-500)",
      },
    ],
  };

  // Adds a single season-boundary marker (Start/End pins) into the given
  // month-keyed timelineProjects map, splitting it across however many
  // months the season actually spans -- correctly handles both short
  // (a few weeks, fits in one month) and long (several months) seasons.
  const addSeasonMarkerAcrossMonths = (
    timelineProjects: Record<string, any[]>,
    seasonName: string,
    startDate: Date,
    endDate: Date,
    idPrefix: string
  ) => {
    let currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (currentMonth <= lastMonth) {
      const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;

      if (!timelineProjects[monthKey]) {
        timelineProjects[monthKey] = [];
      }

      const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      const itemStartInMonth = Math.max(startDate.getTime(), monthStart.getTime());
      const itemEndInMonth = Math.min(endDate.getTime(), monthEnd.getTime());

      const startDay = new Date(itemStartInMonth).getDate();
      const endDay = new Date(itemEndInMonth).getDate();
      const crossMonth = endDate > monthEnd;

      timelineProjects[monthKey].push({
        title: seasonName,
        type: 4,
        startDate: startDay,
        endDate: endDay,
        crossMonth: crossMonth,
        season: seasonName,
        seasonColor: "var(--color-primary-500)",
        id: `${idPrefix}-${monthKey}`,
      });

      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }
  };

  // Function to add seasons array to timeline (for overview mode without season filter)
  const addSeasonsToTimeline = async (
    seasons: Array<{ id: any; name: string; start_date: string; end_date: string }>
  ) => {
    console.log("🌟 addSeasonsToTimeline called with", seasons.length, "seasons");
    const timelineProjects: Record<string, any[]> = {};

    // Group seasons by base name (e.g., "Season 03") to consolidate specializations
    const groupedSeasons = groupSeasonsByBaseName(seasons);
    console.log("📚 Grouped seasons:", groupedSeasons);

    for (const seasonGroup of groupedSeasons) {
      const startDate = new Date(seasonGroup.start_date);
      const endDate = new Date(seasonGroup.end_date);
      const isFinalProjectSeason = seasonGroup.baseName.toLowerCase().includes("final project");

      console.log(`🔄 Processing season group: ${seasonGroup.displayName}`, {
        seasonStart: seasonGroup.start_date,
        seasonEnd: seasonGroup.end_date,
        specializations: seasonGroup.specializations,
        ids: seasonGroup.ids,
        isFinalProjectSeason,
      });

      // Always add a season-boundary marker spanning the season's actual
      // start_date -> end_date (across however many months it takes --
      // some seasons run a few weeks, others several months), regardless
      // of whether it has any individual projects scheduled inside it.
      addSeasonMarkerAcrossMonths(
        timelineProjects,
        seasonGroup.baseName,
        startDate,
        endDate,
        `season-${seasonGroup.ids.join("-")}`
      );

      // A Final Project season's marker IS its whole timeline -- there's
      // nothing else to schedule underneath it.
      if (isFinalProjectSeason) {
        console.log(`🎓 Final Project season -- marker only, no individual projects to fetch`);
        continue;
      }

      // For each season, fetch its projects from program_cohort_season_projects
      for (const seasonId of seasonGroup.ids) {
        console.log(`  🔍 Fetching projects for seasonId: ${seasonId}`);

        // Get program_cohort_season_id
        const { data: pcsData, error: pcsError } = await supabase
          .from("program_cohort_seasons")
          .select("id")
          .eq("season_id", seasonId)
          .eq("cohort_id", studentCohortId.value)
          .eq("program_id", studentProgramId.value)
          .maybeSingle();

        console.log(`    🔗 PCS lookup result:`, { pcsData, pcsError });

        if (!pcsData) {
          console.log(`    ⏭️ No program_cohort_season found, skipping`);
          continue;
        }

        console.log(`    ✅ Found program_cohort_season_id: ${pcsData.id}`);

        // Fetch projects for this season
        const { data: projectSchedules, error: projError } = await supabase
          .from("program_cohort_season_projects")
          .select(`
            id,
            start_date,
            end_date,
            projects!inner (
              id,
              name,
              description
            )
          `)
          .eq("program_cohort_season_id", pcsData.id);

        console.log(`    📦 Project schedules result:`, { count: projectSchedules?.length || 0, projError });

        if (!projectSchedules || projectSchedules.length === 0) {
          console.log(`    ⚠️ No projects found for this season`);
          continue;
        }

        // Add each project to the appropriate month(s)
        console.log(`    📝 Processing ${projectSchedules.length} projects`);
        projectSchedules.forEach((schedule: any) => {
          const projStart = new Date(schedule.start_date);
          const projEnd = new Date(schedule.end_date);

          console.log(`      📌 Project: ${schedule.projects.name} (${schedule.start_date} to ${schedule.end_date})`);

          // Create entries for each month this project spans
          let currentMonth = new Date(projStart.getFullYear(), projStart.getMonth(), 1);
          const lastMonth = new Date(projEnd.getFullYear(), projEnd.getMonth(), 1);

          while (currentMonth <= lastMonth) {
            const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;

            if (!timelineProjects[monthKey]) {
              timelineProjects[monthKey] = [];
            }

            const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
            const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

            const itemStartInMonth = Math.max(projStart.getTime(), monthStart.getTime());
            const itemEndInMonth = Math.min(projEnd.getTime(), monthEnd.getTime());

            const startDay = new Date(itemStartInMonth).getDate();
            const endDay = new Date(itemEndInMonth).getDate();
            const crossMonth = projEnd > monthEnd;

            console.log(`        ➕ Adding to month ${monthKey}: days ${startDay}-${endDay}`);

            timelineProjects[monthKey].push({
              title: schedule.projects.name,
              type: 4,
              startDate: startDay,
              endDate: endDay,
              crossMonth: crossMonth,
              season: seasonGroup.baseName,
              seasonColor: "var(--color-primary-500)",
              id: `proj-${schedule.id}-${monthKey}`,
            });

            // Move to next month
            currentMonth.setMonth(currentMonth.getMonth() + 1);
          }
        });
      }
    }

    console.log("✅ Generated timeline projects from actual dates:", timelineProjects);
    console.log(`📊 Total months with projects: ${Object.keys(timelineProjects).length}`);

    // Clear existing templates and update with real data
    Object.keys(projectTemplates).forEach((key) => {
      delete projectTemplates[key];
    });
    Object.assign(projectTemplates, timelineProjects);

    console.log("🔄 Reloading current month view");
    // Reload current month view to show new data
    loadProjectsForCurrentMonth();
  };

  const todayLinePosition = computed(() => {
    const todayDate = new Date();
    const year = currentDate.value.getFullYear();
    const month = currentDate.value.getMonth();
    if (todayDate.getFullYear() === year && todayDate.getMonth() === month) {
      // 0-based index, so subtract 1
      return (todayDate.getDate() - 1) * columnWidth.value;
    }
    return null;
  });

  // Helper function to group seasons by base name and consolidate specializations
  const groupSeasonsByBaseName = (
    seasons: Array<{ id: any; name: string; start_date: string; end_date: string }>
  ) => {
    const seasonGroups: Map<
      string,
      {
        baseName: string;
        displayName: string;
        specializations: string[];
        start_date: string;
        end_date: string;
        ids: any[];
      }
    > = new Map();

    seasons.forEach((season) => {
      // Extract base season name and specialization
      const seasonInfo = extractSeasonInfo(season.name);

      if (seasonGroups.has(seasonInfo.baseName)) {
        // Add specialization to existing group
        const group = seasonGroups.get(seasonInfo.baseName)!;
        if (
          seasonInfo.specialization &&
          !group.specializations.includes(seasonInfo.specialization)
        ) {
          group.specializations.push(seasonInfo.specialization);
        }
        group.ids.push(season.id);

        // Update date range if necessary
        if (new Date(season.start_date) < new Date(group.start_date)) {
          group.start_date = season.start_date;
        }
        if (new Date(season.end_date) > new Date(group.end_date)) {
          group.end_date = season.end_date;
        }
      } else {
        // Create new group
        seasonGroups.set(seasonInfo.baseName, {
          baseName: seasonInfo.baseName,
          displayName: seasonInfo.baseName,
          specializations: seasonInfo.specialization ? [seasonInfo.specialization] : [],
          start_date: season.start_date,
          end_date: season.end_date,
          ids: [season.id],
        });
      }
    });

    // Create final display names with specializations
    return Array.from(seasonGroups.values()).map((group) => ({
      ...group,
      displayName:
        group.specializations.length > 0
          ? `${group.baseName} (${group.specializations.join(", ")})`
          : group.baseName,
    }));
  };

  // Helper function to extract season base name and specialization
  const extractSeasonInfo = (seasonName: string) => {
    // Pattern matching for different season formats. These must match
    // the actual specialization suffixes used in your season names
    // (confirmed against real data, not guessed) -- e.g. the scraper
    // logs show "Season 03 Software Engineer Cpp" AND
    // "Season 03 Software Engineer Golang" as two distinct real season
    // rows within the same program.
    const patterns = [
      // "Season 03 Software Engineer Cpp/Golang/Rust" -> base: "Season 03 Software Engineer"
      {
        regex: /^(Season \d+ Software Engineer)\s+(Cpp|Golang|Go|Rust)$/i,
        baseGroup: 1,
        specializationGroup: 2,
      },
      // "Season 03 Machine Learning Python/R/TensorFlow" -> base: "Season 03 Machine Learning"
      {
        regex: /^(Season \d+ Machine Learning)\s+(Python|R|TensorFlow)$/i,
        baseGroup: 1,
        specializationGroup: 2,
      },
      // "Season 02 Data Science Advanced/Basic/Intermediate" -> base: "Season 02 Data Science"
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
          baseName: match[pattern.baseGroup],
          specialization: match[pattern.specializationGroup],
        };
      }
    }

    // If no specialization pattern matches, return the full name as base
    return {
      baseName: seasonName,
      specialization: null,
    };
  };


  // Function to generate projects for a given month/year
  const generateProjectsForMonth = (year: number, month: number) => {
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    return projectTemplates[monthKey] || [];
  };

  // Function to load projects for current view
  const loadProjectsForCurrentMonth = () => {
    const year = currentDate.value.getFullYear();
    const month = currentDate.value.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

    console.log(`📆 loadProjectsForCurrentMonth: ${monthKey}`);

    const projects = generateProjectsForMonth(year, month);
    console.log(`📋 Generated projects for ${monthKey}:`, projects);

    const processedProjects = calculateNonOverlappingPositions(projects);
    console.log(`🎨 Processed projects (with positions):`, processedProjects);

    projectItems.value = processedProjects.map((project: any, index: number) => ({
      ...project,
      id: `${year}-${month}-${index}`,
      avatars: ["/avatar1.jpg", "/avatar2.jpg"], // Default avatars
    }));

    console.log(`✨ Final projectItems.value (${projectItems.value.length} items):`, projectItems.value);
  };

  // Function to calculate non-overlapping positions for timeline items
  const calculateNonOverlappingPositions = (projects: any[]) => {
    if (!projects.length) return projects;

    // Sort projects by start date to process them in order
    const sortedProjects = [...projects].sort((a, b) => a.startDate - b.startDate);

    // Track occupied rows and their end positions
    const occupiedRows: Array<{ endDate: number; row: number }> = [];

    return sortedProjects.map((project) => {
      // Find the first available row for this project
      let assignedRow = 0;

      // Check each existing row to see if this project would overlap
      for (let i = 0; i < occupiedRows.length; i++) {
        const existingRow = occupiedRows[i];

        // If this project starts after the existing row ends (with 1 day buffer), we can use this row
        if (project.startDate > existingRow.endDate + 1) {
          assignedRow = existingRow.row;
          // Update this row's end date
          existingRow.endDate = project.endDate;
          break;
        }
      }

      // If no existing row was available, create a new row
      if (
        assignedRow === 0 ||
        !occupiedRows.find((row) => row.row === assignedRow && row.endDate < project.startDate - 1)
      ) {
        assignedRow = occupiedRows.length;
        occupiedRows.push({
          endDate: project.endDate,
          row: assignedRow,
        });
      }

      return {
        ...project,
        calculatedRow: assignedRow, // Add calculated row for positioning
      };
    });
  };

  // Computed properties
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
    if (!projectItems.value.length) return 364; // Default height

    // Find the maximum row used
    const maxRow = Math.max(
      ...projectItems.value.map((item) => (item as any).calculatedRow || 0),
      0
    );

    const baseRowHeight = 64;
    const startOffset = 16;
    const bottomPadding = 20;

    return startOffset + (maxRow + 1) * baseRowHeight + bottomPadding;
  });

  // Methods
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
    return date.toLocaleDateString("en-US", { weekday: "narrow" });
  };

  const isToday = (day: number) => {
    const today = new Date();
    const year = currentDate.value.getFullYear();
    const month = currentDate.value.getMonth();

    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
  };

  const isWeekend = (day: number) => {
    const year = currentDate.value.getFullYear();
    const month = currentDate.value.getMonth();
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
  };

  const getItemStyle = (item: ProjectItem) => {
    const startPosition = (item.startDate - 1) * columnWidth.value;
    const duration = item.endDate - item.startDate + 1;
    const itemWidth = duration * columnWidth.value;

    // Use calculated row for vertical positioning, with fallback to type-based positioning
    const baseRowHeight = 64; // Height of each row (56px item + 8px gap)
    const startOffset = 16; // Starting offset from top

    const calculatedRow = (item as any).calculatedRow;
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

  // Fallback function for type-based positioning (when calculated row is not available)
  const getTypeBasedPosition = (type: number) => {
    const positions: Record<number, number> = {
      1: 16, // Season 01 / Early projects
      2: 80, // Season 02 / Intermediate projects
      3: 144, // Season 03 / Advanced projects
      4: 208, // Specialized seasons (ML, Data Science, etc.)
    };
    return positions[type] || 16;
  };

  const getItemClasses = (type: number) => {
    const classes: Record<number, string> = {
      1: "h-8 w-1.5 bg-blue-600 rounded-md",
      2: "h-8 w-1.5 bg-green-600 rounded-md",
      3: "h-8 w-1.5 bg-yellow-600 rounded-md",
      4: "h-8 w-1.5 bg-red-600 rounded-md",
    };
    return classes[type] || "h-8 w-1.5 bg-gray-600 rounded-md";
  };

  // Convert season name to initials
  const getSeasonInitials = (seasonName: string) => {
    if (!seasonName) return "";

    // Handle different season patterns
    const patterns = [
      // Season 01 Arc 01 -> S1A1
      {
        regex: /Season (\d+) Arc (\d+)/i,
        format: (match: RegExpMatchArray) => `S${match[1]}A${match[2]}`,
      },
      // Season 02 Software Engineer -> S2
      {
        regex: /Season (\d+) Software Engineer/i,
        format: (match: RegExpMatchArray) => `S${match[1]}`,
      },
      // Season 03 Software Engineer Cpp -> S3C++
      {
        regex: /Season (\d+) Software Engineer Cpp/i,
        format: (match: RegExpMatchArray) => `S${match[1]}C++`,
      },
      // Season 03 Software Engineer Rust -> S3R
      {
        regex: /Season (\d+) Software Engineer Rust/i,
        format: (match: RegExpMatchArray) => `S${match[1]}R`,
      },
      // Season 03 Software Engineer Go -> S3Go
      {
        regex: /Season (\d+) Software Engineer Go/i,
        format: (match: RegExpMatchArray) => `S${match[1]}Go`,
      },
      // Season 03 Machine Learning -> S3ML
      {
        regex: /Season (\d+) Machine Learning/i,
        format: (match: RegExpMatchArray) => `S${match[1]}ML`,
      },
      // Season 02 Data Science -> S2DS
      {
        regex: /Season (\d+) Data Science/i,
        format: (match: RegExpMatchArray) => `S${match[1]}DS`,
      },
      // Generic Season XX -> SXX
      { regex: /Season (\d+)/i, format: (match: RegExpMatchArray) => `S${match[1]}` },
      // Preseason Data -> PD
      { regex: /Preseason Data/i, format: () => "PD" },
      // Preseason Web -> PW
      { regex: /Preseason Web/i, format: () => "PW" },
    ];

    for (const pattern of patterns) {
      const match = seasonName.match(pattern.regex);
      if (match) {
        return pattern.format(match);
      }
    }

    // Fallback: take first letter of each word
    return seasonName
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase())
      .join("")
      .slice(0, 4); // Limit to 4 characters
  };

  const previousMonth = () => {
    const newDate = new Date(currentDate.value);
    newDate.setMonth(newDate.getMonth() - 1);
    // Restrict to allowedStartDate
    if (
      allowedStartDate.value &&
      (newDate.getFullYear() < allowedStartDate.value.getFullYear() ||
        (newDate.getFullYear() === allowedStartDate.value.getFullYear() &&
          newDate.getMonth() < allowedStartDate.value.getMonth()))
    ) {
      return;
    }
    currentDate.value = newDate;
    const lastday = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
    scrollToDay(lastday);
    if (selectedSeasonId.value) {
      loadProjectsForSeason(selectedSeasonId.value);
    } else {
      loadProjectsForCurrentMonth();
    }
  };

  const nextMonth = () => {
    const newDate = new Date(currentDate.value);
    newDate.setMonth(newDate.getMonth() + 1);
    // Restrict to allowedEndDate
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

  const supabase = useSupabaseClient();

  const loadSeasonDeadlines = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // First, get the student's cohort ID
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("cohort_id, program_id, current_season_id")
      .eq("email", session?.user?.email ?? "")
      .single<{ cohort_id: string; program_id: string; current_season_id: string | null }>();

    if (student) {
      studentProgramId.value = student.program_id;
      studentCohortId.value = student.cohort_id;
    }
    
    // Now, use the cohort ID to query program_cohort_seasons
    const { data: seasonsProgress, error: progressError } = await supabase
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
      `
      )
      .eq("cohort_id", (student as any)?.cohort_id)
      .eq("program_id", (student as any)?.program_id)
      .order("start_date", { ascending: true, nullsFirst: false }); // Filter by the cohort ID you just fetched

    studentSeasons .value = seasonsProgress
      ? seasonsProgress.map((season) => ({
          label: season.seasons.name,
          value: String(season.seasons.id),
        }))
      : [];

    console.log("Fetched seasons progress:", { seasonsProgress, progressError });
    const seasons = seasonsProgress?.map((season: any) => ({
      id: season.seasons.id,
      name: season.seasons.name,
      start_date: season.start_date,
      end_date: season.end_date,
      type: 2,
    }));

    cohortSeasonsDeadlines.value = seasons || [];
    console.log("Cohort season deadlines:", cohortSeasonsDeadlines.value);

    // Process seasons and add to timeline using actual project dates
    if (seasons) {
      await addSeasonsToTimeline(seasons);
    }

    // Default to the student's current season, so clicking into Timeline
    // immediately shows "where am I relative to this season" instead of
    // an unfiltered overview the student has to manually narrow down.
    if (student?.current_season_id && !selectedSeasonId.value) {
      const currentSeasonMatch = cohortSeasonsDeadlines.value.find(
        (s) => String(s.id) === String(student.current_season_id)
      );
      if (currentSeasonMatch) {
        selectedSeasonId.value = String(student.current_season_id);
      }
    }
  };

  // Keyboard navigation
  onMounted(() => {
    // Load projects for the initial month
    loadProjectsForCurrentMonth();
    loadSeasonDeadlines();

    const handleKeydown = (event: KeyboardEvent) => {
      if (!timelineContainer.value) return;

      const scrollAmount = columnWidth.value * 2;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        timelineContainer.value.scrollBy({ left: -scrollAmount, behavior: "smooth" });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        timelineContainer.value.scrollBy({ left: scrollAmount, behavior: "smooth" });
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
