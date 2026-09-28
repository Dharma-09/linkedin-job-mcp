import { JOBS, LINKEDIN_ORIGIN, PEOPLE, POSTS } from "../browser/selectors.js";

export const DATE_POSTED = { any: "", day: "r86400", week: "r604800", month: "r2592000" } as const;
export const WORKPLACE = { onsite: "1", remote: "2", hybrid: "3" } as const;
export const EXPERIENCE = {
  internship: "1",
  entry: "2",
  associate: "3",
  mid_senior: "4",
  director: "5",
  executive: "6",
} as const;
export const JOB_TYPE = {
  full_time: "F",
  part_time: "P",
  contract: "C",
  temporary: "T",
  internship: "I",
} as const;

export interface JobSearchParams {
  keywords: string;
  location?: string;
  /** LinkedIn geo id; more precise than free-text location (see core/geo.ts). */
  geoId?: string;
  datePosted?: keyof typeof DATE_POSTED;
  workplace?: (keyof typeof WORKPLACE)[];
  experience?: (keyof typeof EXPERIENCE)[];
  jobType?: (keyof typeof JOB_TYPE)[];
  easyApply?: boolean;
  sortBy?: "relevance" | "recent";
}

export function jobSearchUrl(p: JobSearchParams, start = 0): string {
  const u = new URL(JOBS.searchEndpoint);
  u.searchParams.set("keywords", p.keywords);
  if (p.location) u.searchParams.set("location", p.location);
  if (p.geoId) u.searchParams.set("geoId", p.geoId);
  const tpr = p.datePosted ? DATE_POSTED[p.datePosted] : "";
  if (tpr) u.searchParams.set("f_TPR", tpr);
  if (p.workplace?.length) u.searchParams.set("f_WT", p.workplace.map((w) => WORKPLACE[w]).join(","));
  if (p.experience?.length) u.searchParams.set("f_E", p.experience.map((e) => EXPERIENCE[e]).join(","));
  if (p.jobType?.length) u.searchParams.set("f_JT", p.jobType.map((j) => JOB_TYPE[j]).join(","));
  if (p.easyApply) u.searchParams.set("f_AL", "true");
  if (p.sortBy === "recent") u.searchParams.set("sortBy", "DD");
  u.searchParams.set("start", String(start));
  return u.toString();
}

export const NETWORK = { first: "F", second: "S", third: "O" } as const;

export interface PeopleSearchParams {
  keywords: string;
  /** Free-text title filter, e.g. "technical recruiter". */
  title?: string;
  /** Free-text company filter, e.g. "Acme". */
  company?: string;
  network?: (keyof typeof NETWORK)[];
  /** LinkedIn geo ids (e.g. Canada = 101174742). */
  geoIds?: string[];
  page?: number;
}

export function peopleSearchUrl(p: PeopleSearchParams): string {
  const u = new URL(PEOPLE.searchUrl);
  u.searchParams.set("keywords", p.keywords);
  if (p.title) u.searchParams.set("titleFreeText", p.title);
  if (p.company) u.searchParams.set("company", p.company);
  if (p.network?.length) u.searchParams.set("network", JSON.stringify(p.network.map((n) => NETWORK[n])));
  if (p.geoIds?.length) u.searchParams.set("geoUrn", JSON.stringify(p.geoIds));
  if (p.page && p.page > 1) u.searchParams.set("page", String(p.page));
  u.searchParams.set("origin", "FACETED_SEARCH");
  return u.toString();
}

/** Extracts the public profile slug from any linkedin.com/in/<slug> URL. */
export function profileSlug(href: string): string | null {
  const m = href.match(/\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function profileUrl(slug: string): string {
  return `${LINKEDIN_ORIGIN}/in/${encodeURIComponent(slug)}/`;
}

/** Extracts the numeric job id from a job URL, URN or bare id. */
export function jobIdFrom(input: string): string | null {
  const s = input.trim();
  if (/^\d{6,}$/.test(s)) return s;
  const m =
    s.match(/jobPosting:(\d+)/) ??
    s.match(/currentJobId=(\d+)/) ??
    s.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
  return m ? m[1] : null;
}

export const POST_DATE = { day: "past-24h", week: "past-week", month: "past-month" } as const;

export interface PostSearchParams {
  keywords: string;
  datePosted?: keyof typeof POST_DATE;
  page?: number;
}

export function postSearchUrl(p: PostSearchParams): string {
  const u = new URL(POSTS.searchUrl);
  u.searchParams.set("keywords", p.keywords);
  u.searchParams.set("datePosted", JSON.stringify(POST_DATE[p.datePosted ?? "week"]));
  u.searchParams.set("sortBy", JSON.stringify("date_posted"));
  if (p.page && p.page > 1) u.searchParams.set("page", String(p.page));
  u.searchParams.set("origin", "FACETED_SEARCH");
  return u.toString();
}
