import type { Config } from "../config.js";
import type { Repo } from "../db/repo.js";
import {
  ACTION_PAGE_LOAD,
  SafetyBlock,
  usage,
  withinWorkingHours,
} from "../core/ratelimit.js";
import type { PageState } from "./selectors.js";

const HALT_KEY = "halted";

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function randomBetween([lo, hi]: readonly [number, number], rnd = Math.random): number {
  return Math.round(lo + (hi - lo) * rnd());
}

/**
 * Central gate for everything that touches LinkedIn with your account:
 * halt flag, working hours, daily caps and human-like pacing.
 */
export class Guard {
  private lastReadAt = 0;

  constructor(
    private readonly repo: Repo,
    private readonly config: Config,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
    private readonly rnd: () => number = Math.random,
  ) {}

  haltReason(): string | undefined {
    return this.repo.getKv(HALT_KEY);
  }

  halt(state: PageState | string, detail: string): void {
    const reason = `${state}: ${detail} (at ${new Date(this.now()).toISOString()})`;
    this.repo.setKv(HALT_KEY, reason);
    this.repo.logAction("halt", reason);
  }

  clearHalt(): string | undefined {
    const prev = this.haltReason();
    this.repo.deleteKv(HALT_KEY);
    if (prev) this.repo.logAction("halt_cleared", prev);
    return prev;
  }

  assertNotHalted(): void {
    const reason = this.haltReason();
    if (reason) {
      throw new SafetyBlock(
        `LinkedIn automation is halted: ${reason}. Open LinkedIn in your normal browser, resolve any ` +
          `security check, then run the resume_automation tool.`,
      );
    }
  }

  assertWorkingHours(): void {
    const wh = this.config.workingHours;
    if (!withinWorkingHours(wh, this.now())) {
      throw new SafetyBlock(
        `Outside configured working hours (${wh.start}:00-${wh.end}:00 on days ${wh.days.join(",")}). ` +
          `LinkedIn actions with your account only run inside that window.`,
      );
    }
  }

  /** Call before every logged-in page load. Waits for pacing, then records the load. */
  async beforeAccountPageLoad(): Promise<void> {
    this.assertNotHalted();
    this.assertWorkingHours();
    const u = usage(this.repo, this.config.limits, this.now());
    if (u.pageLoadsRemainingToday <= 0) {
      throw new SafetyBlock(`Daily page-load cap reached (${this.config.limits.pageLoadsPerDay}). Try again tomorrow.`);
    }
    await this.readPause();
    this.repo.logAction(ACTION_PAGE_LOAD);
  }

  /** Pacing for any read (guest or logged in). */
  async readPause(): Promise<void> {
    const wait = randomBetween(this.config.limits.readDelayMs, this.rnd) - (this.now() - this.lastReadAt);
    if (this.lastReadAt > 0 && wait > 0) await this.sleep(wait);
    this.lastReadAt = this.now();
  }

  /** Throws unless at least one more invite may be sent right now. Returns how many remain today. */
  assertCanInvite(): number {
    this.assertNotHalted();
    this.assertWorkingHours();
    const u = usage(this.repo, this.config.limits, this.now());
    if (u.invitesRemainingToday <= 0) {
      throw new SafetyBlock(
        `Invite cap reached: ${u.invitesToday}/${this.config.limits.invitesPerDay} today, ` +
          `${u.invitesThisWeek}/${this.config.limits.invitesPerWeek} in the last 7 days.`,
      );
    }
    return u.invitesRemainingToday;
  }

  async actionPause(): Promise<void> {
    await this.sleep(randomBetween(this.config.limits.actionDelayMs, this.rnd));
  }
}
