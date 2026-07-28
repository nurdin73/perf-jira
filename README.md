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
2. Searches issues assigned to you with **`resolved`** in the selected month.
3. For each issue:
   - **Has subtasks** → metrics from **self-assigned** subtasks only (parent SP ignored).
   - **No subtasks** → metrics from the issue itself.
4. Lead time per unit: first **In Progress** (changelog) → **`resolutiondate`**.
5. Loads closed sprints from `JIRA_BOARD_ID`, keeps those with **`completeDate`** in the month, and computes capacity from working days.
6. Prints a console summary and writes CSV.

## Metrics

### Lead time

```
leadTimeDays = calendarDaysUTC(resolutiondate − first In Progress)
```

Incomplete units (missing In Progress or resolutiondate) show `N/A` in console and are excluded from CSV and average lead time.

### Story points

Sum of story points on metric units (self-assigned children or leaf issues).

### Capacity & story point %

```
dailyRate = 400 / 9
capacity  = Σ workingDays(sprint.startDate → sprint.endDate) × dailyRate
storyPointPercentage = (totalStoryPoints / capacity) × 100
```

- `400` = capacity for a **9 working-day** sprint
- Working days = Monday–Friday (UTC), no holiday calendar
- If `endDate` is missing → use `completeDate`
- If no closed sprints / zero working days → capacity defaults to `400` (with a warning)

### CSV columns

| Column | Meaning |
| --- | --- |
| `link` | Issue browse URL |
| `title` | Summary |
| `start_date` | First In Progress (UTC date) |
| `end_date` | resolutiondate (UTC date) |
| `lead_time` | Days (In Progress → resolved) |

## Project layout

```
script-fetch-kpi/
  .env.example
  package.json
  src/
    index.ts         # CLI entry
    jira-client.ts   # Jira REST / Agile
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
