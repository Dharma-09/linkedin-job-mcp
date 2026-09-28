import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { judgeHiringPost } from "../src/core/hiring.js";
import { evaluateJob } from "../src/core/match.js";
import { CANADA_DEV_PROFILE, WEDNESDAY_11AM } from "./helpers.js";

const cfg = parseConfig({ profile: CANADA_DEV_PROFILE, networking: { locations: ["Canada"] } });
const base = {
  title: "Software Developer",
  company: "Maple Tech",
  location: "Toronto, Ontario, Canada",
  postedAt: "2026-09-28",
  description: "We want 2-3 years of experience with TypeScript, Node.js and PostgreSQL on AWS.",
};

describe("evaluateJob", () => {
  it("matches a Canadian 2-3 year developer role", () => {
    const r = evaluateJob(base, cfg.profile, WEDNESDAY_11AM);
    expect(r.rejections).toEqual([]);
    expect(r.verdict).toBe("match");
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("rejects jobs outside Canada", () => {
    const r = evaluateJob({ ...base, location: "Seattle, WA" }, cfg.profile, WEDNESDAY_11AM);
    expect(r.verdict).toBe("reject");
    expect(r.rejections[0]).toMatch(/^location/);
  });

  it("rejects senior titles and senior asks", () => {
    expect(evaluateJob({ ...base, title: "Senior Software Developer" }, cfg.profile, WEDNESDAY_11AM).verdict).toBe("reject");
    const r = evaluateJob({ ...base, description: "5+ years of experience with TypeScript" }, cfg.profile, WEDNESDAY_11AM);
    expect(r.rejections.some((x) => x.startsWith("too senior"))).toBe(true);
  });

  it("rejects when experience isn't stated (strict mode)", () => {
    const r = evaluateJob({ ...base, description: "TypeScript, Node.js, AWS. Great team." }, cfg.profile, WEDNESDAY_11AM);
    expect(r.rejections.some((x) => x.startsWith("no years"))).toBe(true);
  });

  it("allows unstated experience when strictExperience is off", () => {
    const loose = parseConfig({ profile: { ...CANADA_DEV_PROFILE, strictExperience: false } });
    const r = evaluateJob({ ...base, description: "TypeScript, Node.js, AWS, PostgreSQL. Great team." }, loose.profile, WEDNESDAY_11AM);
    expect(r.verdict).toBe("match");
  });

  it("rejects blocked companies", () => {
    const p = parseConfig({ profile: { ...CANADA_DEV_PROFILE, blockedCompanies: ["Maple Tech"] } }).profile;
    expect(evaluateJob(base, p, WEDNESDAY_11AM).rejections).toContain("blocked company: Maple Tech");
  });
});

describe("judgeHiringPost", () => {
  it("accepts a Canadian hiring post for a target role", () => {
    const v = judgeHiringPost(
      { text: "My team is hiring a Software Developer in Toronto!", authorHeadline: "Engineering Manager" },
      cfg.profile,
      cfg.networking,
    );
    expect(v.isMatch).toBe(true);
    expect(v.roleHits).toContain("Software Developer");
  });

  it("uses the linked job's location when the text has none", () => {
    const v = judgeHiringPost(
      { text: "We're hiring a backend developer, apply below", authorHeadline: null, jobLocation: "Ottawa, Ontario, Canada" },
      cfg.profile,
      cfg.networking,
    );
    expect(v.isMatch).toBe(true);
  });

  it("rejects non-hiring, off-role or non-Canadian posts", () => {
    const j = (text: string) => judgeHiringPost({ text, authorHeadline: null }, cfg.profile, cfg.networking);
    expect(j("Started a new position as Software Developer in Toronto").reasons).toContain("no hiring phrase");
    expect(j("We're hiring a marketing lead in Toronto").reasons).toContain("not about a role you target");
    expect(j("We're hiring a software developer in Austin, TX").reasons.some((r) => r.includes("Canada"))).toBe(true);
  });
});
