<script setup lang="ts">
import { resolveComponent, computed, h, ref } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const props = defineProps({
  seasonProgress: {
    type: Array as PropType<any[]>,
    required: true,
    default: () => []
  }
})

interface SeasonProgress {
  id: string
  name: string
  avatar?: {
    src?: string
    alt?: string
  }
  start_date: string
  end_date: string
  order_in_program: number
  progress_percentage: number
  is_completed: boolean
  status: 'On Going' | 'Completed' | 'Not Started'
  variants?: SeasonProgress[]  // For seasons with multiple variants
  hasVariants?: boolean  // Flag to indicate this row has variants
}

const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

// Extract base season name (e.g., "Season 03 Software Engineer" from "Season 03 Software Engineer Cpp")
function getBaseName(name: string): string {
  // Match pattern like "Season 03 Software Engineer" before the variant
  const match = name.match(/^(Season\s+\d+\s+Software Engineer)/)
  return match ? match[1] : name
}

// Extract variant name (e.g., "Cpp" from "Season 03 Software Engineer Cpp")
function getVariant(name: string): string {
  const baseName = getBaseName(name)
  return name.replace(baseName, '').trim()
}

// Normalize incoming prop data
const normalizedData = computed<SeasonProgress[]>(() =>
  (props.seasonProgress || []).map((item: any) => {
    // incoming shapes vary; prefer nested objects when available
    const season = item.seasons || {}
    const pcs = item.program_cohort_seasons || {}

    const name = season.name ?? item.name ?? ''
    const id = item.season_id ?? season.id ?? item.id ?? ''
    const order_in_program = season.order_in_program ?? item.order_in_program ?? 0
    const start_date = pcs.start_date ?? item.start_date ?? ''
    const end_date = pcs.end_date ?? item.end_date ?? ''
    const progress_percentage = Number(item.progress_percentage ?? 0)
    const is_completed = Boolean(item.is_completed)

    const status: SeasonProgress['status'] = progress_percentage >= 75
      ? 'Completed'
      : progress_percentage > 0
      ? 'On Going'
      : 'Not Started'

    // avatar is optional — keep undefined if not provided
    const avatar = item.avatar ?? undefined

    return {
      id,
      name,
      avatar,
      start_date,
      end_date,
      order_in_program,
      progress_percentage,
      is_completed,
      status
    }
  })
)

// Group seasons by base name and create expandable rows
const data = computed<SeasonProgress[]>(() => {
  const grouped = new Map<string, SeasonProgress[]>()

  // Group seasons by base name only (not by order_in_program)
  for (const season of normalizedData.value) {
    const baseName = getBaseName(season.name)
    const variant = getVariant(season.name)

    if (variant) {
      // This season has a variant, add to group by base name only
      if (!grouped.has(baseName)) {
        grouped.set(baseName, [])
      }
      grouped.get(baseName)!.push(season)
    }
  }

  // Build the final data array
  const result: SeasonProgress[] = []
  const processedIds = new Set<string>()

  for (const season of normalizedData.value) {
    if (processedIds.has(season.id)) continue

    const baseName = getBaseName(season.name)
    const variant = getVariant(season.name)

    if (variant && grouped.has(baseName)) {
      const variants = grouped.get(baseName)!

      // Only add the parent row once (for the first variant encountered)
      if (!processedIds.has(baseName)) {
        // Use the minimum order_in_program from all variants
        const minOrder = Math.min(...variants.map(v => v.order_in_program))

        // Calculate aggregated values
        const avgProgress = Math.round(
          variants.reduce((sum, v) => sum + v.progress_percentage, 0) / variants.length
        )

        const status = avgProgress >= 75
          ? 'Completed'
          : avgProgress > 0
          ? 'On Going'
          : 'Not Started'

        result.push({
          id: baseName,
          name: baseName,
          avatar: season.avatar,
          start_date: season.start_date,
          end_date: season.end_date,
          order_in_program: minOrder,
          progress_percentage: avgProgress,
          is_completed: variants.every(v => v.is_completed),
          status: status as SeasonProgress['status'],
          variants: variants,
          hasVariants: true
        })

        console.log('Added parent row for:', baseName, 'with', variants.length, 'variants')
        processedIds.add(baseName)
        // Mark all variants as processed
        variants.forEach(v => processedIds.add(v.id))
      }
    } else if (!variant) {
      // Standalone season without variants
      result.push(season)
      processedIds.add(season.id)
    }
  }

  return result.sort((a, b) => a.order_in_program - b.order_in_program)
})

const expanded = ref({})

const columns: TableColumn<SeasonProgress>[] = [
{
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => {
      const hasVariants = row.original.hasVariants
      const avatarProps = row.original.avatar || {}

      return h('div', { class: 'flex items-center gap-3' }, [
         // Show expand button only for rows with variants
         hasVariants && h(UButton, {
            color: "neutral",
            variant: "ghost",
            size: "xs",
            icon: row.getIsExpanded() ? "i-lucide-chevron-down" : "i-lucide-chevron-right",
            ui: {
              base: "p-0 rounded-sm",
              leadingIcon: "size-4"
            },
            onClick: () => row.toggleExpanded()
          }),
          // Avatar for non-variant rows
          !hasVariants && avatarProps && avatarProps.src && h(UAvatar, { ...avatarProps, size: 'lg' }),
          // Season name and start date
          h('div', {}, [
            h('p', {
              class: 'font-medium text-highlighted'
            }, row.original.name),
            !hasVariants && h('p', { class: 'text-sm' }, `Start date: ${row.original.start_date}`)
          ])
      ])
    }
  },
  {
    accessorKey: 'start_date',
    header: 'Start Date',
    cell: ({ row }) => {
      const date = row.original.start_date
      return date ? new Date(date).toLocaleDateString() : '-'
    }
  },
  {
    accessorKey: 'end_date',
    header: 'End Date',
    cell: ({ row }) => {
      const date = row.original.end_date
      return date ? new Date(date).toLocaleDateString() : '-'
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const color = {
        'On Going': 'info' as const,
        'Completed': 'success' as const,
        'Not Started': 'neutral' as const
      }[row.getValue('status') as string]

      return h(UBadge, { class: 'capitalize', variant: 'subtle', color }, () =>
        row.getValue('status')
      )
    }
  },
  {
    accessorKey: 'progress_percentage',
    header: 'Progress',
    cell: ({ row }) => {
      const hasVariants = row.original.hasVariants

      if (hasVariants && row.original.variants) {
        // Show all variant progress percentages
        const progressValues = row.original.variants.map(v => `${v.progress_percentage}%`).filter(v => v !== '0%')

        return progressValues.length > 0 ? progressValues.join(' / ') : '0%'
       
      }

      const progress = row.original.progress_percentage
      return `${progress}%`
    }
  },
    {
    accessorKey: 'order_in_program',
    header: 'Order',
    cell: ({ row }) => row.original.order_in_program
  },
]
</script>

<template>
  <div class="w-full">
    <UTable
    v-model:expanded="expanded"
    :data="data"
    sticky
    :columns="columns"
    :ui="{
      base: 'border-separate border-spacing-0',
      thead: '[&>tr]:bg-elevated/50 h-10 [&>tr]:after:content-none',
      tbody: '[&>tr]:last:[&>td]:border-b-0',
      th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
      td: 'border-b border-default',
    }"
  >
    <template #expanded="{ row }">
      <div v-if="row.original.variants" class="px-4 py-3">
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div
            v-for="variant in row.original.variants"
            :key="variant.id"
            class="p-3 rounded-lg border border-default hover:border-highlighted transition-colors"
          >
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-highlighted">{{ variant.name }}</span>
                <UBadge
                  :color="{
                    'On Going': 'info',
                    'Completed': 'success',
                    'Not Started': 'neutral'
                  }[variant.status]"
                  variant="subtle"
                  size="md"
                  class="capitalize"
                >
                  {{ variant.status }}
                </UBadge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UTable>
  </div>
</template>
