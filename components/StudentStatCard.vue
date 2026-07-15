<script setup>
import { resolveComponent } from "vue";

const UBadge = resolveComponent("UBadge");

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  count: {
    type: Number,
    default: null,
  },
  icon: {
    type: String,
    required: true,
  },
  iconColor: {
    type: String,
    required: true,
  },
  change: {
    type: Number,
    default: undefined,
  },
  percentChange: {
    type: Number,
    default: null,
  },
  roundedClass: {
    type: String,
    default: "rounded-lg xl:rounded-none",
  },
  // For cards where increase is bad (like "Behind")
  invertColors: {
    type: Boolean,
    default: false,
  },
});

const isLoading = computed(() => props.count === null || props.count === undefined);

const getBadgeColor = (change, invertColors) => {
  if (change === 0) return "neutral";
  if (invertColors) {
    return change > 0 ? "error" : "success";
  }
  return change > 0 ? "success" : "error";
};

const getIconColor = (iconColor) => {
  const colorMap = {
    info: 'text-blue-500',
    success: 'text-green-500',
    error: 'text-red-500',
    warning: 'text-yellow-500',
  };
  return colorMap[iconColor] || 'text-purple-500';
};

const getIconColorClass = (iconColor) => {
  const colorMap = {
    info: 'bg-info/10 ring-info/25 text-blue-500',
    success: 'bg-success/10 ring-success/25 text-green-500',
    error: 'bg-error/10 ring-error/25 text-red-500',
    warning: 'bg-warning/10 ring-warning/25 text-yellow-500',
  };
  return colorMap[iconColor] || 'bg-primary/10 ring-primary/25 text-purple-500';
};
</script>

<template>
  <UPageCard
    :icon="icon"
    :title="title"
    variant="subtle"
    :ui="{
      container: 'gap-y-1.5',
      wrapper: 'items-start',
      leadingIcon: `${getIconColor(iconColor)} `,
      leading: `p-2.5 rounded-full ${getIconColorClass(iconColor)} ring ring-inset flex-col`,
      title: 'font-medium text-muted text-xs uppercase'
    }"
    :class="`${roundedClass} hover:z-1 hover:bg-elevated`"
  >
    <div class="flex items-center gap-2">
      <template v-if="isLoading">
        <USkeleton class="h-8 w-16" />
        <USkeleton v-if="change !== undefined" class="h-5 w-12" />
      </template>
      <template v-else>
        <span class="text-2xl font-semibold text-highlighted">
          {{ count }}
        </span>

        <UBadge
          v-if="change !== undefined"
          :color="getBadgeColor(change, invertColors)"
          variant="subtle"
          class="text-xs mt-1"
        >
          <span v-if="change === 0" class="text-muted">
            0%
          </span>
          <span v-else>
            {{ change > 0 ? '+' : '' }}{{ change }}
            <span v-if="percentChange !== null">
              ({{ Math.abs(percentChange).toFixed(1) }}%)
            </span>
            <span v-else> (new)</span>
          </span>
        </UBadge>
      </template>
    </div>
  </UPageCard>
</template>
