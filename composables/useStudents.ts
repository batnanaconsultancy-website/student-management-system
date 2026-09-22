import { CACHE_KEYS } from './useCacheInvalidation'
import type { Student } from '~/types'
import type { ApiListResponse } from '~/types'

export function useStudents() {
  const supabase = useSupabaseClient()
  const nuxtApp = useNuxtApp()

  // Use Nuxt's useFetch with caching
  const { data: studentsData, refresh, status, error: fetchError } = useFetch<ApiListResponse<Student>>('/api/students', {
    key: CACHE_KEYS.STUDENTS,
    getCachedData(key) {
      return nuxtApp.payload.data[key] || nuxtApp.static.data[key]
    },
    // Don't fetch immediately - let components trigger the fetch
    immediate: false
  })

  // Fallback to direct Supabase fetch if API doesn't exist
  const localStudents = ref<Student[]>([])
  const localLoading = ref(false)
  const localError = ref<string | null>(null)

  // Computed properties
  const students = computed(() => studentsData.value?.data || localStudents.value)
  const loading = computed(() => status.value === 'pending' || localLoading.value)
  const error = computed(() => fetchError.value?.message || localError.value)

  /**
   * Fetch all students from the database
   */
  async function fetchStudents() {
    // Try the API endpoint first
    try {
      await refresh()
      if (studentsData.value?.data) {
        return studentsData.value.data
      }
    } catch {
      // Fall back to direct Supabase query
    }

    // Fallback to direct Supabase
    localLoading.value = true
    localError.value = null
    try {
      const { data, error: supabaseError } = await supabase
        .from('students')
        .select('*')
        .order('name', { ascending: true })

      if (supabaseError) throw supabaseError

      localStudents.value = data || []

      // Store in cache manually
      nuxtApp.payload.data[CACHE_KEYS.STUDENTS] = { data: localStudents.value }

      return data
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch students'
      localError.value = errorMessage
      throw err
    } finally {
      localLoading.value = false
    }
  }

  /**
   * Import students from CSV data
   */
  async function importStudents(studentsToImport: Record<string, unknown>[]) {
    localLoading.value = true
    localError.value = null
    try {
      const response = await $fetch('/api/students/import', {
        method: 'POST',
        body: { students: studentsToImport }
      })

      // Invalidate related caches after successful import
      await Promise.all([
        refreshNuxtData(CACHE_KEYS.STUDENTS),
        refreshNuxtData(CACHE_KEYS.ATTENDANCE),
        refreshNuxtData(CACHE_KEYS.ATTENDANCE_BY_COHORT)
      ])

      return response
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to import students'
      localError.value = errorMessage
      throw err
    } finally {
      localLoading.value = false
    }
  }

  /**
   * Parse CSV file content
   */
  function parseCSV(text: string) {
    const lines = text.split('\n').filter(line => line.trim())
    if (lines.length === 0) return []
    const headers = lines[0]?.split(',').map(h => h.trim()) ?? []

    const parsedStudents = []
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]?.split(',').map(v => v.trim()) ?? []
      parsedStudents.push({
        name: values[0] || '',
        qwasarId: values[1] || null,
        email: values[2] || '',
        programme: values[3] || '',
        cohort: values[4] || '',
        studentClass: values[5] || ''
      })
    }

    return parsedStudents
  }

  /**
   * Get a single student by ID
   */
  function getStudentById(id: string) {
    return students.value.find((s) => s.id === id)
  }

  /**
   * Get students by cohort
   */
  function getStudentsByCohort(cohortName: string) {
    return students.value.filter((s) => s.cohort === cohortName)
  }

  return {
    students,
    loading,
    error,
    fetchStudents,
    importStudents,
    parseCSV,
    getStudentById,
    getStudentsByCohort,
    refresh
  }
}
