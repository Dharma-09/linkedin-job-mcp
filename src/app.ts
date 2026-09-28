import { loadConfig, resolvePaths, type Config, type Paths } from "./config.js";
import { openDb } from "./db/index.js";
import { Repo } from "./db/repo.js";
import { Guard, realSleep, type Sleep } from "./browser/guard.js";
import { BrowserSession } from "./browser/session.js";
import { defaultHttpGet, type HttpGet } from "./linkedin/jobs.js";
import { loadAccountPage } from "./linkedin/account.js";
import { sendInvite, type SendOutcome } from "./linkedin/connect.js";

/** Loads a logged-in page (through the Guard) and returns its HTML. */
export type AccountPageLoader = (url: string, readySelector: string) => Promise<string>;

export type SendFn = (
  person: { profileUrl: string; name: string },
  note: string | null,
  opts: { follow: boolean; dryRun: boolean },
) => Promise<SendOutcome>;

/** Runs fn with a sender bound to one browser tab. */
export type InviteSession = <T>(fn: (send: SendFn) => Promise<T>) => Promise<T>;

/** Everything a tool handler needs. Built once at startup; swappable in tests. */
export interface App {
  paths: Paths;
  config: Config;
  repo: Repo;
  guard: Guard;
  session: BrowserSession;
  http: HttpGet;
  loadAccountPage: AccountPageLoader;
  withInviteSender: InviteSession;
  now: () => number;
  sleep: Sleep;
}

export function createApp(overrides: Partial<App> = {}): App {
  const paths = overrides.paths ?? resolvePaths();
  const config = overrides.config ?? loadConfig(paths);
  const now = overrides.now ?? Date.now;
  const sleep = overrides.sleep ?? realSleep;
  const repo = overrides.repo ?? new Repo(openDb(paths.dbFile), now);
  const guard = overrides.guard ?? new Guard(repo, config, now, sleep);
  const session = overrides.session ?? new BrowserSession(paths, config);
  return {
    paths,
    config,
    repo,
    now,
    sleep,
    guard,
    session,
    http: overrides.http ?? defaultHttpGet,
    loadAccountPage:
      overrides.loadAccountPage ?? ((url, ready) => loadAccountPage(session, guard, url, ready)),
    withInviteSender:
      overrides.withInviteSender ??
      (<T>(fn: (send: SendFn) => Promise<T>) =>
        session.withPage((page) => fn((person, note, opts) => sendInvite(page, person, note, opts)))),
  };
}
