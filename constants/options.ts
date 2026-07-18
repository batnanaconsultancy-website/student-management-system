export const PROGRAM_OPTIONS = [
  { label: 'Software Engineering', value: 'Software Engineering' },
  { label: 'Data Science', value: 'Data Science' },
  { label: 'AI/ML', value: 'AI/ML' },
] as const

export const STATUS_OPTIONS = ['Active', 'Inactive', 'Frozen', 'Graduated'] as const

export const STUDENT_CLASS_OPTIONS = [
  { label: 'Regular', value: 'Regular' },
  { label: 'Code Academy', value: 'Code Academy' },
] as const

export const GUIDANCE_CATEGORIES = [
  'Financial issues',
  'Request student letters',
  'Request transcript',
  'Request freezing / termination of enrollment',
  'Technical complaint',
  'Suggestions for improvement',
  'Request internship placement',
  'Request change of program',
  'Request therapist session',
  'Request scholarship',
  'Complaint about peers/mentor/facilitator',
  'Request handbook/program items',
  'Others',
] as const

export const GUIDANCE_REQUEST_WORD_LIMIT = 50

export const STUDENT_STATUS = {
  ON_TRACK: 'on_track',
  AT_RISK: 'at_risk',
  MONITOR: 'monitor',
  AHEAD: 'ahead',
} as const

export type StudentStatusType = (typeof STUDENT_STATUS)[keyof typeof STUDENT_STATUS]
export type StatusOptionType = (typeof STATUS_OPTIONS)[number]
