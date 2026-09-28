import type { Invite, InviteStatus, Person, Repo } from "../db/repo.js";

/**
 * Allowed invite status transitions. Only the human-facing tools move an
 * invite out of "pending"; only the sender moves it to "sent"/"failed".
 *
 *   pending  -> approved | rejected
 *   approved -> rejected (changed your mind) | sent | failed
 *   rejected -> pending  (reopen)
 *   failed   -> approved (retry) | rejected
 *   sent     -> (terminal)
 */
const TRANSITIONS: Record<InviteStatus, InviteStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["rejected", "sent", "failed"],
  rejected: ["pending"],
  failed: ["approved", "rejected"],
  sent: [],
};

export function canTransition(from: InviteStatus, to: InviteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TemplateVars {
  firstName: string;
  name: string;
  headline: string;
  company: string;
  reason: string;
  /** Role the person is hiring for (hiring-post invites). */
  role: string;
  /** Your experience, e.g. "2-3". */
  years: string;
}

/** Best-effort company from a headline like "Senior Engineer at Acme" or "Recruiter @ Acme | ...". */
export function companyFromHeadline(headline: string | null): string {
  if (!headline) return "";
  const m = headline.match(/\s(?:at|@)\s+([^|,•·]+)/i);
  return m ? m[1].trim() : "";
}

export function templateVars(
  person: Person,
  extra: { reason?: string; role?: string; years?: string } = {},
): TemplateVars {
  return {
    firstName: person.name.split(/\s+/)[0] ?? person.name,
    name: person.name,
    headline: person.headline ?? "",
    company: companyFromHeadline(person.headline),
    reason: extra.reason ?? "",
    role: extra.role ?? "open",
    years: extra.years ?? "",
  };
}

/** Renders "{firstName}"-style placeholders. Unknown placeholders are left as-is. */
export function renderNote(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{(\w+)\}/g, (whole, key: string) =>
      key in vars ? String(vars[key as keyof TemplateVars]) : whole,
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface DraftInput {
  personId: string;
  /** Explicit note for this person. Takes precedence over the template. */
  note?: string;
}

export interface DraftResult {
  queued: Invite[];
  skipped: { personId: string; reason: string }[];
}

export function draftInvites(
  repo: Repo,
  items: DraftInput[],
  opts: {
    template?: string;
    vars?: { reason?: string; role?: string; years?: string };
    noteMaxLength: number;
    follow?: boolean;
    context?: string;
  },
): DraftResult {
  const out: DraftResult = { queued: [], skipped: [] };
  for (const item of items) {
    const person = repo.getPerson(item.personId);
    if (!person) {
      out.skipped.push({ personId: item.personId, reason: "unknown person id (run search_people first)" });
      continue;
    }
    if (person.degree === "1st") {
      out.skipped.push({ personId: item.personId, reason: "already a 1st-degree connection" });
      continue;
    }
    const existing = repo.activeInviteFor(person.id);
    if (existing) {
      out.skipped.push({ personId: item.personId, reason: `already has invite #${existing.id} (${existing.status})` });
      continue;
    }
    const raw = item.note ?? (opts.template ? renderNote(opts.template, templateVars(person, opts.vars)) : "");
    const note = raw.trim();
    if (note.length > opts.noteMaxLength) {
      out.skipped.push({
        personId: item.personId,
        reason: `note is ${note.length} chars; limit is ${opts.noteMaxLength}`,
      });
      continue;
    }
    out.queued.push(
      repo.insertInvite(person.id, note.length > 0 ? note : null, { follow: opts.follow, context: opts.context }),
    );
  }
  return out;
}

export interface DecisionResult {
  updated: number[];
  errors: { id: number; reason: string }[];
}

export function decideInvites(
  repo: Repo,
  ids: number[],
  to: "approved" | "rejected" | "pending",
  noteEdits: Record<number, string> = {},
  noteMaxLength = 300,
): DecisionResult {
  const out: DecisionResult = { updated: [], errors: [] };
  for (const id of ids) {
    const inv = repo.getInvite(id);
    if (!inv) {
      out.errors.push({ id, reason: "not found" });
      continue;
    }
    if (!canTransition(inv.status, to)) {
      out.errors.push({ id, reason: `cannot go from ${inv.status} to ${to}` });
      continue;
    }
    if (to !== "rejected") {
      const other = repo.activeInviteFor(inv.personId);
      if (other && other.id !== id) {
        out.errors.push({ id, reason: `person already has invite #${other.id} (${other.status})` });
        continue;
      }
    }
    const edited = noteEdits[id];
    if (edited !== undefined && edited.trim().length > noteMaxLength) {
      out.errors.push({ id, reason: `edited note exceeds ${noteMaxLength} chars` });
      continue;
    }
    repo.updateInvite(id, {
      status: to,
      decided: true,
      ...(edited !== undefined ? { note: edited.trim() || null } : {}),
    });
    out.updated.push(id);
  }
  return out;
}
