import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, type App } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";
import type { HttpGet } from "../src/linkedin/jobs.js";
import type { SendFn } from "../src/app.js";

export const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

/** Wednesday 2026-09-30 11:00 local time: inside default working hours. */
export const WEDNESDAY_11AM = new Date(2026, 8, 30, 11, 0, 0).getTime();

export const CANADA_DEV_PROFILE = {
  skills: ["TypeScript", "Node.js", "PostgreSQL", "AWS", "React"],
  targetTitles: ["Software Developer", "Backend Developer", "Full Stack Developer"],
  requiredLocations: ["Canada"],
  experienceYears: { min: 2, max: 3 },
  excludeTitleKeywords: ["Senior", "Sr", "Staff", "Principal", "Lead", "Intern"],
  minScore: 40,
};

export function testApp(
  opts: {
    config?: unknown;
    http?: HttpGet;
    now?: () => number;
    pages?: (url: string) => string;
    send?: SendFn;
  } = {},
): App & { clock: { t: number }; sent: { profileUrl: string; note: string | null; follow: boolean; dryRun: boolean }[] } {
  const clock = { t: WEDNESDAY_11AM };
  const now = opts.now ?? (() => clock.t);
  const config = parseConfig(opts.config ?? { profile: CANADA_DEV_PROFILE, networking: { locations: ["Canada"] } });
  const repo = new Repo(openDb(":memory:"), now);
  const sent: { profileUrl: string; note: string | null; follow: boolean; dryRun: boolean }[] = [];
  const defaultSend: SendFn = async (person, note, o) => {
    sent.push({ profileUrl: person.profileUrl, note, ...o });
    return { status: "sent", followed: o.follow, dryRun: o.dryRun };
  };
  let appRef: App | undefined;
  const app = createApp({
    paths: { home: "/nonexistent", configFile: "/nonexistent/config.json", dbFile: ":memory:", browserProfileDir: "/nonexistent/b" },
    config,
    repo,
    now,
    sleep: async (ms) => {
      clock.t += ms;
    },
    http: opts.http ?? (async () => ({ status: 500, body: "" })),
    loadAccountPage: async (url) => {
      await appRef!.guard.beforeAccountPageLoad();
      return opts.pages ? opts.pages(url) : "<main></main>";
    },
    withInviteSender: (fn) => fn(opts.send ?? defaultSend),
  });
  appRef = app;
  return Object.assign(app, { clock, sent });
}
