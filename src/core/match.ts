import type { Profile } from "../config.js";
import { judgeExperience, type ExperienceVerdict } from "./experience.js";
import { inAnyLocation } from "./geo.js";
import { mentions, scoreJob, titleScore, type ScoreResult } from "./scoring.js";

export interface JobForMatch {
  title: string;
  company: string | null;
  location: string | null;
  description: string;
  postedAt: string | null;
  /** LinkedIn "Seniority level" etc. from the job page. */
  criteria?: Record<string, string>;
}

export interface MatchResult {
  verdict: "match" | "reject";
  score: number;
  /** Every failed check. Empty when verdict is "match". */
  rejections: string[];
  /** Why it matched / how it scored. */
  highlights: string[];
  experience: ExperienceVerdict;
  scoring: ScoreResult;
}

/**
 * Strict job filter. A job is a "match" only if it passes every check:
 * company not blocked, location in requiredLocations, title not excluded and
 * relevant to a target title, experience inside your window, must-haves
 * present, no avoid-keywords, and score >= minScore.
 */
export function evaluateJob(job: JobForMatch, profile: Profile, nowMs = Date.now()): MatchResult {
  const rejections: string[] = [];
  const highlights: string[] = [];
  const scoring = scoreJob(job, profile, nowMs);

  if (scoring.blocked) rejections.push(`blocked company: ${job.company}`);

  if (profile.requiredLocations.length > 0) {
    if (inAnyLocation(job.location, profile.requiredLocations)) {
      highlights.push(`location: ${job.location}`);
    } else {
      rejections.push(`location "${job.location ?? "unknown"}" not in ${profile.requiredLocations.join("/")}`);
    }
  }

  const excluded = profile.excludeTitleKeywords.filter((k) => mentions(job.title, k));
  if (excluded.length > 0) rejections.push(`title contains excluded word(s): ${excluded.join(", ")}`);

  if (profile.targetTitles.length > 0 && titleScore(job.title, profile.targetTitles).points === 0) {
    rejections.push(`title "${job.title}" doesn't match any target title`);
  }

  let experience: ExperienceVerdict = { fit: "unknown" };
  if (profile.experienceYears) {
    const you = profile.experienceYears;
    experience = judgeExperience(job.description, you);
    const want = `${you.min}-${you.max} yrs`;
    if (experience.fit === "match") {
      const req = experience.requiredMax !== null ? `${experience.requiredMin}-${experience.requiredMax}` : `${experience.requiredMin}+`;
      highlights.push(`asks ${req} yrs (you: ${want}): "${experience.evidence}"`);
    } else if (experience.fit === "unknown") {
      const seniority = job.criteria?.["Seniority level"];
      if (profile.strictExperience) {
        rejections.push(`no years-of-experience requirement stated${seniority ? ` (seniority: ${seniority})` : ""}`);
      } else {
        highlights.push(`experience not stated${seniority ? `; seniority: ${seniority}` : ""}`);
      }
    } else {
      const req = experience.requiredMax !== null ? `${experience.requiredMin}-${experience.requiredMax}` : `${experience.requiredMin}+`;
      rejections.push(`${experience.fit.replace("_", " ")}: asks ${req} yrs, you have ${want} ("${experience.evidence}")`);
    }
  }

  if (scoring.missingMustHave.length > 0) rejections.push(`missing must-have: ${scoring.missingMustHave.join(", ")}`);
  if (scoring.avoidHits.length > 0) rejections.push(`contains avoid keyword(s): ${scoring.avoidHits.join(", ")}`);

  if (scoring.matchedSkills.length > 0) highlights.push(`skills: ${scoring.matchedSkills.join(", ")}`);

  if (rejections.length === 0 && scoring.score < profile.minScore) {
    rejections.push(`score ${scoring.score} < minScore ${profile.minScore} (${scoring.reasons.join("; ")})`);
  }

  return {
    verdict: rejections.length === 0 ? "match" : "reject",
    score: scoring.score,
    rejections,
    highlights,
    experience,
    scoring,
  };
}
