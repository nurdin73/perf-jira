export const TODO_ALIASES = new Set(['todo', 'to do'])
export const IN_PROGRESS_ALIASES = new Set(['in progress'])

/** Capacity for a full sprint of WORKING_DAYS_PER_CAPACITY working days. */
export const STORY_POINT_CAPACITY = 400
export const WORKING_DAYS_PER_CAPACITY = 9
export const DAILY_STORY_POINT_RATE =
  STORY_POINT_CAPACITY / WORKING_DAYS_PER_CAPACITY

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function monthWindow(year: number, month: number): {
  start: string
  end: string
  /** First day of next month (YYYY-MM-DD), exclusive upper bound for resolved JQL. */
  nextStart: string
  startDate: Date
  endExclusive: Date
} {
  const start = `${year}-${pad2(month)}-01`
  const end = `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`
  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endExclusive = new Date(Date.UTC(year, month, 1))
  const nextStart = `${endExclusive.getUTCFullYear()}-${pad2(endExclusive.getUTCMonth() + 1)}-01`
  return { start, end, nextStart, startDate, endExclusive }
}
