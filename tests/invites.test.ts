import { describe, expect, it } from "vitest";
import { canTransition, companyFromHeadline, decideInvites, draftInvites, renderNote, templateVars } from "../src/core/invites.js";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";

function repoWithPeople() {
  const repo = new Repo(openDb(":memory:"), () => 1_000);
  repo.upsertPerson({ id: "priya", name: "Priya Sharma", headline: "Technical Recruiter at Maple Tech", location: "Toronto", profileUrl: "https://www.linkedin.com/in/priya/", degree: "2nd", searchQuery: null });
  repo.upsertPerson({ id: "friend", name: "Old Friend", headline: null, location: null, profileUrl: "https://www.linkedin.com/in/friend/", degree: "1st", searchQuery: null });
  return repo;
}

describe("templates", () => {
  it("fills placeholders", () => {
    const repo = repoWithPeople();
    const note = renderNote("Hi {firstName} from {company}, re {role} ({years} yrs){unknown}", templateVars(repo.getPerson("priya")!, { role: "Developer", years: "2-3" }));
    expect(note).toBe("Hi Priya from Maple Tech, re Developer (2-3 yrs){unknown}");
  });
  it("reads company from headline", () => {
    expect(companyFromHeadline("Engineering Manager @ Big Bank | Hiring!")).toBe("Big Bank");
    expect(companyFromHeadline("Freelancer")).toBe("");
  });
});

describe("draftInvites", () => {
  it("queues pending, skips 1st-degree, unknown and duplicates", () => {
    const repo = repoWithPeople();
    const r = draftInvites(repo, [{ personId: "priya" }, { personId: "friend" }, { personId: "ghost" }, { personId: "priya" }], {
      template: "Hi {firstName}!",
      noteMaxLength: 300,
      follow: true,
    });
    expect(r.queued).toHaveLength(1);
    expect(r.queued[0]).toMatchObject({ status: "pending", note: "Hi Priya!", follow: true });
    expect(r.skipped.map((s) => s.personId)).toEqual(["friend", "ghost", "priya"]);
  });

  it("rejects notes over the limit", () => {
    const repo = repoWithPeople();
    const r = draftInvites(repo, [{ personId: "priya", note: "x".repeat(301) }], { noteMaxLength: 300 });
    expect(r.queued).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/301 chars/);
  });
});

describe("approval state machine", () => {
  it("only allows legal transitions", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "sent")).toBe(false);
    expect(canTransition("sent", "rejected")).toBe(false);
    expect(canTransition("failed", "approved")).toBe(true);
  });

  it("approves with an edited note and refuses illegal moves", () => {
    const repo = repoWithPeople();
    const [inv] = draftInvites(repo, [{ personId: "priya" }], { template: "Hi", noteMaxLength: 300 }).queued;
    const r1 = decideInvites(repo, [inv.id, 999], "approved", { [inv.id]: "Edited note" });
    expect(r1.updated).toEqual([inv.id]);
    expect(r1.errors).toEqual([{ id: 999, reason: "not found" }]);
    expect(repo.getInvite(inv.id)).toMatchObject({ status: "approved", note: "Edited note" });
    repo.updateInvite(inv.id, { status: "sent", sent: true });
    expect(decideInvites(repo, [inv.id], "rejected").errors[0].reason).toMatch(/cannot go from sent/);
  });

  it("won't reopen a rejected invite when another is active", () => {
    const repo = repoWithPeople();
    const [a] = draftInvites(repo, [{ personId: "priya" }], { noteMaxLength: 300 }).queued;
    decideInvites(repo, [a.id], "rejected");
    const [b] = draftInvites(repo, [{ personId: "priya" }], { noteMaxLength: 300 }).queued;
    expect(b).toBeDefined();
    expect(decideInvites(repo, [a.id], "pending").errors[0].reason).toMatch(/already has invite/);
  });
});
