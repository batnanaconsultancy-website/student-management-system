<script setup>
import { CACHE_KEYS } from '~/composables/useCacheInvalidation';

definePageMeta({
    layout: "custom",
    middleware: ["auth", "student-only"],
});

const supabase = useSupabaseClient();
const nuxtApp = useNuxtApp();
const runtimeConfig = useRuntimeConfig();

// Google Calendar integration
const googleAccessToken = ref(null);

// Current date tracking
const currentDate = ref(new Date());
const selectedDay = ref(new Date());

// Computed properties
const currentMonth = computed(() => currentDate.value.getMonth());
const currentYear = computed(() => currentDate.value.getFullYear());

const selectedDayFormatted = computed(() => {
    return selectedDay.value.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
});

const monthName = computed(() => {
    return currentDate.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
});

// Day names (starting with Monday)
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Get first day of the month (0 = Monday, 6 = Sunday)
const firstDayOfMonth = computed(() => {
    const day = new Date(currentYear.value, currentMonth.value, 1).getDay();
    // Convert from Sunday=0 to Monday=0 format
    return (day + 6) % 7;
});

// Get number of days in current month
const daysInMonth = computed(() => {
    return new Date(currentYear.value, currentMonth.value + 1, 0).getDate();
});

// Get number of days in previous month
const daysInPreviousMonth = computed(() => {
    return new Date(currentYear.value, currentMonth.value, 0).getDate();
});

// Generate calendar days array
const calendarDays = computed(() => {
    const days = [];

    // Add previous month's trailing days
    const prevMonthDays = firstDayOfMonth.value;
    for (let i = prevMonthDays - 1; i >= 0; i--) {
        days.push({
            day: daysInPreviousMonth.value - i,
            isCurrentMonth: false,
            isPrevMonth: true,
            isNextMonth: false,
            date: new Date(currentYear.value, currentMonth.value - 1, daysInPreviousMonth.value - i)
        });
    }

    // Add current month's days
    for (let i = 1; i <= daysInMonth.value; i++) {
        days.push({
            day: i,
            isCurrentMonth: true,
            isPrevMonth: false,
            isNextMonth: false,
            date: new Date(currentYear.value, currentMonth.value, i)
        });
    }

    // Add next month's leading days to complete the grid
    const remainingDays = 42 - days.length; // 6 rows * 7 days = 42
    for (let i = 1; i <= remainingDays; i++) {
        days.push({
            day: i,
            isCurrentMonth: false,
            isPrevMonth: false,
            isNextMonth: true,
            date: new Date(currentYear.value, currentMonth.value + 1, i)
        });
    }

    return days;
});

// Check if a date is today
const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
};

// Check if a date is a weekend
const isWeekend = (date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
};

// Navigation functions
const previousMonth = () => {
    currentDate.value = new Date(currentYear.value, currentMonth.value - 1, 1);
};

const nextMonth = () => {
    currentDate.value = new Date(currentYear.value, currentMonth.value + 1, 1);
};

const goToToday = () => {
    currentDate.value = new Date();
    selectedDay.value = new Date();
};

// Day view navigation (for mobile)
const previousDay = () => {
    const newDay = new Date(selectedDay.value);
    newDay.setDate(newDay.getDate() - 1);
    selectedDay.value = newDay;
};

const nextDay = () => {
    const newDay = new Date(selectedDay.value);
    newDay.setDate(newDay.getDate() + 1);
    selectedDay.value = newDay;
};

// Dynamic cache key based on month/year
const calendarCacheKey = computed(() =>
    `${CACHE_KEYS.STUDENT_CALENDAR_MONTH}-${currentYear.value}-${currentMonth.value}`
);

// Use cached fetch for calendar events
const { data: calendarData, refresh: refreshCalendar } = useFetch('/api/student/calendar-events', {
    key: calendarCacheKey.value,
    query: { period: 'month', month: currentMonth.value, year: currentYear.value },
    headers: computed(() => ({
        'x-google-token': googleAccessToken.value || ''
    })),
    getCachedData(key) {
        return nuxtApp.payload.data[key] || nuxtApp.static.data[key]
    },
    immediate: false // We'll trigger manually after we have the token
});

const calendarEvents = computed(() => calendarData.value?.data || []);

// Refresh Google token when expired
async function refreshGoogleToken() {
    const storedRefreshToken = window.localStorage.getItem("oauth_provider_refresh_token");

    if (!storedRefreshToken) {
        console.error("No refresh token available");
        return null;
    }

    try {
        const response = await fetch("https://www.googleapis.com/oauth2/v3/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: runtimeConfig.public.googleClientId,
                client_secret: runtimeConfig.public.googleClientSecret,
                refresh_token: storedRefreshToken,
                grant_type: "refresh_token",
            }),
        });

        if (!response.ok) {
            throw new Error("Failed to refresh token");
        }

        const dataGoogle = await response.json();
        googleAccessToken.value = dataGoogle.access_token;
        console.log("New access token: ", googleAccessToken.value);
        return dataGoogle.access_token;
    } catch (error) {
        console.error("Error refreshing token:", error);
        return null;
    }
}

// Get events for a specific date
const getEventsForDate = (date) => {
    const events = calendarEvents.value.filter(event => {
        if (!event.start) return false;

        const eventStart = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date);
        const isSameDate = eventStart.toDateString() === date.toDateString();

        return isSameDate;
    });

    return events;
};

// Initialize and fetch calendar data
// Always fetch, even without a Google token — admin-pinned meetings
// should still show up for students who haven't connected Google Calendar.
onMounted(async () => {
    const {
        data: { session },
    } = await supabase.auth.getSession();

    googleAccessToken.value = session?.provider_token || null;

    await refreshCalendar();
});

// Watch for token changes and re-fetch events
watch(
    googleAccessToken,
    async (newToken) => {
      if (!newToken) {
        try {
          await refreshGoogleToken();
        } catch (error) {
          console.error("Failed to refresh Google token", error);
        } finally {
          await refreshCalendar();
        }
      }
    },
    { immediate: true }
);

// Re-fetch events when month changes (invalidate cache for new month)
watch([currentMonth, currentYear], async () => {
    // Clear cache for the new month key and refresh
    const newKey = `${CACHE_KEYS.STUDENT_CALENDAR_MONTH}-${currentYear.value}-${currentMonth.value}`;
    delete nuxtApp.payload.data[newKey];
    await refreshCalendar();
});
</script>

<template>
  <UDashboardPanel id="calendarNuxtUI">
      <template #header>
          <UDashboardNavbar title="Calendar" >
              <template #leading>
                  <UDashboardSidebarCollapse />
              </template>
          </UDashboardNavbar>
      </template>

      <template #body>
          <div class="overflow-y-auto h-full pb-4">
          <!-- Month View Navigation (hidden on small screens) -->
          <div class="hidden lg:flex items-center justify-center mx-6 relative my-4">
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
            <h2 class="text-2xl font-semibold">{{ monthName }}</h2>
          </div>

          <!-- Day View Navigation (visible on small screens) -->
          <div class="lg:hidden flex items-center justify-center mx-6 relative my-4 mb-10">
            <UFieldGroup size="xl" class="absolute left-0">
                <UButton
                @click="previousDay"
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
                @click="nextDay"
                color="neutral"
                variant="outline"
                icon="i-lucide:chevron-right"
                class="text-muted"
              />
            </UFieldGroup>
            <h2 class="text-lg font-semibold text-center">{{ selectedDayFormatted }}</h2>
          </div>

          <!-- Month View Calendar Grid (hidden on small screens) -->
          <UCard
            class="ring-0 hidden lg:block mx-6"
            :ui="{
                header: 'grid grid-cols-7 !gap-0 !pb-0 !px-0',
                body: ' !pt-0 !p-0 border border-muted/20'
            }"
          >
            <!-- Day Names Header -->
             <template #header>
                  <div
                    v-for="dayName in dayNames"
                    :key="dayName"
                    class="text-center text-sm text-muted py-2 bg-muted border border-muted font-medium first:rounded-tl-md last:rounded-tr-md not-first:border-l-0 border-b-0"
                  >
                    {{ dayName }}
                  </div>
             </template>

            <!-- Calendar Days Grid -->
            <div class="grid grid-cols-7 gap-0">
              <UCard
                v-for="(dayInfo, index) in calendarDays"
                :key="index"
                :class="[
                  'rounded-none relative overflow-hidden',
                  {
                    '': isToday(dayInfo.date),
                    'bg-muted border border-muted/20': !dayInfo.isCurrentMonth,
                  }
                ]"
                :ui="{
                  body: '!p-2 flex flex-col items-center justify-start gap-2 min-h-[115px]'
                }"
              >
                <!-- Weekend diagonal stripes background -->
                <svg
                  v-if="isWeekend(dayInfo.date) && dayInfo.isCurrentMonth"
                  class="absolute inset-0 w-full h-full pointer-events-none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                    <pattern
                      id="doodad"
                      width="16"
                      height="16"
                      viewBox="0 0 40 40"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(135)"
                    >
                      <rect width="100%" height="100%" class="fill-gray-50 dark:fill-[#18181b]" />
                      <path d="M-10 30h60v1h-60zM-10-10h60v1h-60" class="fill-gray-200 dark:fill-gray-600" />
                      <path d="M-10 10h60v1h-60zM-10-30h60v1h-60z" class="fill-gray-200 dark:fill-gray-600" />
                    </pattern>
                  </defs>
                  <rect fill="url(#doodad)" height="100%" width="100%" />
                </svg>

                <span
                  :class="[
                    'text-sm mr-auto w-6 h-6 flex justify-center items-center rounded-full z-10 relative',
                    {
                      'text-primary-600 font-bold bg-primary-100': isToday(dayInfo.date),
                      'text-gray-400': !dayInfo.isCurrentMonth,
                      'text-muted': dayInfo.isCurrentMonth && !isToday(dayInfo.date),
                    }
                  ]"
                >
                  {{ dayInfo.day }}
                </span>

                <!-- Calendar Events for this day -->
                <div v-if="dayInfo.isCurrentMonth" class="w-full space-y-1 z-10 relative">
                  <a
                    v-for="event in getEventsForDate(dayInfo.date)"
                    :key="event.id"
                    :href="event.location || event.hangoutLink || '#'"
                    target="_blank"
                    rel="noopener noreferrer"
                    :class="[
                      'text-xs px-1.5 py-0.5 rounded border-l truncate flex items-center gap-1 transition-colors cursor-pointer',
                      event.pinned
                        ? 'bg-amber-100 text-amber-800 border-amber-500 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-primary-100 text-primary-700 border-primary-600 hover:bg-primary-200'
                    ]"
                    :title="(event.pinned ? '📌 ' : '') + event.summary + (event.location ? '\n' + event.location : '')"
                  >
                    <UIcon v-if="event.pinned" name="i-lucide-pin" class="size-3 shrink-0" />
                    <span class="truncate">{{ event.summary }}</span>
                  </a>
                </div>
              </UCard>
            </div>
          </UCard>

          <!-- Day View (visible on small screens) -->
          <UCard class="lg:hidden mx-6">
            <template #header>
              <div class="flex items-center gap-3">
                <div
                  :class="[
                    'w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg',
                    {
                      'bg-primary-100 text-primary-600': isToday(selectedDay),
                      'bg-muted text-muted': !isToday(selectedDay)
                    }
                  ]"
                >
                  {{ selectedDay.getDate() }}
                </div>
                <div>
                  <h3 class="font-semibold">
                    {{ selectedDay.toLocaleDateString('en-US', { weekday: 'long' }) }}
                  </h3>
                  <p class="text-sm text-muted">
                    {{ selectedDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }}
                  </p>
                </div>
              </div>
            </template>

            <div class="space-y-4">
              <div v-if="getEventsForDate(selectedDay).length === 0" class="text-center py-8 text-muted">
                <Icon name="i-lucide:calendar-x" class="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No events scheduled for this day</p>
              </div>

              <UCard
                v-for="event in getEventsForDate(selectedDay)"
                :key="event.id"
                :class="event.pinned ? 'border-l-4 border-amber-500' : 'border-l-4 border-primary-600'"
              >
                <div class="space-y-2">
                  <h4 class="font-semibold flex items-center gap-1.5">
                    <UIcon v-if="event.pinned" name="i-lucide-pin" class="size-3.5 text-amber-600" />
                    {{ event.summary }}
                  </h4>

                  <div v-if="event.start?.dateTime" class="flex items-center gap-2 text-sm text-muted">
                    <Icon name="i-lucide:clock" class="w-4 h-4" />
                    <span>
                      {{ new Date(event.start.dateTime).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit'
                      }) }}
                      <span v-if="event.end?.dateTime">
                        - {{ new Date(event.end.dateTime).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit'
                        }) }}
                      </span>
                    </span>
                  </div>

                  <div v-if="event.description" class="text-sm text-muted">
                    {{ event.description }}
                  </div>

                  <div v-if="event.location || event.hangoutLink" class="flex gap-2 mt-3">
                    <UButton
                      v-if="event.location"
                      :href="event.location"
                      target="_blank"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide:map-pin"
                    >
                      Location
                    </UButton>
                    <UButton
                      v-if="event.hangoutLink"
                      :href="event.hangoutLink"
                      target="_blank"
                      size="xs"
                      color="primary"
                      icon="i-lucide:video"
                    >
                      Join Meeting
                    </UButton>
                  </div>
                </div>
              </UCard>
            </div>
          </UCard>
          </div>
      </template>
  </UDashboardPanel>
</template>