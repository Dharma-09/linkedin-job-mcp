import { describe, expect, it } from "vitest";
import { parseConfig, HARD_LIMITS } from "../src/config.js";
import { ACTION_INVITE_SENT, SafetyBlock, usage, withinWorkingHours } from "../src/core/ratelimit.js";
import { testApp, WEDNESDAY_11AM } from "./helpers.js";

describe("config", () => {
  it("clamps limits to hard ceilings", () => {
    const c = parseConfig({ limits: { invitesPerDay: 500, invitesPerWeek: 9999, actionDelayMs: [0, 10] } });
    expect(c.limits.invitesPerDay).toBe(HARD_LIMITS.invitesPerDay);
    expect(c.limits.invitesPerWeek).toBe(HARD_LIMITS.invitesPerWeek);
    expect(c.limits.actionDelayMs[0]).toBe(HARD_LIMITS.minActionDelayMs);
  });
  it("has safe defaults", () => {
    const c = parseConfig({});
    expect(c.limits).toMatchObject({ invitesPerDay: 15, invitesPerWeek: 80, maxInvitesPerRun: 3 });
  });
});

describe("working hours", () => {
  const wh = parseConfig({}).workingHours;
  it("is open on a weekday morning", () => expect(withinWorkingHours(wh, WEDNESDAY_11AM)).toBe(true));
  it("is closed at night and at weekends", () => {
    expect(withinWorkingHours(wh, new Date(2026, 8, 30, 23, 0).getTime())).toBe(false);
    expect(withinWorkingHours(wh, new Date(2026, 9, 3, 11, 0).getTime())).toBe(false); // Saturday
  });
});

describe("Guard", () => {
  it("enforces the daily invite cap", () => {
    const app = testApp();
    for (let i = 0; i < 15; i++) app.repo.logAction(ACTION_INVITE_SENT, `p${i}`);
    expect(usage(app.repo, app.config.limits, app.now()).invitesRemainingToday).toBe(0);
    expect(() => app.guard.assertCanInvite()).toThrow(SafetyBlock);
  });

  it("blocks everything while halted, until cleared", async () => {
    const app = testApp();
    app.guard.halt("checkpoint", "test");
    await expect(app.guard.beforeAccountPageLoad()).rejects.toThrow(/halted/);
    expect(() => app.guard.assertCanInvite()).toThrow(/halted/);
    expect(app.guard.clearHalt()).toMatch(/checkpoint/);
    await expect(app.guard.beforeAccountPageLoad()).resolves.toBeUndefined();
  });

  it("refuses account actions outside working hours", async () => {
    const app = testApp();
    app.clock.t = new Date(2026, 8, 30, 22, 0).getTime();
    await expect(app.guard.beforeAccountPageLoad()).rejects.toThrow(/working hours/);
  });

  it("paces consecutive reads", async () => {
    const app = testApp();
    const t0 = app.clock.t;
    await app.guard.readPause();
    await app.guard.readPause();
    expect(app.clock.t - t0).toBeGreaterThanOrEqual(app.config.limits.readDelayMs[0]);
  });
});
