import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { App } from "./app.js";
import { decideInvites, draftInvites } from "./core/invites.js";
import { usage, withinWorkingHours } from "./core/ratelimit.js";
import { ROLE_NAMES, ROLES } from "./core/roles.js";
import { JOB_STATUSES, type InviteStatus } from "./db/repo.js";
import { getJobDetail } from "./linkedin/jobs.js";
import { jobIdFrom, DATE_POSTED, EXPERIENCE, WORKPLACE, POST_DATE, NETWORK } from "./linkedin/urls.js";
import { evaluateDetail, findMatchingJobs, recordJob } from "./workflows/jobs.js";
import { findHiringPosts, findPeople, sendApprovedInvites } from "./workflows/network.js";

async function run(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
}

const enumKeys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

function parseJobRef(ref: string): string {
  const id = jobIdFrom(ref);
  if (!id) throw new Error(`Not a LinkedIn job id or URL: ${ref}`);
  return id;
}

export function registerTools(server: McpServer, app: App): void {
  const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
  const LOCAL = { readOnlyHint: false, openWorldHint: false, destructiveHint: false } as const;

  // ---------------------------------------------------------------- jobs

  server.registerTool(
    "find_matching_jobs",
    {
      title: "Find jobs that pass all your criteria",
      description:
        "Strict job finder. Searches LinkedIn's public job listings, drops jobs whose card already fails " +
        "(location, excluded title words, blocked company, off-target title), then OPENS AND READS each remaining " +
        "description and checks years-of-experience against your window, must-have/avoid keywords and score. " +
        "Returns only the few jobs that pass everything (default 5), plus a summary of why others were dropped. " +
        "Jobs already evaluated in earlier runs are skipped so you never see the same one twice. " +
        "Uses the public guest job pages only; does not touch your LinkedIn account.",
      inputSchema: {
        keywords: z.array(z.string().min(1)).min(1).describe('Search phrases, e.g. ["software developer", "backend developer"]'),
        location: z.string().optional().describe("Defaults to profile.requiredLocations[0] (e.g. Canada)"),
        datePosted: z.enum(enumKeys(DATE_POSTED)).optional().describe("Default: week"),
        workplace: z.array(z.enum(enumKeys(WORKPLACE))).optional(),
        experience: z
          .array(z.enum(enumKeys(EXPERIENCE)))
          .optional()
          .describe("LinkedIn's own seniority filter (coarse). Years are checked from the description regardless."),
        maxResults: z.number().int().min(1).max(20).optional().describe("Stop after this many matches (default 5)"),
        maxCandidates: z.number().int().min(1).max(60).optional().describe("Max descriptions to read (default 25)"),
        includeSeen: z.boolean().optional().describe("Re-check jobs evaluated in earlier runs"),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => findMatchingJobs(app, args)),
  );

  server.registerTool(
    "get_job_details",
    {
      title: "Read one job and check it against your criteria",
      description: "Fetches a job's full description (by id or URL) and shows whether it meets your criteria and why.",
      inputSchema: { job: z.string().describe("LinkedIn job id or URL") },
      annotations: READ_ONLY,
    },
    ({ job }) =>
      run(async () => {
        const detail = await getJobDetail(parseJobRef(job), app.http, () => app.guard.readPause());
        const result = evaluateDetail(app, detail);
        recordJob(app, detail, undefined, result, { source: "manual" });
        return {
          ...detail,
          verdict: result.verdict,
          score: result.score,
          rejections: result.rejections,
          highlights: result.highlights,
        };
      }),
  );

  server.registerTool(
    "list_job_matches",
    {
      title: "Matched jobs you haven't reviewed",
      description: "Jobs that passed every check in earlier find_matching_jobs runs and that you haven't saved or dismissed yet.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit }) =>
      run(() =>
        app.repo.listUnreviewedMatches(limit ?? 10).map(({ description: _d, ...j }) => ({
          ...j,
          why: app.repo.getJobVerdict(j.id)?.why,
        })),
      ),
  );

  server.registerTool(
    "save_job",
    {
      title: "Save / update a job in your tracker",
      description: `Sets a job's tracker status (${JOB_STATUSES.join(", ")}) and optional notes. Fetches the job first if it's new. Use status "archived" to dismiss a suggested match.`,
      inputSchema: {
        job: z.string().describe("LinkedIn job id or URL"),
        status: z.enum(JOB_STATUSES).optional().describe("Default: saved"),
        notes: z.string().optional(),
      },
      annotations: LOCAL,
    },
    ({ job, status, notes }) =>
      run(async () => {
        const id = parseJobRef(job);
        if (!app.repo.getJob(id)) {
          const detail = await getJobDetail(id, app.http, () => app.guard.readPause());
          recordJob(app, detail, undefined, evaluateDetail(app, detail), { source: "manual" });
        }
        const { description: _d, ...saved } = app.repo.setJobStatus(id, status ?? "saved", notes)!;
        return saved;
      }),
  );

  server.registerTool(
    "list_saved_jobs",
    {
      title: "List your tracked jobs",
      description: "Jobs in your tracker, optionally filtered by status.",
      inputSchema: { status: z.enum(JOB_STATUSES).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ status }) => run(() => app.repo.listTrackedJobs(status).map(({ description: _d, ...j }) => j)),
  );

  // -------------------------------------------------------------- people

  server.registerTool(
    "find_people",
    {
      title: "Find recruiters, senior developers or managers",
      description:
        "Searches LinkedIn people (with your logged-in session) for the given roles and keeps only people whose " +
        "headline matches the role AND whose location is in your networking area (default: profile/networking " +
        `locations, e.g. Canada). Roles: ${ROLE_NAMES.map((r) => `${r} = ${ROLES[r].label}`).join("; ")}. ` +
        "Found people are stored so you can draft connection requests for them. Nothing is sent.",
      inputSchema: {
        roles: z.array(z.enum(ROLE_NAMES as [string, ...string[]])).optional(),
        keywords: z.string().optional().describe("Extra keywords, e.g. a tech stack"),
        company: z.string().optional().describe("Company name to narrow the search"),
        location: z.string().optional().describe("Overrides networking.locations"),
        network: z.array(z.enum(enumKeys(NETWORK))).optional().describe("Default: second, third"),
        pagesPerSearch: z.number().int().min(1).max(3).optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => findPeople(app, { ...args, roles: args.roles as (typeof ROLE_NAMES)[number][] | undefined })),
  );

  server.registerTool(
    "find_hiring_posts",
    {
      title: "Find 'my team is hiring' posts",
      description:
        "Searches recent LinkedIn posts for hiring announcements about your target roles in your location. " +
        "For each matching post it: (1) notes the post down, (2) saves the linked job opening to your tracker and " +
        "checks it against your criteria, (3) queues a follow + connection request to the author as PENDING. " +
        "Nothing is sent until you approve with approve_invites and run send_approved_invites.",
      inputSchema: {
        keywords: z.array(z.string()).optional().describe('Default: ["hiring <first target title> <location>", ...]'),
        datePosted: z.enum(enumKeys(POST_DATE)).optional().describe("Default: week"),
        pages: z.number().int().min(1).max(3).optional(),
        queueInvites: z.boolean().optional().describe("Default: true"),
        noteTemplate: z
          .string()
          .optional()
          .describe("Placeholders: {firstName} {name} {company} {role} {years}. Default: networking.hiringPostNoteTemplate"),
        includeSeen: z.boolean().optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => findHiringPosts(app, args)),
  );

  server.registerTool(
    "list_hiring_posts",
    {
      title: "Hiring posts you've collected",
      description: "Hiring posts noted down by find_hiring_posts (matching ones by default).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        includeNonMatching: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit, includeNonMatching }) =>
      run(() =>
        app.repo
          .listPosts(limit ?? 25)
          .map((p) => ({ ...p, verdict: p.matchWhy ? JSON.parse(p.matchWhy) : null }))
          .filter((p) => includeNonMatching || p.verdict?.isMatch)
          .map(({ matchWhy: _m, text, ...p }) => ({ ...p, excerpt: text.slice(0, 280) })),
      ),
  );

  // ------------------------------------------------------------- invites

  server.registerTool(
    "draft_connection_requests",
    {
      title: "Queue connection requests (pending your approval)",
      description:
        "Queues connection requests for people found by find_people. Give a personalised note per person, or a " +
        "template ({firstName} {name} {company} {headline} {reason}). Notes over the length limit are rejected. " +
        "Everything is queued as PENDING; nothing is sent.",
      inputSchema: {
        people: z
          .array(z.object({ personId: z.string(), note: z.string().optional() }))
          .min(1)
          .describe("personId = the id returned by find_people"),
        template: z.string().optional().describe("Default: networking.noteTemplate"),
        reason: z.string().optional().describe("Fills {reason} in the template"),
        follow: z.boolean().optional().describe("Also follow them when sending (default false)"),
      },
      annotations: LOCAL,
    },
    ({ people, template, reason, follow }) =>
      run(() =>
        draftInvites(app.repo, people, {
          template: template ?? app.config.networking.noteTemplate,
          vars: { reason },
          noteMaxLength: app.config.limits.noteMaxLength,
          follow,
        }),
      ),
  );

  server.registerTool(
    "list_invites",
    {
      title: "Review the invite queue",
      description: "Lists queued connection requests with the person and note. Default: pending (awaiting your decision).",
      inputSchema: {
        status: z.enum(["pending", "approved", "rejected", "sent", "failed"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ status, limit }) =>
      run(() =>
        app.repo.listInvites((status ?? "pending") as InviteStatus, limit ?? 50).map((inv) => {
          const p = app.repo.getPerson(inv.personId);
          return { ...inv, name: p?.name, headline: p?.headline, location: p?.location, profileUrl: p?.profileUrl };
        }),
      ),
  );

  server.registerTool(
    "approve_invites",
    {
      title: "Approve queued invites",
      description:
        "Marks invites as approved so send_approved_invites may send them. Only call this with ids the user " +
        "explicitly approved. Optionally edit notes (empty string = no note).",
      inputSchema: {
        ids: z.array(z.number().int()).min(1),
        notes: z.record(z.string(), z.string()).optional().describe('Edited notes keyed by invite id, e.g. {"12": "Hi ..."}'),
      },
      annotations: LOCAL,
    },
    ({ ids, notes }) =>
      run(() =>
        decideInvites(
          app.repo,
          ids,
          "approved",
          Object.fromEntries(Object.entries(notes ?? {}).map(([k, v]) => [Number(k), v])),
          app.config.limits.noteMaxLength,
        ),
      ),
  );

  server.registerTool(
    "reject_invites",
    {
      title: "Reject queued invites",
      description: "Marks invites as rejected. They will never be sent.",
      inputSchema: { ids: z.array(z.number().int()).min(1) },
      annotations: LOCAL,
    },
    ({ ids }) => run(() => decideInvites(app.repo, ids, "rejected")),
  );

  server.registerTool(
    "send_approved_invites",
    {
      title: "Send approved invites",
      description:
        "Sends APPROVED connection requests (and follows, where requested) one at a time from your logged-in " +
        "browser, with 45-120 s human-like gaps, inside working hours and daily/weekly caps. Stops immediately " +
        "on any security check. Sends at most limits.maxInvitesPerRun per call. dryRun=true opens each profile " +
        "and checks the Connect button without sending.",
      inputSchema: {
        max: z.number().int().min(1).max(10).optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    (args) => run(() => sendApprovedInvites(app, args)),
  );

  // -------------------------------------------------------------- status

  server.registerTool(
    "get_status",
    {
      title: "Limits, queue and session status",
      description: "Today's usage vs caps, invite queue counts, working-hours state and halt state.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(() => {
        const now = app.now();
        return {
          usage: usage(app.repo, app.config.limits, now),
          limits: app.config.limits,
          withinWorkingHours: withinWorkingHours(app.config.workingHours, now),
          workingHours: app.config.workingHours,
          halted: app.guard.haltReason() ?? false,
          invites: app.repo.countInvites(),
          dataDir: app.paths.home,
        };
      }),
  );

  server.registerTool(
    "resume_automation",
    {
      title: "Clear a safety halt",
      description:
        "Clears the halt set after LinkedIn showed a security check / restriction / invite-limit page. Only call " +
        "after the user confirms they've opened LinkedIn manually and everything looks normal.",
      inputSchema: {},
      annotations: LOCAL,
    },
    () => run(() => ({ cleared: app.guard.clearHalt() ?? "nothing to clear" })),
  );
}
