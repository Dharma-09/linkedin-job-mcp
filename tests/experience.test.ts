import { describe, expect, it } from "vitest";
import { extractExperience, judgeExperience } from "../src/core/experience.js";

const you = { min: 2, max: 3 };

describe("extractExperience", () => {
  it.each([
    ["2-3 years of experience", 2, 3],
    ["2 to 4 yrs building APIs", 2, 4],
    ["3+ years of experience with Java", 3, null],
    ["minimum of 4 years in software", 4, null],
    ["at least two years experience", 2, null],
    ["5 years of professional experience", 5, null],
    ["1–2 years experience", 1, 2],
  ])("%s", (text, min, max) => {
    const [r] = extractExperience(text);
    expect(r).toMatchObject({ min, max });
  });

  it("ignores non-experience numbers", () => {
    expect(extractExperience("Founded 20 years ago, we have 3 offices")).toEqual([]);
  });
});

describe("judgeExperience", () => {
  it("matches a 2-3 year ask", () => {
    expect(judgeExperience("Requires 2-3 years of experience", you).fit).toBe("match");
  });
  it("matches a 1+ ask", () => {
    expect(judgeExperience("1+ years of experience", you).fit).toBe("match");
  });
  it("uses the largest minimum as the real requirement", () => {
    const v = judgeExperience("5+ years of experience with TypeScript. 1+ years with AWS.", you);
    expect(v.fit).toBe("too_senior");
  });
  it("flags roles that top out below your range", () => {
    expect(judgeExperience("0-1 years of experience", you).fit).toBe("too_junior");
  });
  it("returns unknown when nothing is stated", () => {
    expect(judgeExperience("Great team, great culture", you).fit).toBe("unknown");
  });
});
