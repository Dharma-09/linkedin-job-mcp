import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * Hard ceilings. Config values above these are clamped down so a typo in
 * config.json can't turn the server into a spam cannon.
 */
export const HARD_LIMITS = {
  invitesPerDay: 25,
  invitesPerWeek: 100,
  followsPerDay: 40,
  pageLoadsPerDay: 300,
  minActionDelayMs: 20_000,
} as const;

const workingHoursSchema = z.object({
  /** Local hour (0-23) at which LinkedIn actions may start. */
  start: z.number().int().min(0).max(23).default(9),
  /** Local hour (1-24) after which LinkedIn actions stop. */
  end: z.number().int().min(1).max(24).default(19),
  /** Allowed weekdays, 0 = Sunday ... 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
});

const profileSchema = z.object({
  /** Skills / technologies you want to match in job descriptions. */
  skills: z.array(z.string()).default([]),
  /** Job titles you are targeting, e.g. "Backend Engineer". */
  targetTitles: z.array(z.string()).default([]),
  /** Preferred locations (substring match against the job location). */
  locations: z.array(z.string()).default([]),
  remoteOk: z.boolean().default(true),
  /** Jobs that don't mention every one of these get a heavy penalty. */
  mustHave: z.array(z.string()).default([]),
  /** Keywords that lower a job's score (e.g. "unpaid", "clearance"). */
  avoidKeywords: z.array(z.string()).default([]),
  /** Companies to hide completely. */
  blockedCompanies: z.array(z.string()).default([]),
  /**
   * Your experience window in years. Jobs whose stated requirement falls
   * outside it are rejected by find_matching_jobs.
   */
  experienceYears: z
    .object({ min: z.number().min(0), max: z.number().min(0) })
    .refine((e) => e.max >= e.min, "experienceYears.max must be >= min")
    .optional(),
  /** Jobs must be located in one of these (e.g. ["Canada"]). Empty = anywhere. */
  requiredLocations: z.array(z.string()).default([]),
  /** Reject jobs whose title contains any of these (e.g. "Senior", "Staff", "Intern"). */
  excludeTitleKeywords: z.array(z.string()).default([]),
  /** Reject jobs that don't state a years-of-experience requirement. */
  strictExperience: z.boolean().default(true),
  /** Minimum score (0-100) for a job to be suggested. */
  minScore: z.number().int().min(0).max(100).default(50),
});

const networkingSchema = z.object({
  /** Only connect with people located in one of these (e.g. ["Canada"]). Empty = anywhere. */
  locations: z.array(z.string()).default([]),
  /** Default note template. Placeholders: {firstName} {name} {company} {headline} {reason}. */
  noteTemplate: z
    .string()
    .default("Hi {firstName}, I came across your profile{reason} and would love to connect."),
  /** Note used for authors of hiring posts. Extra placeholders: {role} {years}. */
  hiringPostNoteTemplate: z
    .string()
    .default(
      "Hi {firstName}, I saw your post about the {role} role on your team. I have {years} years of relevant experience and would love to connect and learn more.",
    ),
  /** Phrases that mark a post as a hiring post. */
  hiringPhrases: z
    .array(z.string())
    .default([
      "we're hiring",
      "we are hiring",
      "my team is hiring",
      "our team is hiring",
      "i'm hiring",
      "i am hiring",
      "is hiring",
      "#hiring",
      "join my team",
      "join our team",
      "looking for a",
      "looking to hire",
      "open role",
      "open position",
      "we have an opening",
      "now hiring",
    ]),
});

const limitsSchema = z.object({
  invitesPerDay: z.number().int().min(0).default(15),
  invitesPerWeek: z.number().int().min(0).default(80),
  followsPerDay: z.number().int().min(0).default(20),
  pageLoadsPerDay: z.number().int().min(0).default(150),
  /** Random delay range between LinkedIn write actions (sending invites). */
  actionDelayMs: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .default([45_000, 120_000]),
  /** Random delay range between LinkedIn page reads. */
  readDelayMs: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .default([3_000, 9_000]),
  /** Max invites sent by a single send_approved_invites call. */
  maxInvitesPerRun: z.number().int().min(1).default(3),
  /** LinkedIn limits custom notes to 300 chars (200 on some free accounts). */
  noteMaxLength: z.number().int().min(1).max(300).default(300),
});

export const configSchema = z.object({
  /** Run the browser without a visible window. Headed is less likely to be flagged. */
  headless: z.boolean().default(false),
  workingHours: workingHoursSchema.default(workingHoursSchema.parse({})),
  profile: profileSchema.default(profileSchema.parse({})),
  networking: networkingSchema.default(networkingSchema.parse({})),
  limits: limitsSchema.default(limitsSchema.parse({})),
});

export type Config = z.infer<typeof configSchema>;
export type Profile = Config["profile"];
export type Limits = Config["limits"];
export type WorkingHours = Config["workingHours"];
export type Networking = Config["networking"];

export interface Paths {
  home: string;
  configFile: string;
  dbFile: string;
  browserProfileDir: string;
}

export function resolvePaths(home = process.env.LINKEDIN_MCP_HOME): Paths {
  const root = home && home.length > 0 ? home : join(homedir(), ".linkedin-job-mcp");
  return {
    home: root,
    configFile: join(root, "config.json"),
    dbFile: join(root, "data.sqlite"),
    browserProfileDir: join(root, "browser-profile"),
  };
}

/** Parses raw config and clamps limits to HARD_LIMITS. */
export function parseConfig(raw: unknown): Config {
  const cfg = configSchema.parse(raw ?? {});
  const l = cfg.limits;
  l.invitesPerDay = Math.min(l.invitesPerDay, HARD_LIMITS.invitesPerDay);
  l.invitesPerWeek = Math.min(l.invitesPerWeek, HARD_LIMITS.invitesPerWeek);
  l.followsPerDay = Math.min(l.followsPerDay, HARD_LIMITS.followsPerDay);
  l.pageLoadsPerDay = Math.min(l.pageLoadsPerDay, HARD_LIMITS.pageLoadsPerDay);
  const lo = Math.max(l.actionDelayMs[0], HARD_LIMITS.minActionDelayMs);
  l.actionDelayMs = [lo, Math.max(lo, l.actionDelayMs[1])];
  l.readDelayMs = [l.readDelayMs[0], Math.max(l.readDelayMs[0], l.readDelayMs[1])];
  return cfg;
}

export function loadConfig(paths: Paths): Config {
  mkdirSync(paths.home, { recursive: true });
  if (!existsSync(paths.configFile)) return parseConfig({});
  return parseConfig(JSON.parse(readFileSync(paths.configFile, "utf8")));
}
