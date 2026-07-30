export type JiraUser = {
  accountId: string
  displayName: string
  emailAddress?: string
}

export type JiraStatusChange = {
  from: string | null
  to: string
  at: Date
}

export type JiraIssueCandidate = {
  key: string
  summary: string
  storyPoints: number | null
  link: string
  statusChanges: JiraStatusChange[]
  /** Jira resolutiondate; null when unresolved. */
  resolutionDate: Date | null
  /** True when Jira reports any direct subtasks (before self-assignee filter). */
  hasSubtasks: boolean
  /** Self-assigned direct subtasks only; empty when leaf or none assigned to self. */
  subtasks: JiraIssueCandidate[]
  parentKey?: string
}

export type TaskMetric = {
  key: string
  title: string
  link: string
  storyPoints: number | null
  startDate: Date | null
  endDate: Date | null
  leadTimeDays: number | null
  isComplete: boolean
  parentKey?: string
}

export type KpiSummary = {
  month: number
  year: number
  userLabel: string
  tasks: TaskMetric[]
  completeTasks: TaskMetric[]
  totalStoryPoints: number
  closedSprintCount: number
  totalWorkingDays: number
  capacityStoryPoints: number
  capacitySource: 'sprints' | 'month'
  excludedHolidayDays: number
  storyPointPercentage: number
  averageLeadTimeDays: number | null
}

export type JiraClosedSprint = {
  id: number
  name: string
  startDate: Date | null
  endDate: Date | null
  completeDate: Date | null
}

export type CsvRow = {
  link: string
  title: string
  start_date: string
  end_date: string
  lead_time: string
}

export type CliArgs = {
  month: number
  year: number
  out: string
}
