import type { App } from "../app.js";
import { geoIdFor, inAnyLocation } from "../core/geo.js";
import { evaluateJob, type MatchResult } from "../core/match.js";
import { mentions, titleScore } from "../core/scoring.js";
import { getJobDetail, searchJobs } from "../linkedin/jobs.js";
import type { JobCard, JobDetail } from "../linkedin/parse.js";
import type { DATE_POSTED, JobSearchParams, WORKPLACE, EXPERIENCE } from "../linkedin/urls.js";

export interface FindJobsParams {
  keywords: string[];
  location?: string;
  datePosted?: keyof typeof DATE_POSTED;
  workplace?: (keyof typeof WORKPLACE)[];
  experience?: (keyof typeof EXPERIENCE)[];
  /** Max job descriptions to open and read. */
  maxCandidates?: number;
  /** Stop once this many jobs pass every check. */
  maxResults?: number;
  /** Re-evaluate jobs you've already been shown or that were rejected before. */
  includeSeen?: boolean;
}

export interface JobMatch {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  postedText: string | null;
  salary: string | null;
  score: number;
  why: string[];
}

export interface FindJobsResult {
  matches: JobMatch[];
  stats: {
    listed: number;
    alreadySeen: number;
    rejectedFromListing: number;
    descriptionsRead: number;
    rejectedAfterReading: number;
  };
  /** Rejection reasons, grouped and counted (e.g. "too senior": 7). */
  rejectionSummary: Record<string, number>;
}

/** Groups a rejection message into a short bucket name. */
export function rejectionBucket(msg: string): string {
  if (msg.startsWith("location")) return "wrong location";
  if (msg.startsWith("title contains")) return "excluded title word";
  if (msg.startsWith("title ")) return "title not a target";
  if (msg.startsWith("too senior")) return "too senior";
  if (msg.startsWith("too junior")) return "too junior";
  if (msg.startsWith("no years")) return "experience not stated";
  if (msg.startsWith("missing must-have")) return "missing must-have";
  if (msg.startsWith("contains avoid")) return "avoid keyword";
  if (msg.startsWith("blocked")) return "blocked company";
  if (msg.startsWith("score")) return "low score";
  return "other";
}

/** Cheap checks on the search card, so we only open descriptions worth reading. */
export function prefilterCard(card: JobCard, app: App): string[] {
  const p = app.config.profile;
  const out: string[] = [];
  if (p.blockedCompanies.some((b) => card.company && mentions(card.company, b))) out.push(`blocked company: ${card.company}`);
  if (p.requiredLocations.length > 0 && !inAnyLocation(card.location, p.requiredLocations)) {
    out.push(`location "${card.location ?? "unknown"}" not in ${p.requiredLocations.join("/")}`);
  }
  const excluded = p.excludeTitleKeywords.filter((k) => mentions(card.title, k));
  if (excluded.length > 0) out.push(`title contains excluded word(s): ${excluded.join(", ")}`);
  if (p.targetTitles.length > 0 && titleScore(card.title, p.targetTitles).points === 0) {
    out.push(`title "${card.title}" doesn't match any target title`);
  }
  return out;
}

export function evaluateDetail(app: App, detail: JobDetail, card?: JobCard): MatchResult {
  return evaluateJob(
    {
      title: detail.title || card?.title || "",
      company: detail.company ?? card?.company ?? null,
      location: detail.location ?? card?.location ?? null,
      description: detail.description,
      postedAt: card?.postedAt ?? null,
      criteria: detail.criteria,
    },
    app.config.profile,
    app.now(),
  );
}

/** Stores a job + its verdict. Returns the stored score. */
export function recordJob(
  app: App,
  detail: JobDetail,
  card: JobCard | undefined,
  result: MatchResult,
  source: { source?: "search" | "post" | "manual"; postId?: string } = {},
): void {
  app.repo.upsertJob(
    {
      id: detail.id,
      title: detail.title || card?.title || "",
      company: detail.company ?? card?.company ?? null,
      location: detail.location ?? card?.location ?? null,
      url: detail.url,
      postedAt: card?.postedAt ?? null,
      description: detail.description,
      score: result.score,
    },
    source,
  );
  app.repo.setJobVerdict(detail.id, result.verdict, { rejections: result.rejections, highlights: result.highlights });
}

/**
 * The strict pipeline: search -> cheap card filter -> read each description ->
 * full criteria check -> return only the few jobs that pass everything.
 */
export async function findMatchingJobs(app: App, params: FindJobsParams): Promise<FindJobsResult> {
  const p = app.config.profile;
  const maxCandidates = params.maxCandidates ?? 25;
  const maxResults = params.maxResults ?? 5;
  const location = params.location ?? p.requiredLocations[0];
  const pause = () => app.guard.readPause();

  const stats = { listed: 0, alreadySeen: 0, rejectedFromListing: 0, descriptionsRead: 0, rejectedAfterReading: 0 };
  const rejectionSummary: Record<string, number> = {};
  const bump = (msgs: string[]) => {
    for (const b of new Set(msgs.map(rejectionBucket))) rejectionSummary[b] = (rejectionSummary[b] ?? 0) + 1;
  };

  // 1. Gather candidates from every keyword search.
  const cards = new Map<string, JobCard>();
  for (const kw of params.keywords) {
    const search: JobSearchParams = {
      keywords: kw,
      location,
      geoId: location ? geoIdFor(location) : undefined,
      datePosted: params.datePosted ?? "week",
      workplace: params.workplace,
      experience: params.experience,
      sortBy: "recent",
    };
    for (const c of await searchJobs(search, maxCandidates * 2, app.http, pause)) {
      if (!cards.has(c.id)) cards.set(c.id, c);
    }
  }
  stats.listed = cards.size;

  // 2. Cheap filters on the listing card.
  const toRead: JobCard[] = [];
  for (const card of cards.values()) {
    if (!params.includeSeen && app.repo.getJobVerdict(card.id)) {
      stats.alreadySeen++;
      continue;
    }
    const pre = prefilterCard(card, app);
    if (pre.length > 0) {
      stats.rejectedFromListing++;
      bump(pre);
      continue;
    }
    toRead.push(card);
  }

  // 3. Read descriptions one at a time until we have enough matches.
  const matches: JobMatch[] = [];
  for (const card of toRead) {
    if (matches.length >= maxResults || stats.descriptionsRead >= maxCandidates) break;
    const detail = await getJobDetail(card.id, app.http, pause);
    stats.descriptionsRead++;
    const result = evaluateDetail(app, detail, card);
    recordJob(app, detail, card, result);
    if (result.verdict === "reject") {
      stats.rejectedAfterReading++;
      bump(result.rejections);
      continue;
    }
    matches.push({
      id: detail.id,
      title: detail.title || card.title,
      company: detail.company ?? card.company,
      location: detail.location ?? card.location,
      url: detail.url,
      postedText: card.postedText ?? detail.postedText,
      salary: card.salary ?? detail.salary,
      score: result.score,
      why: result.highlights,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return { matches, stats, rejectionSummary };
}
