import {
  DAILY_STORY_POINT_RATE,
  HALF_DAY_HOUR_THRESHOLD,
  IN_PROGRESS_ALIASES,
  STORY_POINT_CAPACITY,
  WORKDAY_AFTERNOON,
  WORKDAY_MORNING,
  WORKDAY_UTC_OFFSET_HOURS,
  monthWindow,
} from './constants'
import { toDateKey } from './holidays'
import type {
  JiraClosedSprint,
  JiraIssueCandidate,
  JiraStatusChange,
  KpiSummary,
  TaskMetric,
} from './types'

export { STORY_POINT_CAPACITY, DAILY_STORY_POINT_RATE }

const JAKARTA_OFFSET_MS = WORKDAY_UTC_OFFSET_HOURS * 60 * 60 * 1000

type JakartaParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function normalizeStatus(name: string): string {
  return name.trim().toLowerCase()
}

function isAlias(name: string, aliases: Set<string>): boolean {
  return aliases.has(normalizeStatus(name))
}

export function findFirstInProgressAt(changes: JiraStatusChange[]): Date | null {
  for (const change of changes) {
    if (isAlias(change.to, IN_PROGRESS_ALIASES)) return change.at
  }
  return null
}

/**
 * Lead time bounds: start = first In Progress (changelog), end = resolutiondate.
 */
export function findLeadTimeBounds(
  changes: JiraStatusChange[],
  resolutionDate: Date | null,
): {
  startDate: Date | null
  endDate: Date | null
} {
  return {
    startDate: findFirstInProgressAt(changes),
    endDate: resolutionDate,
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toJakartaParts(date: Date): JakartaParts {
  const shifted = new Date(date.getTime() + JAKARTA_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

function fromJakartaLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - JAKARTA_OFFSET_MS,
  )
}

function jakartaDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function isJakartaWeekend(year: number, month: number, day: number): boolean {
  const noon = fromJakartaLocal(year, month, day, 12, 0, 0)
  const dow = new Date(noon.getTime() + JAKARTA_OFFSET_MS).getUTCDay()
  return dow === 0 || dow === 6
}

function isJakartaBusinessDay(
  year: number,
  month: number,
  day: number,
  holidays: Set<string>,
): boolean {
  if (isJakartaWeekend(year, month, day)) return false
  return !holidays.has(jakartaDateKey(year, month, day))
}

function overlapHours(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime())
  const end = Math.min(aEnd.getTime(), bEnd.getTime())
  if (end <= start) return 0
  return (end - start) / 3_600_000
}

function effectiveHoursOnJakartaDay(
  ticketStart: Date,
  ticketEnd: Date,
  year: number,
  month: number,
  day: number,
): number {
  const morningStart = fromJakartaLocal(year, month, day, WORKDAY_MORNING.startHour)
  const morningEnd = fromJakartaLocal(year, month, day, WORKDAY_MORNING.endHour)
  const afternoonStart = fromJakartaLocal(year, month, day, WORKDAY_AFTERNOON.startHour)
  const afternoonEnd = fromJakartaLocal(year, month, day, WORKDAY_AFTERNOON.endHour)

  return (
    overlapHours(ticketStart, ticketEnd, morningStart, morningEnd) +
    overlapHours(ticketStart, ticketEnd, afternoonStart, afternoonEnd)
  )
}

function dayScoreFromHours(hours: number): number {
  if (hours <= 0) return 0
  if (hours < HALF_DAY_HOUR_THRESHOLD) return 0.5
  return 1
}

/**
 * Fractional lead days within work windows 08:00–12:00 + 13:00–17:00 Asia/Jakarta.
 * Per business day: 0 if no overlap, 0.5 if under 4 effective hours, else 1.
 */
export function countFractionalLeadDays(
  start: Date,
  end: Date,
  holidays: Set<string>,
): number {
  if (end.getTime() < start.getTime()) return 0

  const startParts = toJakartaParts(start)
  const endParts = toJakartaParts(end)

  let cursor = fromJakartaLocal(startParts.year, startParts.month, startParts.day, 12)
  const lastNoon = fromJakartaLocal(endParts.year, endParts.month, endParts.day, 12)

  let total = 0
  while (cursor.getTime() <= lastNoon.getTime()) {
    const parts = toJakartaParts(cursor)
    if (isJakartaBusinessDay(parts.year, parts.month, parts.day, holidays)) {
      const hours = effectiveHoursOnJakartaDay(
        start,
        end,
        parts.year,
        parts.month,
        parts.day,
      )
      total += dayScoreFromHours(hours)
    }
    cursor = new Date(cursor.getTime() + 86_400_000)
  }

  return total
}

function isWeekendUtc(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function isBusinessDay(date: Date, holidays: Set<string>): boolean {
  if (isWeekendUtc(date)) return false
  return !holidays.has(toDateKey(date))
}

/** Inclusive Mon–Fri count between two dates (UTC calendar days), minus holidays. */
export function countBusinessDays(
  start: Date,
  end: Date,
  holidays: Set<string>,
): number {
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  if (endUtc < startUtc) return 0

  let count = 0
  for (let cursor = startUtc; cursor <= endUtc; cursor += 86_400_000) {
    if (isBusinessDay(new Date(cursor), holidays)) count++
  }
  return count
}

export function countWorkingDays(start: Date, end: Date): number {
  return countBusinessDays(start, end, new Set())
}

export function isResolvedInMonth(
  resolutionDate: Date | null,
  year: number,
  month: number,
): boolean {
  if (!resolutionDate) return false
  const { startDate, endExclusive } = monthWindow(year, month)
  return resolutionDate >= startDate && resolutionDate < endExclusive
}

export function sprintsCompletedInMonth(
  sprints: JiraClosedSprint[],
  year: number,
  month: number,
): JiraClosedSprint[] {
  const { startDate, endExclusive } = monthWindow(year, month)
  return sprints.filter((sprint) => {
    if (!sprint.completeDate) return false
    return sprint.completeDate >= startDate && sprint.completeDate < endExclusive
  })
}

export function resolveCapacityFromSprints(
  sprintsInMonth: JiraClosedSprint[],
  holidays: Set<string>,
): {
  closedSprintCount: number
  totalWorkingDays: number
  capacityStoryPoints: number
  usedDefaultCapacity: boolean
} {
  const closedSprintCount = sprintsInMonth.length

  let totalWorkingDays = 0
  for (const sprint of sprintsInMonth) {
    if (!sprint.startDate) continue
    const end = sprint.endDate ?? sprint.completeDate
    if (!end) continue
    totalWorkingDays += countBusinessDays(sprint.startDate, end, holidays)
  }

  if (closedSprintCount <= 0 || totalWorkingDays <= 0) {
    return {
      closedSprintCount,
      totalWorkingDays: 0,
      capacityStoryPoints: STORY_POINT_CAPACITY,
      usedDefaultCapacity: true,
    }
  }

  return {
    closedSprintCount,
    totalWorkingDays,
    capacityStoryPoints: totalWorkingDays * DAILY_STORY_POINT_RATE,
    usedDefaultCapacity: false,
  }
}

/** Expand parents with subtasks to self-assigned children; leaves stay as themselves. */
export function resolveMetricUnits(issues: JiraIssueCandidate[]): JiraIssueCandidate[] {
  const expanded = issues.flatMap((issue) => {
    if (issue.hasSubtasks) return issue.subtasks
    return [issue]
  })

  const seen = new Set<string>()
  const unique: JiraIssueCandidate[] = []
  for (const issue of expanded) {
    if (seen.has(issue.key)) continue
    seen.add(issue.key)
    unique.push(issue)
  }
  return unique
}

export function toTaskMetric(
  issue: JiraIssueCandidate,
  holidays: Set<string>,
): TaskMetric {
  const { startDate, endDate } = findLeadTimeBounds(
    issue.statusChanges,
    issue.resolutionDate,
  )
  const isComplete = startDate != null && endDate != null
  return {
    key: issue.key,
    title: issue.summary,
    link: issue.link,
    storyPoints: issue.storyPoints,
    startDate,
    endDate,
    leadTimeDays: isComplete
      ? countFractionalLeadDays(startDate, endDate, holidays)
      : null,
    isComplete,
    parentKey: issue.parentKey,
  }
}

export function buildKpiSummary(
  issues: JiraIssueCandidate[],
  year: number,
  month: number,
  userLabel: string,
  sprintsInMonth: JiraClosedSprint[],
  holidays: Set<string>,
): KpiSummary {
  const filtered = issues.filter((issue) =>
    isResolvedInMonth(issue.resolutionDate, year, month),
  )
  const metricUnits = resolveMetricUnits(filtered)
  const tasks = metricUnits.map((issue) => toTaskMetric(issue, holidays))
  const completeTasks = tasks.filter((t) => t.isComplete)

  const totalStoryPoints = metricUnits.reduce((sum, issue) => {
    return sum + (issue.storyPoints ?? 0)
  }, 0)

  const capacity = resolveCapacityFromSprints(sprintsInMonth, holidays)
  const storyPointPercentage =
    (totalStoryPoints / capacity.capacityStoryPoints) * 100

  const leadTimes = completeTasks
    .map((t) => t.leadTimeDays)
    .filter((d): d is number => d != null)

  const averageLeadTimeDays =
    leadTimes.length === 0
      ? null
      : leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length

  return {
    month,
    year,
    userLabel,
    tasks,
    completeTasks,
    totalStoryPoints,
    closedSprintCount: capacity.closedSprintCount,
    totalWorkingDays: capacity.totalWorkingDays,
    capacityStoryPoints: capacity.capacityStoryPoints,
    storyPointPercentage,
    averageLeadTimeDays,
  }
}
