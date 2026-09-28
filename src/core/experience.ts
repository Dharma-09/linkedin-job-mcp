/**
 * Pulls "years of experience" requirements out of a job description.
 *
 * Handles: "2+ years", "2 - 4 years", "3 to 5 yrs", "minimum of 4 years",
 * "at least two years", "5 years of professional experience".
 */

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
};

const NUM = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)`;
const YRS = String.raw`(?:years?|yrs?)`;

const toNum = (s: string): number => WORD_NUMBERS[s.toLowerCase()] ?? Number(s);

export interface ExperienceRequirement {
  min: number;
  max: number | null;
  /** The sentence fragment it came from, for explaining decisions. */
  evidence: string;
}

const PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => { min: number; max: number | null } }[] = [
  // "2-4 years", "2 to 4 yrs", "2–4+ years"
  { re: new RegExp(String.raw`\b${NUM}\s*(?:-|–|—|to)\s*${NUM}\s*\+?\s*${YRS}`, "gi"), build: (m) => ({ min: toNum(m[1]), max: toNum(m[2]) }) },
  // "minimum of 3 years", "at least 3 years", "min. 3 yrs"
  { re: new RegExp(String.raw`\b(?:minimum(?: of)?|at least|min\.?)\s*${NUM}\s*\+?\s*${YRS}`, "gi"), build: (m) => ({ min: toNum(m[1]), max: null }) },
  // "3+ years", "3 plus years"
  { re: new RegExp(String.raw`\b${NUM}\s*(?:\+|plus)\s*${YRS}`, "gi"), build: (m) => ({ min: toNum(m[1]), max: null }) },
  // "3 years of experience", "3 years' experience", "3 years in"
  {
    re: new RegExp(String.raw`\b${NUM}\s*${YRS}(?:['’])?\s+(?:of\s+)?(?:[a-z-]+\s+){0,3}(?:experience|exp\b|in\b|working|developing|building)`, "gi"),
    build: (m) => ({ min: toNum(m[1]), max: null }),
  },
];

/** Ignore numbers that clearly aren't experience asks ("company founded 20 years ago"). */
const NOT_EXPERIENCE = /\b(founded|ago|old|anniversary|history|warranty|contract|term|parental|leave|retirement)\b/i;

export function extractExperience(text: string): ExperienceRequirement[] {
  const out: ExperienceRequirement[] = [];
  const taken: [number, number][] = [];
  for (const { re, build } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const ctx = text.slice(Math.max(0, start - 60), Math.min(text.length, end + 60));
      if (NOT_EXPERIENCE.test(ctx) && !/experience/i.test(ctx)) continue;
      const r = build(m);
      if (!(r.min >= 0 && r.min <= 25)) continue;
      if (r.max !== null && r.max < r.min) continue;
      taken.push([start, end]);
      out.push({ ...r, evidence: ctx.replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

export type ExperienceVerdict =
  | { fit: "match"; requiredMin: number; requiredMax: number | null; evidence: string }
  | { fit: "too_senior" | "too_junior"; requiredMin: number; requiredMax: number | null; evidence: string }
  | { fit: "unknown" };

/**
 * Compares a job's requirement against your experience window.
 *
 * The job's *headline* requirement is the largest minimum it states (a posting
 * saying "5+ years Java, 2+ years AWS" is a 5-year job).
 *  - too_senior: that minimum is above your max.
 *  - too_junior: the job tops out below your min (e.g. "0-1 years").
 */
export function judgeExperience(text: string, you: { min: number; max: number }): ExperienceVerdict {
  const reqs = extractExperience(text);
  if (reqs.length === 0) return { fit: "unknown" };
  const main = reqs.reduce((a, b) => (b.min > a.min ? b : a));
  const base = { requiredMin: main.min, requiredMax: main.max, evidence: main.evidence };
  if (main.min > you.max) return { fit: "too_senior", ...base };
  if (main.max !== null && main.max < you.min) return { fit: "too_junior", ...base };
  return { fit: "match", ...base };
}
