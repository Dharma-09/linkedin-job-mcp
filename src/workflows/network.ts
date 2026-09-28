import type { App } from "../app.js";
import { draftInvites } from "../core/invites.js";
import { geoIdFor, inAnyLocation } from "../core/geo.js";
import { judgeHiringPost, type HiringPostVerdict } from "../core/hiring.js";
import { ACTION_FOLLOW, ACTION_INVITE_SENT, SafetyBlock, usage } from "../core/ratelimit.js";
import { ROLES, rolesOf, type Role } from "../core/roles.js";
import type { Invite } from "../db/repo.js";
import { POSTS } from "../browser/selectors.js";
import { getJobDetail } from "../linkedin/jobs.js";
import { parsePeopleResults, parsePosts, type PersonResult } from "../linkedin/parse.js";
import { peopleSearchUrl, postSearchUrl, type NETWORK, type POST_DATE } from "../linkedin/urls.js";
import { evaluateDetail, recordJob } from "./jobs.js";

function networkLocations(app: App, override?: string): string[] {
  if (override) return [override];
  const n = app.config.networking.locations;
  return n.length > 0 ? n : app.config.profile.requiredLocations;
}

function yearsText(app: App): string {
  const e = app.config.profile.experienceYears;
  if (!e) return "";
  return e.min === e.max ? `${e.min}` : `${e.min}-${e.max}`;
}

// ---- people ---------------------------------------------------------------

export interface FindPeopleParams {
  roles?: Role[];
  keywords?: string;
  company?: string;
  location?: string;
  network?: (keyof typeof NETWORK)[];
  pagesPerSearch?: number;
}

export interface FindPeopleResult {
  people: (PersonResult & { roles: Role[] })[];
  rejected: { name: string; headline: string | null; location: string | null; reason: string }[];
}

/**
 * People search with strict post-filters: the person's headline must match one
 * of the requested roles, and their location must be in your networking area.
 */
export async function findPeople(app: App, params: FindPeopleParams): Promise<FindPeopleResult> {
  const locs = networkLocations(app, params.location);
  const geoIds = locs.map(geoIdFor).filter((g): g is string => Boolean(g));
  const roles = params.roles ?? [];
  if (roles.length === 0 && !params.keywords) throw new Error("Give at least one role or some keywords.");

  const searches =
    roles.length > 0
      ? roles.map((r) => ({ role: r as Role | undefined, keywords: [ROLES[r].searchKeywords[0], params.keywords].filter(Boolean).join(" ") }))
      : [{ role: undefined, keywords: params.keywords! }];

  const found = new Map<string, PersonResult>();
  for (const s of searches) {
    for (let page = 1; page <= (params.pagesPerSearch ?? 1); page++) {
      const url = peopleSearchUrl({
        keywords: s.keywords,
        company: params.company,
        network: params.network ?? ["second", "third"],
        geoIds,
        page,
      });
      const res = parsePeopleResults(await app.loadAccountPage(url, "main a[href*='/in/']"));
      for (const r of res) if (!found.has(r.id)) found.set(r.id, r);
      if (res.length === 0) break;
    }
  }

  const out: FindPeopleResult = { people: [], rejected: [] };
  for (const person of found.values()) {
    const personRoles = rolesOf(person.headline);
    let reason = "";
    if (roles.length > 0 && !personRoles.some((r) => roles.includes(r))) reason = "headline doesn't match requested roles";
    else if (locs.length > 0 && !inAnyLocation(person.location, locs)) reason = `location "${person.location ?? "unknown"}" not in ${locs.join("/")}`;
    else if (person.degree === "1st") reason = "already connected";
    if (reason) {
      out.rejected.push({ name: person.name, headline: person.headline, location: person.location, reason });
      continue;
    }
    app.repo.upsertPerson({ ...person, searchQuery: searches.map((s) => s.keywords).join(" | ") });
    out.people.push({ ...person, roles: personRoles });
  }
  return out;
}

// ---- hiring posts ---------------------------------------------------------

export interface FindHiringPostsParams {
  keywords?: string[];
  datePosted?: keyof typeof POST_DATE;
  pages?: number;
  /** Queue a (pending, needs approval) follow + connect for each matching author. */
  queueInvites?: boolean;
  noteTemplate?: string;
  includeSeen?: boolean;
}

export interface HiringPostMatch {
  postUrl: string;
  author: string | null;
  authorHeadline: string | null;
  excerpt: string;
  role: string;
  job: { id: string; title: string; location: string | null; url: string; meetsCriteria: boolean; why: string[] } | null;
  invite: { id: number; note: string | null } | { skipped: string } | null;
}

export interface FindHiringPostsResult {
  matches: HiringPostMatch[];
  scanned: number;
  alreadySeen: number;
  notMatching: { postUrl: string; author: string | null; reasons: string[] }[];
}

/**
 * Finds "my team is hiring" posts that fit your target roles and location.
 * For each: notes the post down, saves the linked job (status "saved"), and
 * queues a follow + connection request to the author as *pending*.
 */
export async function findHiringPosts(app: App, params: FindHiringPostsParams): Promise<FindHiringPostsResult> {
  const { profile, networking } = app.config;
  const locs = networkLocations(app);
  const firstTitle = profile.targetTitles[0] ?? "developer";
  const keywords = params.keywords?.length
    ? params.keywords
    : [`hiring ${firstTitle}${locs[0] ? ` ${locs[0]}` : ""}`, `"my team is hiring" ${firstTitle}`];

  const out: FindHiringPostsResult = { matches: [], scanned: 0, alreadySeen: 0, notMatching: [] };
  const seenThisRun = new Set<string>();

  for (const kw of keywords) {
    for (let page = 1; page <= (params.pages ?? 1); page++) {
      const url = postSearchUrl({ keywords: kw, datePosted: params.datePosted ?? "week", page });
      const posts = parsePosts(await app.loadAccountPage(url, POSTS.container));
      if (posts.length === 0) break;
      for (const post of posts) {
        if (seenThisRun.has(post.id)) continue;
        seenThisRun.add(post.id);
        out.scanned++;
        if (!params.includeSeen && app.repo.getPost(post.id)) {
          out.alreadySeen++;
          continue;
        }

        // Linked job (guest page; doesn't touch your account).
        let job: HiringPostMatch["job"] = null;
        const jobId = post.jobIds[0];
        if (jobId) {
          try {
            const detail = await getJobDetail(jobId, app.http, () => app.guard.readPause());
            const result = evaluateDetail(app, detail);
            recordJob(app, detail, undefined, result, { source: "post", postId: post.id });
            job = {
              id: detail.id,
              title: detail.title,
              location: detail.location,
              url: detail.url,
              meetsCriteria: result.verdict === "match",
              why: result.verdict === "match" ? result.highlights : result.rejections,
            };
          } catch {
            job = null;
          }
        }

        const verdict: HiringPostVerdict = judgeHiringPost(
          { text: post.text, authorHeadline: post.authorHeadline, jobLocation: job?.location },
          profile,
          networking,
        );
        app.repo.upsertPost({
          id: post.id,
          url: post.url,
          authorId: post.authorId,
          authorName: post.authorName,
          authorHeadline: post.authorHeadline,
          text: post.text,
          jobId: job?.id ?? null,
          matchWhy: JSON.stringify(verdict),
        });

        if (!verdict.isMatch) {
          out.notMatching.push({ postUrl: post.url, author: post.authorName, reasons: verdict.reasons });
          continue;
        }

        const role = job?.title ?? verdict.roleHits[0] ?? "open";
        if (job && !app.repo.getJob(job.id)?.status) {
          app.repo.setJobStatus(job.id, "saved", `From hiring post by ${post.authorName ?? "unknown"}: ${post.url}`);
        }

        let invite: HiringPostMatch["invite"] = null;
        if ((params.queueInvites ?? true) && post.authorKind === "person" && post.authorId && post.authorName) {
          app.repo.upsertPerson({
            id: post.authorId,
            name: post.authorName,
            headline: post.authorHeadline,
            location: null,
            profileUrl: post.authorProfileUrl!,
            degree: null,
            searchQuery: `hiring post ${post.url}`,
          });
          const drafted = draftInvites(app.repo, [{ personId: post.authorId }], {
            template: params.noteTemplate ?? networking.hiringPostNoteTemplate,
            vars: { role, years: yearsText(app) },
            noteMaxLength: app.config.limits.noteMaxLength,
            follow: true,
            context: `hiring post: ${post.url}`,
          });
          invite = drafted.queued[0]
            ? { id: drafted.queued[0].id, note: drafted.queued[0].note }
            : { skipped: drafted.skipped[0]?.reason ?? "not queued" };
        } else if (post.authorKind !== "person") {
          invite = { skipped: "author is a company page" };
        }

        out.matches.push({
          postUrl: post.url,
          author: post.authorName,
          authorHeadline: post.authorHeadline,
          excerpt: post.text.slice(0, 280),
          role,
          job,
          invite,
        });
      }
    }
  }
  return out;
}

// ---- sending --------------------------------------------------------------

export interface SendResult {
  dryRun: boolean;
  results: { inviteId: number; person: string; outcome: string; followed: boolean }[];
  stoppedBecause?: string;
  remainingToday: number;
}

/** Sends approved invites (and follows) one by one, within caps and pacing. */
export async function sendApprovedInvites(app: App, params: { max?: number; dryRun?: boolean }): Promise<SendResult> {
  const dryRun = params.dryRun ?? false;
  const limits = app.config.limits;
  const remaining = dryRun ? Infinity : app.guard.assertCanInvite();
  if (dryRun) {
    app.guard.assertNotHalted();
    app.guard.assertWorkingHours();
  }
  const max = Math.min(params.max ?? limits.maxInvitesPerRun, limits.maxInvitesPerRun, remaining);
  const queue: Invite[] = app.repo.listInvites("approved", max);
  const out: SendResult = { dryRun, results: [], remainingToday: 0 };

  if (queue.length > 0) {
    await app.withInviteSender(async (send) => {
      for (let i = 0; i < queue.length; i++) {
        const inv = queue[i];
        const person = app.repo.getPerson(inv.personId);
        if (!person) {
          app.repo.updateInvite(inv.id, { status: "failed", error: "person record missing" });
          continue;
        }
        if (i > 0 && !dryRun) await app.guard.actionPause();
        try {
          await app.guard.beforeAccountPageLoad();
          if (!dryRun) app.guard.assertCanInvite();
        } catch (e) {
          if (e instanceof SafetyBlock) {
            out.stoppedBecause = e.message;
            break;
          }
          throw e;
        }

        const u = usage(app.repo, limits, app.now());
        const follow = inv.follow && u.followsRemainingToday > 0;
        const res = await send(person, inv.note, { follow, dryRun });

        if (res.followed && follow && !dryRun) app.repo.logAction(ACTION_FOLLOW, person.id);

        let outcome: string;
        if (res.status === "sent") {
          outcome = dryRun ? "dry run: Connect button found, nothing sent" : "sent";
          if (!dryRun) {
            app.repo.updateInvite(inv.id, { status: "sent", sent: true });
            app.repo.logAction(ACTION_INVITE_SENT, person.id);
          }
        } else if (res.status === "skipped") {
          outcome = `skipped: ${res.reason}`;
          if (!dryRun) app.repo.updateInvite(inv.id, { status: "sent", error: res.reason, sent: true });
        } else if (res.status === "failed") {
          outcome = `failed: ${res.reason}`;
          if (!dryRun) app.repo.updateInvite(inv.id, { status: "failed", error: res.reason });
        } else {
          outcome = `stopped: LinkedIn showed a ${res.state} page`;
          if (res.state !== "logged_out") app.guard.halt(res.state, `while sending invite #${inv.id} to ${person.profileUrl}`);
          out.results.push({ inviteId: inv.id, person: person.name, outcome, followed: res.followed });
          out.stoppedBecause =
            res.state === "logged_out" ? "Not logged in. Run `linkedin-job-mcp login`." : `Automation halted (${res.state}).`;
          break;
        }
        out.results.push({ inviteId: inv.id, person: person.name, outcome, followed: res.followed });
      }
    });
  }

  out.remainingToday = usage(app.repo, limits, app.now()).invitesRemainingToday;
  return out;
}
