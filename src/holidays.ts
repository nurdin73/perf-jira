import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Holidays from 'date-holidays'

export type HolidayOverrides = {
  add?: string[]
  remove?: string[]
}

export type HolidayEntry = {
  date: string
  name: string
  source: 'library' | 'override'
}

export type HolidaySetResult = {
  dates: Set<string>
  entries: HolidayEntry[]
  libraryCount: number
  addedCount: number
  removedCount: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${pad2(month)}`
}

async function loadOverrides(path: string): Promise<HolidayOverrides> {
  if (!existsSync(path)) {
    return { add: [], remove: [] }
  }

  const file = Bun.file(path)
  const raw = (await file.json()) as HolidayOverrides
  return {
    add: Array.isArray(raw.add) ? raw.add : [],
    remove: Array.isArray(raw.remove) ? raw.remove : [],
  }
}

/**
 * Hybrid holiday set: date-holidays locale ID ∪ add − remove.
 */
export async function buildHolidaySet(
  years: number[],
  overridesPath = process.env.JIRA_HOLIDAYS_FILE ?? './holidays.json',
): Promise<HolidaySetResult> {
  const uniqueYears = [...new Set(years)].sort((a, b) => a - b)
  const hd = new Holidays('ID')
  const byDate = new Map<string, HolidayEntry>()

  for (const year of uniqueYears) {
    const holidays = hd.getHolidays(year)
    for (const holiday of holidays) {
      // Keep public/bank/optional school days that block work; skip pure observances.
      if (holiday.type === 'observance') continue
      const key = toDateKey(new Date(holiday.date))
      byDate.set(key, {
        date: key,
        name: holiday.name,
        source: 'library',
      })
    }
  }

  const libraryCount = byDate.size
  const resolvedPath = resolve(overridesPath)
  const overrides = await loadOverrides(resolvedPath)

  let addedCount = 0
  for (const day of overrides.add ?? []) {
    if (!isValidDateKey(day)) {
      throw new Error(`Invalid holidays.json add date: ${day} (expected YYYY-MM-DD)`)
    }
    if (!byDate.has(day)) {
      byDate.set(day, {
        date: day,
        name: 'Custom holiday',
        source: 'override',
      })
      addedCount++
    }
  }

  let removedCount = 0
  for (const day of overrides.remove ?? []) {
    if (!isValidDateKey(day)) {
      throw new Error(`Invalid holidays.json remove date: ${day} (expected YYYY-MM-DD)`)
    }
    if (byDate.delete(day)) removedCount++
  }

  const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const dates = new Set(entries.map((entry) => entry.date))

  return { dates, entries, libraryCount, addedCount, removedCount }
}

export function holidaysInMonth(
  entries: HolidayEntry[],
  year: number,
  month: number,
): HolidayEntry[] {
  const prefix = monthPrefix(year, month)
  return entries.filter((entry) => entry.date.startsWith(prefix))
}
