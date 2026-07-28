import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CsvRow, TaskMetric } from './types'

function formatDateUtc(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsvRows(completeTasks: TaskMetric[]): CsvRow[] {
  return completeTasks.map((task) => ({
    link: task.link,
    title: task.title,
    start_date: task.startDate ? formatDateUtc(task.startDate) : '',
    end_date: task.endDate ? formatDateUtc(task.endDate) : '',
    lead_time: task.leadTimeDays != null ? task.leadTimeDays.toFixed(1) : '',
  }))
}

export function serializeCsv(rows: CsvRow[]): string {
  const header = 'link,title,start_date,end_date,lead_time'
  const lines = rows.map((row) =>
    [row.link, row.title, row.start_date, row.end_date, row.lead_time]
      .map(escapeCsv)
      .join(','),
  )
  return [header, ...lines].join('\n') + '\n'
}

export async function writeCsv(path: string, completeTasks: TaskMetric[]): Promise<void> {
  const dir = dirname(path)
  if (dir && dir !== '.') {
    await mkdir(dir, { recursive: true })
  }
  const content = serializeCsv(toCsvRows(completeTasks))
  await Bun.write(path, content)
}
