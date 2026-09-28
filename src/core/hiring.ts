import type { Networking, Profile } from "../config.js";
import { inAnyLocation } from "./geo.js";
import { mentions } from "./scoring.js";

export interface PostForMatch {
  text: string;
  authorHeadline: string | null;
  /** Location of the linked job, when the post links one. */
  jobLocation?: string | null;
}

export interface HiringPostVerdict {
  isMatch: boolean;
  hiringPhrase: string | null;
  roleHits: string[];
  locationOk: boolean;
  reasons: string[];
}

/**
 * A post qualifies when it (1) reads like a hiring announcement, (2) is about
 * a role you want (target title or skill words), and (3) is in one of your
 * networking locations, judged from the post text, the author's headline or
 * the linked job's location.
 */
export function judgeHiringPost(post: PostForMatch, profile: Profile, networking: Networking): HiringPostVerdict {
  const text = post.text;
  const lower = text.toLowerCase();
  const reasons: string[] = [];

  const hiringPhrase = networking.hiringPhrases.find((p) => lower.includes(p.toLowerCase())) ?? null;
  if (!hiringPhrase) reasons.push("no hiring phrase");

  const titleWords = profile.targetTitles.filter((t) => mentions(text, t));
  // Also accept the core noun of a title ("Backend Developer" -> "developer").
  const nouns = [...new Set(profile.targetTitles.map((t) => t.trim().split(/\s+/).pop() ?? ""))].filter(Boolean);
  const nounHits = nouns.filter((n) => mentions(text, n));
  const skillHits = profile.skills.filter((s) => mentions(text, s));
  const roleHits = [...new Set([...titleWords, ...(titleWords.length ? [] : nounHits), ...skillHits])];
  const needsRole = profile.targetTitles.length > 0 || profile.skills.length > 0;
  if (needsRole && roleHits.length === 0) reasons.push("not about a role you target");

  const locs = networking.locations.length > 0 ? networking.locations : profile.requiredLocations;
  const locationOk =
    locs.length === 0 ||
    inAnyLocation(text, locs) ||
    inAnyLocation(post.jobLocation ?? null, locs) ||
    inAnyLocation(post.authorHeadline, locs);
  if (!locationOk) reasons.push(`no sign it's in ${locs.join("/")}`);

  return {
    isMatch: reasons.length === 0,
    hiringPhrase,
    roleHits,
    locationOk,
    reasons,
  };
}
