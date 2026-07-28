import { JiraClient } from './jira-client'
import {
  buildKpiSummary,
  resolveCapacityFromSprints,
  sprintsCompletedInMonth,
} from './metrics'
import { writeCsv } from './csv'
import type { CliArgs, KpiSummary } from './types'

function printUsage(): void {
  console.log(`Usage:
  bun run start -- --month <1-12> --year <YYYY> [--out <path>]

Examples:
  bun run start -- --month 7 --year 2026
  bun run start -- --month 7 --year 2026 --out ./reports/kpi-2026-07.csv
`)
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv]
  let month: number | undefined
  let year: number | undefined
  let out: string | undefined

  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const value = args[i + 1]
    if (flag === '--help' || flag === '-h') {
      printUsage()
      process.exit(0)
    }
    if (flag === '--month' && value) {
      month = Number(value)
      i++
      continue
    }
    if (flag === '--year' && value) {
      year = Number(value)
      i++
      continue
    }
    if (flag === '--out' && value) {
      out = value
      i++
      continue
    }
  }

  if (
    month == null ||
    year == null ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    year < 2000
  ) {
    printUsage()
    throw new Error('Required: --month <1-12> and --year <YYYY>')
  }

  const paddedMonth = String(month).padStart(2, '0')
  return {
    month,
    year,
    out: out ?? `kpi-${year}-${paddedMonth}.csv`,
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function printSummary(summary: KpiSummary, outPath: string): void {
  const paddedMonth = String(summary.month).padStart(2, '0')
  const workingDaysLabel =
    summary.totalWorkingDays > 0 ? String(summary.totalWorkingDays) : '0 (default)'

  console.log(
    `Month: ${summary.year}-${paddedMonth} | User: ${summary.userLabel} | Issues: ${summary.tasks.length} (complete: ${summary.completeTasks.length})`,
  )
  console.log('')
  console.log(
    `${'KEY'.padEnd(12)} ${'TITLE'.padEnd(40)} ${'SP'.padStart(4)} ${'LEAD_DAYS'.padStart(10)}`,
  )

  for (const task of summary.tasks) {
    const sp = task.storyPoints != null ? String(task.storyPoints) : '-'
    const lead = task.leadTimeDays != null ? String(task.leadTimeDays) : 'N/A'
    console.log(
      `${task.key.padEnd(12)} ${truncate(task.title, 40).padEnd(40)} ${sp.padStart(4)} ${lead.padStart(10)}`,
    )
  }

  console.log('')
  console.log(`Total story points:      ${summary.totalStoryPoints}`)
  console.log(`Closed sprints in month: ${summary.closedSprintCount}`)
  console.log(`Working days (sprints):  ${workingDaysLabel}`)
  console.log(
    `Capacity story points:   ${summary.capacityStoryPoints.toFixed(1)}   // ${summary.totalWorkingDays || 9} * (400/9)`,
  )
  console.log(
    `Story point percentage:  ${summary.storyPointPercentage.toFixed(1)}%   // (${summary.totalStoryPoints} / ${summary.capacityStoryPoints.toFixed(1)}) * 100`,
  )
  console.log(
    `Average lead time:       ${
      summary.averageLeadTimeDays == null
        ? 'N/A'
        : `${summary.averageLeadTimeDays.toFixed(1)} days`
    }`,
  )
  console.log(`CSV written: ${outPath}`)
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2))
  const client = new JiraClient()
  const me = await client.getMyself()
  const userLabel = me.emailAddress ?? me.displayName

  console.log(`Fetching issues for ${userLabel}…`)
  const [candidates, closedSprints] = await Promise.all([
    client.searchCandidates(args.year, args.month, me.accountId),
    client.listClosedSprints(),
  ])

  const sprintsInMonth = sprintsCompletedInMonth(
    closedSprints,
    args.year,
    args.month,
  )
  const capacity = resolveCapacityFromSprints(sprintsInMonth)
  if (capacity.usedDefaultCapacity) {
    console.warn('No closed sprints in month; capacity defaulted to 400')
  }

  const summary = buildKpiSummary(
    candidates,
    args.year,
    args.month,
    userLabel,
    sprintsInMonth,
  )

  await writeCsv(args.out, summary.completeTasks)
  printSummary(summary, args.out)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
