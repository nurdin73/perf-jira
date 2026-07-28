import { monthWindow } from "./constants";
import type {
  JiraClosedSprint,
  JiraIssueCandidate,
  JiraStatusChange,
  JiraUser,
} from "./types";

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  boardId: string;
  storyPointsField?: string;
};

type JiraSubtaskStub = {
  key: string;
};

type JiraSearchIssue = {
  key: string;
  fields: {
    summary?: string;
    assignee?: { accountId?: string } | null;
    resolutiondate?: string | null;
    subtasks?: JiraSubtaskStub[];
    [key: string]: unknown;
  };
  changelog?: {
    histories?: Array<{
      created: string;
      items: Array<{
        field: string;
        fromString: string | null;
        toString: string | null;
      }>;
    }>;
  };
};

type JiraField = {
  id: string;
  name: string;
};

const CHILD_CHUNK_SIZE = 50;

function loadConfig(): JiraConfig {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const boardId = process.env.JIRA_BOARD_ID;
  const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD;

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Missing Jira credentials. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env",
    );
  }
  if (!boardId) {
    throw new Error(
      "Missing JIRA_BOARD_ID in .env (required for sprint capacity)",
    );
  }

  return { baseUrl, email, apiToken, boardId, storyPointsField };
}

function authHeader(config: JiraConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
}

async function jiraFetch<T>(
  config: JiraConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${config.baseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(config),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira API ${response.status} ${path}: ${body}`);
  }

  return (await response.json()) as T;
}

function extractStatusChanges(issue: JiraSearchIssue): JiraStatusChange[] {
  const changes: JiraStatusChange[] = [];
  for (const history of issue.changelog?.histories ?? []) {
    for (const item of history.items) {
      if (item.field !== "status" || !item.toString) continue;
      changes.push({
        from: item.fromString,
        to: item.toString,
        at: new Date(history.created),
      });
    }
  }
  changes.sort((a, b) => a.at.getTime() - b.at.getTime());
  return changes;
}

function readStoryPoints(
  fields: JiraSearchIssue["fields"],
  fieldId: string,
): number | null {
  const raw = fields[fieldId];
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (
    typeof raw === "string" &&
    raw.trim() !== "" &&
    !Number.isNaN(Number(raw))
  ) {
    return Number(raw);
  }
  return null;
}

function readResolutionDate(fields: JiraSearchIssue["fields"]): Date | null {
  const raw = fields.resolutiondate;
  if (!raw || typeof raw !== "string") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLeafCandidate(
  issue: JiraSearchIssue,
  storyPointsField: string,
  baseUrl: string,
  parentKey?: string,
): JiraIssueCandidate {
  return {
    key: issue.key,
    summary: issue.fields.summary ?? "",
    storyPoints: readStoryPoints(issue.fields, storyPointsField),
    link: `${baseUrl}/browse/${issue.key}`,
    statusChanges: extractStatusChanges(issue),
    resolutionDate: readResolutionDate(issue.fields),
    hasSubtasks: false,
    subtasks: [],
    parentKey,
  };
}

function chunkKeys(keys: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += size) {
    chunks.push(keys.slice(i, i + size));
  }
  return chunks;
}

export class JiraClient {
  private config: JiraConfig;
  private storyPointsFieldId: string | null = null;

  constructor(config?: JiraConfig) {
    this.config = config ?? loadConfig();
  }

  async getMyself(): Promise<JiraUser> {
    return jiraFetch<JiraUser>(this.config, "/rest/api/3/myself");
  }

  async listClosedSprints(): Promise<JiraClosedSprint[]> {
    const collected: JiraClosedSprint[] = [];
    let startAt = 0;
    const maxResults = 50;

    const parseDate = (raw: string | null | undefined): Date | null => {
      if (!raw || Number.isNaN(Date.parse(raw))) return null;
      return new Date(raw);
    };

    for (;;) {
      const page = await jiraFetch<{
        values: Array<{
          id: number;
          name: string;
          state?: string;
          startDate?: string | null;
          endDate?: string | null;
          completeDate?: string | null;
        }>;
        isLast?: boolean;
        startAt: number;
        maxResults: number;
      }>(
        this.config,
        `/rest/agile/1.0/board/${this.config.boardId}/sprint?state=closed&startAt=${startAt}&maxResults=${maxResults}`,
      );

      for (const sprint of page.values) {
        collected.push({
          id: sprint.id,
          name: sprint.name,
          startDate: parseDate(sprint.startDate),
          endDate: parseDate(sprint.endDate),
          completeDate: parseDate(sprint.completeDate),
        });
      }

      startAt += page.values.length;
      if (page.isLast || page.values.length === 0) break;
    }

    return collected;
  }

  async resolveStoryPointsField(): Promise<string> {
    if (this.config.storyPointsField) {
      this.storyPointsFieldId = this.config.storyPointsField;
      return this.storyPointsFieldId;
    }
    if (this.storyPointsFieldId) return this.storyPointsFieldId;

    const fields = await jiraFetch<JiraField[]>(
      this.config,
      "/rest/api/3/field",
    );
    const match = fields.find(
      (f) =>
        f.name.toLowerCase() === "story points" ||
        f.name.toLowerCase() === "story point estimate",
    );
    if (!match) {
      throw new Error(
        "Could not find Story Points field. Set JIRA_STORY_POINTS_FIELD in .env",
      );
    }
    this.storyPointsFieldId = match.id;
    return match.id;
  }

  private buildJql(year: number, month: number, useResolved: boolean): string {
    const { start, nextStart } = monthWindow(year, month);
    if (useResolved) {
      return (
        `assignee = currentUser() ` +
        `AND resolved >= "${start}" AND resolved < "${nextStart}" ` +
        `ORDER BY resolved DESC`
      );
    }
    return (
      `assignee = currentUser() ` +
      `AND updated >= "${start}" ` +
      `ORDER BY updated DESC`
    );
  }

  async searchCandidates(
    year: number,
    month: number,
    accountId: string,
  ): Promise<JiraIssueCandidate[]> {
    const storyPointsField = await this.resolveStoryPointsField();
    let issues: JiraSearchIssue[];

    try {
      issues = await this.searchAll(
        this.buildJql(year, month, true),
        storyPointsField,
        true,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("resolved") && !/400|JQL/.test(message)) {
        throw error;
      }
      console.warn(
        "JQL resolved-range rejected; falling back to broader search + resolutiondate filter.",
      );
      issues = await this.searchAll(
        this.buildJql(year, month, false),
        storyPointsField,
        true,
      );
    }

    const childKeys = [
      ...new Set(
        issues.flatMap((issue) =>
          (issue.fields.subtasks ?? []).map((stub) => stub.key),
        ),
      ),
    ];

    const childrenByKey = await this.fetchIssuesByKeys(
      childKeys,
      storyPointsField,
    );

    return issues.map((issue) => {
      const stubs = issue.fields.subtasks ?? [];
      const hasSubtasks = stubs.length > 0;
      const selfAssignedChildren = stubs
        .map((stub) => childrenByKey.get(stub.key))
        .filter((child): child is JiraSearchIssue => child != null)
        .filter((child) => child.fields.assignee?.accountId === accountId)
        .map((child) =>
          toLeafCandidate(
            child,
            storyPointsField,
            this.config.baseUrl,
            issue.key,
          ),
        );

      return {
        key: issue.key,
        summary: issue.fields.summary ?? "",
        storyPoints: readStoryPoints(issue.fields, storyPointsField),
        link: `${this.config.baseUrl}/browse/${issue.key}`,
        statusChanges: extractStatusChanges(issue),
        resolutionDate: readResolutionDate(issue.fields),
        hasSubtasks,
        subtasks: selfAssignedChildren,
      };
    });
  }

  private async fetchIssuesByKeys(
    keys: string[],
    storyPointsField: string,
  ): Promise<Map<string, JiraSearchIssue>> {
    const byKey = new Map<string, JiraSearchIssue>();
    if (keys.length === 0) return byKey;

    for (const chunk of chunkKeys(keys, CHILD_CHUNK_SIZE)) {
      const jql = `key in (${chunk.join(",")})`;
      const issues = await this.searchAll(jql, storyPointsField, false);
      for (const issue of issues) {
        byKey.set(issue.key, issue);
      }
    }
    return byKey;
  }

  private async searchAll(
    jql: string,
    storyPointsField: string,
    includeSubtasksField: boolean,
  ): Promise<JiraSearchIssue[]> {
    const collected: JiraSearchIssue[] = [];
    let nextPageToken: string | undefined;
    const maxResults = 50;
    const fields = includeSubtasksField
      ? ["summary", "assignee", "resolutiondate", "subtasks", storyPointsField]
      : ["summary", "assignee", "resolutiondate", storyPointsField];

    try {
      do {
        const body: Record<string, unknown> = {
          jql,
          maxResults,
          fields,
          expand: "changelog",
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const page = await jiraFetch<{
          issues?: JiraSearchIssue[];
          nextPageToken?: string;
          isLast?: boolean;
        }>(this.config, "/rest/api/3/search/jql", {
          method: "POST",
          body: JSON.stringify(body),
        });

        collected.push(...(page.issues ?? []));
        nextPageToken = page.nextPageToken;
        if (page.isLast || !nextPageToken) break;
      } while (true);

      return collected;
    } catch {
      let startAt = 0;
      for (;;) {
        const page = await jiraFetch<{
          issues: JiraSearchIssue[];
          total: number;
          startAt: number;
          maxResults: number;
        }>(this.config, "/rest/api/3/search", {
          method: "POST",
          body: JSON.stringify({
            jql,
            startAt,
            maxResults,
            fields,
            expand: ["changelog"],
          }),
        });
        collected.push(...page.issues);
        startAt += page.issues.length;
        if (startAt >= page.total || page.issues.length === 0) break;
      }
      return collected;
    }
  }
}
