import type { Profile } from "../config.js";

export interface ScoreInput {
  title: string;
  company: string | null;
  location: string | null;
  description: string | null;
  /** ISO date (YYYY-MM-DD or full timestamp) the job was posted. */
  postedAt: string | null;
}

export interface ScoreResult {
  /** 0-100. Blocked companies always score 0. */
  score: number;
  blocked: boolean;
  matchedSkills: string[];
  missingMustHave: string[];
  avoidHits: string[];
  reasons: string[];
}

const norm = (s: string) => s.toLowerCase();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive match that also works for terms like "C++" or "Node.js". */
export function mentions(haystack: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(norm(t))}($|[^a-z0-9])`, "i").test(norm(haystack));
}

export function titleScore(title: string, targets: string[]): { points: number; reason?: string } {
  if (targets.length === 0) return { points: 15 };
  let best = 0;
  let bestTarget = "";
  for (const target of targets) {
    const words = norm(target).split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const hit = words.filter((w) => mentions(title, w)).length / words.length;
    if (hit > best) {
      best = hit;
      bestTarget = target;
    }
  }
  const points = Math.round(best * 30);
  return { points, reason: best > 0 ? `title ~ "${bestTarget}" (${Math.round(best * 100)}%)` : "title matches no target" };
}

function locationScore(location: string | null, text: string, p: Profile): { points: number; reason: string } {
  const loc = location ?? "";
  const isRemote = /\bremote\b/i.test(loc) || /\b(fully|100%) remote\b/i.test(text);
  if (p.remoteOk && isRemote) return { points: 15, reason: "remote" };
  if (p.locations.length === 0) return { points: 10, reason: "no location preference" };
  const hit = p.locations.find((l) => norm(loc).includes(norm(l)));
  return hit ? { points: 15, reason: `location ~ ${hit}` } : { points: 0, reason: "location not preferred" };
}

function recencyScore(postedAt: string | null, nowMs: number): number {
  if (!postedAt) return 5;
  const t = Date.parse(postedAt);
  if (Number.isNaN(t)) return 5;
  const days = (nowMs - t) / 86_400_000;
  if (days <= 3) return 15;
  if (days <= 7) return 12;
  if (days <= 14) return 8;
  if (days <= 30) return 4;
  return 0;
}

export function scoreJob(job: ScoreInput, profile: Profile, nowMs = Date.now()): ScoreResult {
  const company = job.company ?? "";
  if (profile.blockedCompanies.some((b) => norm(company) === norm(b) || mentions(company, b))) {
    return { score: 0, blocked: true, matchedSkills: [], missingMustHave: [], avoidHits: [], reasons: ["blocked company"] };
  }

  const text = `${job.title}\n${job.description ?? ""}`;
  const reasons: string[] = [];

  const t = titleScore(job.title, profile.targetTitles);
  if (t.reason) reasons.push(t.reason);

  const matchedSkills = profile.skills.filter((s) => mentions(text, s));
  // Without a description we only see the title; don't punish that too hard.
  const skillPoints =
    profile.skills.length === 0
      ? 20
      : Math.round((matchedSkills.length / profile.skills.length) * (job.description ? 40 : 25));
  reasons.push(`skills ${matchedSkills.length}/${profile.skills.length}`);

  const loc = locationScore(job.location, text, profile);
  reasons.push(loc.reason);

  const recency = recencyScore(job.postedAt, nowMs);

  let score = t.points + skillPoints + loc.points + recency;

  const missingMustHave = job.description ? profile.mustHave.filter((m) => !mentions(text, m)) : [];
  if (missingMustHave.length > 0) {
    score -= 25;
    reasons.push(`missing must-have: ${missingMustHave.join(", ")}`);
  }

  const avoidHits = profile.avoidKeywords.filter((k) => mentions(text, k));
  if (avoidHits.length > 0) {
    score -= 15 * avoidHits.length;
    reasons.push(`avoid keywords: ${avoidHits.join(", ")}`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    blocked: false,
    matchedSkills,
    missingMustHave,
    avoidHits,
    reasons,
  };
}
