import type { Db } from "./index.js";

export const JOB_STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "archived"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  postedAt: string | null;
  description: string | null;
  score: number | null;
  status: JobStatus | null;
  notes: string | null;
}

export interface JobVerdict {
  verdict: "match" | "reject";
  why: unknown;
  evaluatedAt: number;
}

export interface Post {
  id: string;
  url: string;
  authorId: string | null;
  authorName: string | null;
  authorHeadline: string | null;
  text: string;
  jobId: string | null;
  matchWhy: string | null;
  foundAt: number;
}

export interface Person {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  profileUrl: string;
  degree: string | null;
  searchQuery: string | null;
}

export type InviteStatus = "pending" | "approved" | "rejected" | "sent" | "failed";

export interface Invite {
  id: number;
  personId: string;
  note: string | null;
  follow: boolean;
  context: string | null;
  status: InviteStatus;
  error: string | null;
  createdAt: number;
  decidedAt: number | null;
  sentAt: number | null;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toJob(r: Row): Job {
  return {
    id: String(r.id),
    title: String(r.title),
    company: str(r.company),
    location: str(r.location),
    url: String(r.url),
    postedAt: str(r.posted_at),
    description: str(r.description),
    score: num(r.score),
    status: str(r.status) as JobStatus | null,
    notes: str(r.notes),
  };
}

function toPerson(r: Row): Person {
  return {
    id: String(r.id),
    name: String(r.name),
    headline: str(r.headline),
    location: str(r.location),
    profileUrl: String(r.profile_url),
    degree: str(r.degree),
    searchQuery: str(r.search_query),
  };
}

function toPost(r: Row): Post {
  return {
    id: String(r.id),
    url: String(r.url),
    authorId: str(r.author_id),
    authorName: str(r.author_name),
    authorHeadline: str(r.author_headline),
    text: String(r.text),
    jobId: str(r.job_id),
    matchWhy: str(r.match_why),
    foundAt: Number(r.found_at),
  };
}

function toInvite(r: Row): Invite {
  return {
    id: Number(r.id),
    personId: String(r.person_id),
    note: str(r.note),
    follow: Number(r.follow) === 1,
    context: str(r.context),
    status: String(r.status) as InviteStatus,
    error: str(r.error),
    createdAt: Number(r.created_at),
    decidedAt: num(r.decided_at),
    sentAt: num(r.sent_at),
  };
}

export class Repo {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  // ---- jobs -------------------------------------------------------------

  /** Inserts or refreshes a job. Never overwrites tracker fields (status, notes). */
  upsertJob(
    j: Omit<Job, "status" | "notes">,
    source: { source?: "search" | "post" | "manual"; postId?: string } = {},
  ): void {
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, title, company, location, url, posted_at, description, score, source, source_post, first_seen, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           company = excluded.company,
           location = excluded.location,
           url = excluded.url,
           posted_at = COALESCE(excluded.posted_at, jobs.posted_at),
           description = COALESCE(excluded.description, jobs.description),
           score = COALESCE(excluded.score, jobs.score),
           source_post = COALESCE(jobs.source_post, excluded.source_post),
           updated_at = excluded.updated_at`,
      )
      .run(
        j.id,
        j.title,
        j.company,
        j.location,
        j.url,
        j.postedAt,
        j.description,
        j.score,
        source.source ?? "search",
        source.postId ?? null,
        t,
        t,
      );
  }

  setJobVerdict(id: string, verdict: "match" | "reject", why: unknown): void {
    this.db
      .prepare("UPDATE jobs SET verdict = ?, verdict_why = ?, evaluated_at = ? WHERE id = ?")
      .run(verdict, JSON.stringify(why), this.now(), id);
  }

  getJobVerdict(id: string): JobVerdict | undefined {
    const r = this.db.prepare("SELECT verdict, verdict_why, evaluated_at FROM jobs WHERE id = ?").get(id) as
      | Row
      | undefined;
    if (!r || r.verdict === null) return undefined;
    return {
      verdict: String(r.verdict) as "match" | "reject",
      why: r.verdict_why ? JSON.parse(String(r.verdict_why)) : null,
      evaluatedAt: Number(r.evaluated_at),
    };
  }

  /** Matched jobs you haven't acted on yet (no tracker status), best first. */
  listUnreviewedMatches(limit: number): Job[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM jobs WHERE verdict = 'match' AND status IS NULL ORDER BY score DESC, evaluated_at DESC LIMIT ?",
        )
        .all(limit) as Row[]
    ).map(toJob);
  }

  // ---- posts ------------------------------------------------------------

  upsertPost(p: Omit<Post, "foundAt">): void {
    this.db
      .prepare(
        `INSERT INTO posts (id, url, author_id, author_name, author_headline, text, job_id, match_why, found_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           job_id = COALESCE(excluded.job_id, posts.job_id),
           match_why = excluded.match_why`,
      )
      .run(p.id, p.url, p.authorId, p.authorName, p.authorHeadline, p.text, p.jobId, p.matchWhy, this.now());
  }

  getPost(id: string): Post | undefined {
    const r = this.db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined;
    return r ? toPost(r) : undefined;
  }

  listPosts(limit: number): Post[] {
    return (this.db.prepare("SELECT * FROM posts ORDER BY found_at DESC LIMIT ?").all(limit) as Row[]).map(toPost);
  }

  getJob(id: string): Job | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return r ? toJob(r) : undefined;
  }

  setJobStatus(id: string, status: JobStatus, notes?: string): Job | undefined {
    const res = this.db
      .prepare("UPDATE jobs SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?")
      .run(status, notes ?? null, this.now(), id);
    return res.changes > 0 ? this.getJob(id) : undefined;
  }

  listTrackedJobs(status?: JobStatus): Job[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC").all(status)
      : this.db.prepare("SELECT * FROM jobs WHERE status IS NOT NULL ORDER BY updated_at DESC").all();
    return (rows as Row[]).map(toJob);
  }

  // ---- people -----------------------------------------------------------

  upsertPerson(p: Person): void {
    this.db
      .prepare(
        `INSERT INTO people (id, name, headline, location, profile_url, degree, search_query, first_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           headline = COALESCE(excluded.headline, people.headline),
           location = COALESCE(excluded.location, people.location),
           profile_url = excluded.profile_url,
           degree = COALESCE(excluded.degree, people.degree)`,
      )
      .run(p.id, p.name, p.headline, p.location, p.profileUrl, p.degree, p.searchQuery, this.now());
  }

  getPerson(id: string): Person | undefined {
    const r = this.db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Row | undefined;
    return r ? toPerson(r) : undefined;
  }

  // ---- invites ----------------------------------------------------------

  insertInvite(personId: string, note: string | null, opts: { follow?: boolean; context?: string } = {}): Invite {
    const res = this.db
      .prepare(
        "INSERT INTO invites (person_id, note, follow, context, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      )
      .run(personId, note, opts.follow ? 1 : 0, opts.context ?? null, this.now());
    return this.getInvite(Number(res.lastInsertRowid))!;
  }

  getInvite(id: number): Invite | undefined {
    const r = this.db.prepare("SELECT * FROM invites WHERE id = ?").get(id) as Row | undefined;
    return r ? toInvite(r) : undefined;
  }

  /** The invite for this person that is still in play (pending, approved or sent), if any. */
  activeInviteFor(personId: string): Invite | undefined {
    const r = this.db
      .prepare(
        "SELECT * FROM invites WHERE person_id = ? AND status IN ('pending','approved','sent') ORDER BY id DESC LIMIT 1",
      )
      .get(personId) as Row | undefined;
    return r ? toInvite(r) : undefined;
  }

  listInvites(status?: InviteStatus, limit = 100): Invite[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM invites WHERE status = ? ORDER BY id ASC LIMIT ?").all(status, limit)
      : this.db.prepare("SELECT * FROM invites ORDER BY id DESC LIMIT ?").all(limit);
    return (rows as Row[]).map(toInvite);
  }

  updateInvite(
    id: number,
    fields: { status: InviteStatus; error?: string | null; note?: string | null; decided?: boolean; sent?: boolean },
  ): void {
    const t = this.now();
    this.db
      .prepare(
        `UPDATE invites SET
           status = ?,
           error = ?,
           note = CASE WHEN ? THEN ? ELSE note END,
           decided_at = CASE WHEN ? THEN ? ELSE decided_at END,
           sent_at = CASE WHEN ? THEN ? ELSE sent_at END
         WHERE id = ?`,
      )
      .run(
        fields.status,
        fields.error ?? null,
        fields.note !== undefined ? 1 : 0,
        fields.note ?? null,
        fields.decided ? 1 : 0,
        t,
        fields.sent ? 1 : 0,
        t,
        id,
      );
  }

  countInvites(): Record<InviteStatus, number> {
    const out: Record<InviteStatus, number> = { pending: 0, approved: 0, rejected: 0, sent: 0, failed: 0 };
    for (const r of this.db.prepare("SELECT status, COUNT(*) AS n FROM invites GROUP BY status").all() as Row[]) {
      out[String(r.status) as InviteStatus] = Number(r.n);
    }
    return out;
  }

  // ---- action log -------------------------------------------------------

  logAction(type: string, detail?: string): void {
    this.db.prepare("INSERT INTO actions (type, detail, created_at) VALUES (?, ?, ?)").run(type, detail ?? null, this.now());
  }

  countActionsSince(type: string, sinceMs: number): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM actions WHERE type = ? AND created_at >= ?")
      .get(type, sinceMs) as Row;
    return Number(r.n);
  }

  // ---- key/value --------------------------------------------------------

  getKv(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  deleteKv(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
}
