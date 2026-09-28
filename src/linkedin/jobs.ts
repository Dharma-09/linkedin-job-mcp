import { JOBS } from "../browser/selectors.js";
import { parseJobCards, parseJobDetail, type JobCard, type JobDetail } from "./parse.js";
import { jobSearchUrl, type JobSearchParams } from "./urls.js";

/**
 * Job search uses LinkedIn's public guest job pages over plain HTTPS, without
 * your cookies. Browsing jobs this way never touches your account.
 */

export type HttpGet = (url: string) => Promise<{ status: number; body: string }>;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const defaultHttpGet: HttpGet = async (url) => {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9", accept: "text/html" },
  });
  return { status: res.status, body: await res.text() };
};

export class LinkedInHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(
      status === 429
        ? "LinkedIn is rate limiting job requests (HTTP 429). Wait a while before searching again."
        : `LinkedIn returned HTTP ${status} for ${url}`,
    );
    this.name = "LinkedInHttpError";
  }
}

export async function searchJobs(
  params: JobSearchParams,
  limit: number,
  http: HttpGet,
  pause: () => Promise<void>,
): Promise<JobCard[]> {
  const out: JobCard[] = [];
  const seen = new Set<string>();
  // Hard stop so a misbehaving endpoint can't loop forever.
  for (let start = 0; out.length < limit && start < 1000; start += JOBS.pageSize) {
    await pause();
    const url = jobSearchUrl(params, start);
    const res = await http(url);
    // The guest endpoint answers 400 once you page past the last result.
    if (res.status === 400 || res.status === 404) break;
    if (res.status !== 200) throw new LinkedInHttpError(res.status, url);
    const cards = parseJobCards(res.body);
    if (cards.length === 0) break;
    let added = 0;
    for (const c of cards) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      added++;
      if (out.length >= limit) break;
    }
    if (added === 0) break;
  }
  return out;
}

export async function getJobDetail(id: string, http: HttpGet, pause: () => Promise<void>): Promise<JobDetail> {
  await pause();
  const url = JOBS.detailEndpoint(id);
  const res = await http(url);
  if (res.status !== 200) throw new LinkedInHttpError(res.status, url);
  const detail = parseJobDetail(id, res.body);
  if (!detail.title) throw new Error(`Could not parse job ${id}; it may have been removed.`);
  return detail;
}
