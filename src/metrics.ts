import {
  DAILY_STORY_POINT_RATE,
  IN_PROGRESS_ALIASES,
  STORY_POINT_CAPACITY,
  monthWindow,
} from './constants'
import type {
  JiraClosedSprint,
  JiraIssueCandidate,
  JiraStatusChange,
  KpiSummary,
  TaskMetric,
} from './types'

export { STORY_POINT_CAPACITY, DAILY_STORY_POINT_RATE }

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

/** Whole calendar-day difference in UTC (resolutiondate − In Progress date). */
export function calendarDayDiffUtc(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  return Math.round((endUtc - startUtc) / 86_400_000)
}

/** Inclusive Mon–Fri count between two dates (UTC calendar days). */
export function countWorkingDays(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  if (endUtc < startUtc) return 0

  let count = 0
  for (let cursor = startUtc; cursor <= endUtc; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay() // 0=Sun … 6=Sat
    if (day !== 0 && day !== 6) count++
  }
  return count
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

export function resolveCapacityFromSprints(sprintsInMonth: JiraClosedSprint[]): {
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
    totalWorkingDays += countWorkingDays(sprint.startDate, end)
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

export function toTaskMetric(issue: JiraIssueCandidate): TaskMetric {
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
    leadTimeDays: isComplete ? calendarDayDiffUtc(startDate, endDate) : null,
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
): KpiSummary {
  const filtered = issues.filter((issue) =>
    isResolvedInMonth(issue.resolutionDate, year, month),
  )
  const metricUnits = resolveMetricUnits(filtered)
  const tasks = metricUnits.map(toTaskMetric)
  const completeTasks = tasks.filter((t) => t.isComplete)

  const totalStoryPoints = metricUnits.reduce((sum, issue) => {
    return sum + (issue.storyPoints ?? 0)
  }, 0)

  const capacity = resolveCapacityFromSprints(sprintsInMonth)
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
