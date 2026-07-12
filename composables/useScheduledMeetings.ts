export const DAY_OPTIONS = [
  { label: 'Sunday', value: 0 },
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
]

export function useScheduledMeetings() {
  const meetings = ref<any[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchMeetings() {
    loading.value = true
    error.value = null
    try {
      const response: any = await $fetch('/api/meetings/list')
      meetings.value = response?.data || []
      return response
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.message || 'Failed to fetch meetings'
      console.error('Error fetching scheduled meetings:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createMeeting(payload: Record<string, any>) {
    loading.value = true
    error.value = null
    try {
      const response = await $fetch('/api/meetings/create', {
        method: 'POST',
        body: payload
      })
      await fetchMeetings()
      return response
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.message || 'Failed to create meeting'
      console.error('Error creating scheduled meeting:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateMeeting(id: string, payload: Record<string, any>) {
    loading.value = true
    error.value = null
    try {
      const response = await $fetch('/api/meetings/update', {
        method: 'POST',
        body: { id, ...payload }
      })
      await fetchMeetings()
      return response
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.message || 'Failed to update meeting'
      console.error('Error updating scheduled meeting:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function removeMeeting(id: string) {
    loading.value = true
    error.value = null
    try {
      const response = await $fetch('/api/meetings/remove', {
        method: 'POST',
        body: { id }
      })
      await fetchMeetings()
      return response
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.message || 'Failed to delete meeting'
      console.error('Error deleting scheduled meeting:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  function dayLabel(dayOfWeek: number) {
    return DAY_OPTIONS.find(d => d.value === dayOfWeek)?.label || 'Unknown'
  }

  return {
    meetings,
    loading,
    error,
    fetchMeetings,
    createMeeting,
    updateMeeting,
    removeMeeting,
    dayLabel
  }
}
