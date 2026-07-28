# script-fetch-kpi

CLI to fetch personal Jira KPI for a selected month/year: lead time, story points, sprint-based capacity %, and CSV export.

Built with **Bun** + **TypeScript**. Uses Jira Cloud REST + Agile APIs.

## Prerequisites

- [Bun](https://bun.sh/) installed
- Jira Cloud account with API token
- Scrum board ID for sprint capacity

## Setup

```bash
cd script-fetch-kpi
cp .env.example .env
# edit .env with your credentials
bun install
```

### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `JIRA_BASE_URL` | yes | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | yes | Atlassian account email |
| `JIRA_API_TOKEN` | yes | [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_BOARD_ID` | yes | Scrum board ID (for closed-sprint capacity) |
| `JIRA_HOLIDAYS_FILE` | no | Path to holiday overrides JSON (default `./holidays.json`) |
| `JIRA_STORY_POINTS_FIELD` | no | Override Story Points field id if auto-detect fails |

## Usage

```bash
bun run start -- --month <1-12> --year <YYYY> [--out <path>]
```

Examples:

```bash
bun run start -- --month 7 --year 2026
bun run start -- --month 7 --year 2026 --out ./reports/kpi-2026-07.csv
```

Default CSV path: `kpi-YYYY-MM.csv` in the current directory.

## What it does

1. Authenticates as the token owner (`/myself`).
2. Builds a holiday set: **`date-holidays` locale `ID`** ∪ `holidays.json` add − remove.
3. Searches issues assigned to you with **`resolved`** in the selected month.
4. For each issue:
   - **Has subtasks** → metrics from **self-assigned** subtasks only (parent SP ignored).
   - **No subtasks** → metrics from the issue itself.
5. Lead time per unit: first **In Progress** → **`resolutiondate`**, counting **business days** only.
6. Loads closed sprints from `JIRA_BOARD_ID`, keeps those with **`completeDate`** in the month, and computes capacity from business days.
7. Prints a console summary and writes CSV.

## Metrics

### Lead time

```
leadTimeDays = Σ dayScore for each Asia/Jakarta calendar day in
               [In Progress, resolutiondate]
```

Work windows (WIB): `08:00–12:00` + `13:00–17:00` (lunch `12:00–13:00` excluded → **8h** effective max/day).

Per business day (Mon–Fri, minus holidays):

| Effective overlap hours | Score |
| --- | --- |
| 0 | 0 |
| > 0 and < 4 | 0.5 |
| ≥ 4 | 1 |

Incomplete units (missing In Progress or resolutiondate) show `N/A` in console and are excluded from CSV and average lead time.

The console table also prints **START** / **END** as `YYYY-MM-DD HH:mm` in Asia/Jakarta (In Progress → resolutiondate).

### Holidays (hybrid)

```
holidaySet = date-holidays('ID')  ∪  holidays.json "add"  −  holidays.json "remove"
```

Example [`holidays.json`](holidays.json):

```json
{
  "add": ["2026-12-24"],
  "remove": ["2026-05-01"]
}
```

- `add` — company / cuti bersama days missing from the library
- `remove` — library dates that should not count as off for your team
- File is optional; if missing, library dates only are used
- The CLI summary lists holidays that fall in the selected month (date + name)

### Story points

Sum of story points on metric units (self-assigned children or leaf issues).

### Capacity & story point %

```
dailyRate = 400 / 9
capacity  = Σ businessDays(sprint.startDate → sprint.endDate) × dailyRate
storyPointPercentage = (totalStoryPoints / capacity) × 100
```

- `400` = capacity for a **9 working-day** sprint
- Business days = Monday–Friday minus hybrid holidays (inclusive sprint range)
- If `endDate` is missing → use `completeDate`
- If no closed sprints / zero working days → capacity defaults to `400` (with a warning)

### CSV columns

| Column | Meaning |
| --- | --- |
| `link` | Issue browse URL |
| `title` | Summary |
| `start_date` | First In Progress (UTC date) |
| `end_date` | resolutiondate (UTC date) |
| `lead_time` | Business days (In Progress → resolved) |

## Project layout

```
script-fetch-kpi/
  .env.example
  holidays.json      # optional add/remove overrides
  package.json
  src/
    index.ts         # CLI entry
    jira-client.ts   # Jira REST / Agile
    holidays.ts      # date-holidays ID + overrides
    metrics.ts       # Lead time, SP%, capacity
    csv.ts           # CSV writer
    constants.ts
    types.ts
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run start -- --month M --year Y` | Run KPI fetch |
| `bun run typecheck` | TypeScript check |

## Notes

- Status aliases for In Progress: `In Progress` (case-insensitive).
- Do not commit `.env` or generated `*.csv` files (see `.gitignore`).
