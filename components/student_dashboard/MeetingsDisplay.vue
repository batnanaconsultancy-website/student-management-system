<script setup>
  import { ref } from "vue";
  import { CACHE_KEYS } from '~/composables/useCacheInvalidation';

  const props = defineProps({
    googleAccessToken: { type: String, default: null },
  });

  const nuxtApp = useNuxtApp();
  const meetingsScroll = ref(null);

  // Use cached fetch for calendar events. Always fetch — admin-pinned
  // meetings should show even for students without Google Calendar connected.
  const { data: calendarData } = useFetch('/api/student/calendar-events', {
    key: CACHE_KEYS.STUDENT_CALENDAR_TODAY,
    query: { period: 'today' },
    headers: computed(() => ({
      'x-google-token': props.googleAccessToken || ''
    })),
    getCachedData(key) {
      return nuxtApp.payload.data[key] || nuxtApp.static.data[key]
    }
  });

  const calendarEvents = computed(() => calendarData.value?.data || []);

  function scrollMeetings(direction) {
    const el = meetingsScroll.value;
    if (!el) return;
    const scrollAmount = 340 + 16; // card width + gap
    if (direction === "left") {
      el.scrollBy({ left: -scrollAmount, behavior: "smooth" });
    } else {
      el.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  }

  function formatEventTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const openLocation = (url) => {
    if (url) {
      window.open(url, "_blank", "noopener");
    } else {
      console.warn("No location provided for this event");
    }
  };
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 class="flex items-center gap-2 font-semibold text-highlighted text-base 2xl:text-xl">
        Today's meetings
      </h2>

      <div class="flex gap-4" v-if="calendarEvents.length >= 2">
        <button
          @click="scrollMeetings('left')"
          class="bg-primary-200 dark:bg-primary-100 hover:bg-primary-200/50 border-primary-300 ml-2 cursor-pointer rounded-full border-1 p-1 transition-all duration-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path stroke="var(--color-primary-400) " stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          @click="scrollMeetings('right')"
          class="bg-primary-200 dark:bg-primary-100 hover:bg-primary-200/50 border-primary-300 ml-1 cursor-pointer rounded-full border-1 p-1 transition-all duration-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path stroke="var(--color-primary-400)" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>

    <div
      v-if="calendarEvents.length > 0"
      :class="[calendarEvents.length === 1 ? 'w-full px-2' : 'flex w-full px-0']"
      ref="meetingsScroll"
      class="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth"
      style="scrollbar-width: none"
    >
      <template v-for="(events, idx) in calendarEvents" :key="events.id">
        <UCard
          :class="[
            'event_card mt-2 mr-2 mb-3 flex-shrink-0',
            calendarEvents.length === 1 ? 'w-full' : 'max-w-[340px min-w-[320px] flex-1',
          ]"
          variant="outline"
          :ui="{
            root: events.pinned
              ? 'w-full border-l-5 border-amber-500 dark:border-amber-400'
              : 'w-full border-l-5 border-primary dark:border-primary-200',
            body: 'xl:!px-6 px-6 xl:!py-4 2xl:!py-4 h-full flex',
          }"
        >
          <template #default>
            <div class="flex w-full flex-1 flex-col justify-between gap-2">
              <div class="flex flex-col gap-2">
                <h1 class="text-primary-950 font-medium xl:text-base 2xl:text-base flex items-center gap-1.5">
                  <UIcon v-if="events.pinned" name="i-lucide-pin" class="size-3.5 text-amber-600 shrink-0" />
                  {{ events.summary }}
                </h1>
                <p class="text-primary-950 xl:text-sm 2xl:text-sm">
                  {{
                    formatEventTime(events.start?.dateTime || events.originalStartTime?.dateTime)
                  }}
                  <span v-if="events.end?.dateTime || events.originalEndTime?.dateTime">
                    &ndash;
                    {{ formatEventTime(events.end?.dateTime || events.originalEndTime?.dateTime) }}
                    CEST
                  </span>
                </p>
              </div>
              <div class="mt-6 flex items-center justify-between">
                <UAvatarGroup :max="3">
                  <UAvatar
                    v-for="people in events.attendees"
                    :key="people.id"
                    :alt="
                      people.email
                        ? people.email.charAt(0).toUpperCase()
                        : people.name
                          ? people.name.charAt(0).toUpperCase()
                          : ''
                    "
                  />
                </UAvatarGroup>
                <UButton class="cursor-pointer" @click="openLocation(events.location)">
                  Attend
                </UButton>
              </div>
            </div>
          </template>
        </UCard>
      </template>
    </div>

    <UCard
      v-else
      variant="outline"
      class="flex w-full items-center justify-center"
      :ui="{
        body: 'w-full 2xl:!py-4 !py-3 flex flex-col items-center justify-center gap-4',
      }"
    >
      <div class="flex flex-col items-center justify-center text-center text-gray-500">
        <div
          class="bg-primary-200 dark:bg-primary-100 border-primary-300 mb-4 flex items-center justify-center rounded-full border-1 p-2 xl:p-3"
        >
          <UIcon name="i-lucide-lab:mailbox-flag"  class="text-primary-800 size-6 xl:size-8" />
        </div>
        <p class="text-sm xl:text-lg font-semibold text-highlighted">No events today</p>
        <p class="mt-1 xl:text-base text-xs">Perfect time to focus on your projects</p>
        <UButton
          variant="outline"
          color="neutral"
          class="mt-4"
          @click="$router.push('/students/calendar')"
        >
          View Calendar
        </UButton>
      </div>
    </UCard>
  </div>
</template>
