import type { Limits, WorkingHours } from "../config.js";
import type { Repo } from "../db/repo.js";

export const ACTION_INVITE_SENT = "invite_sent";
export const ACTION_PAGE_LOAD = "page_load";
export const ACTION_FOLLOW = "follow";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface Usage {
  invitesToday: number;
  invitesThisWeek: number;
  pageLoadsToday: number;
  followsToday: number;
  followsRemainingToday: number;
  invitesRemainingToday: number;
  pageLoadsRemainingToday: number;
}

export function usage(repo: Repo, limits: Limits, nowMs: number): Usage {
  const dayStart = startOfLocalDay(nowMs);
  const invitesToday = repo.countActionsSince(ACTION_INVITE_SENT, dayStart);
  const invitesThisWeek = repo.countActionsSince(ACTION_INVITE_SENT, nowMs - WEEK_MS);
  const pageLoadsToday = repo.countActionsSince(ACTION_PAGE_LOAD, dayStart);
  const followsToday = repo.countActionsSince(ACTION_FOLLOW, dayStart);
  return {
    invitesToday,
    invitesThisWeek,
    pageLoadsToday,
    followsToday,
    followsRemainingToday: Math.max(0, limits.followsPerDay - followsToday),
    invitesRemainingToday: Math.max(
      0,
      Math.min(limits.invitesPerDay - invitesToday, limits.invitesPerWeek - invitesThisWeek),
    ),
    pageLoadsRemainingToday: Math.max(0, limits.pageLoadsPerDay - pageLoadsToday),
  };
}

export function withinWorkingHours(wh: WorkingHours, nowMs: number): boolean {
  const d = new Date(nowMs);
  const h = d.getHours();
  return wh.days.includes(d.getDay()) && h >= wh.start && h < wh.end;
}

/** Thrown when a safety rule blocks a LinkedIn action. Surfaced to the MCP client as a tool error. */
export class SafetyBlock extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyBlock";
  }
}
