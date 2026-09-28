/**
 * Classifies people by headline into the roles you want to network with.
 */

export const ROLES = {
  recruiter_hr: {
    label: "Recruiter / HR / Talent Acquisition",
    searchKeywords: ["technical recruiter", "talent acquisition", "human resources"],
    pattern:
      /\b(recruit(er|ing|ment)?|talent (acquisition|partner|sourcer|scout)|sourcer|human resources|\bhr\b|hrbp|people (partner|operations|ops)|hiring (lead|partner|specialist))\b/i,
  },
  senior_developer: {
    label: "Senior / Lead Developer",
    searchKeywords: ["senior software developer", "senior software engineer"],
    pattern:
      /\b(senior|sr\.?|staff|lead|principal)\b[^|•,]{0,40}\b(developer|engineer|programmer|architect)\b/i,
  },
  engineering_manager: {
    label: "Engineering / Hiring Manager",
    searchKeywords: ["engineering manager", "software development manager"],
    pattern:
      /\b((engineering|development|software|technical|tech|dev|delivery|product engineering)\s+manager|manager,?\s+(software|engineering|development)|head of (engineering|technology|software)|director,? (of )?(engineering|software|technology)|vp,? (of )?engineering|cto|hiring manager)\b/i,
  },
} as const;

export type Role = keyof typeof ROLES;
export const ROLE_NAMES = Object.keys(ROLES) as Role[];

/** Returns the roles a headline belongs to (may be several, may be none). */
export function rolesOf(headline: string | null | undefined): Role[] {
  if (!headline) return [];
  return ROLE_NAMES.filter((r) => ROLES[r].pattern.test(headline));
}
