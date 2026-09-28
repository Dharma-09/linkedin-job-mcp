import { describe, expect, it } from "vitest";
import { decideInvites } from "../src/core/invites.js";
import { ACTION_FOLLOW, ACTION_INVITE_SENT } from "../src/core/ratelimit.js";
import { findHiringPosts, findPeople, sendApprovedInvites } from "../src/workflows/network.js";
import { fixture, testApp } from "./helpers.js";

const jobHttp = async (url: string) =>
  url.endsWith("/4100000001") ? { status: 200, body: fixture("job-detail-match.html") } : { status: 404, body: "" };

describe("findHiringPosts", () => {
  it("notes the post, saves the job and queues a pending follow+connect", async () => {
    const app = testApp({
      http: jobHttp,
      pages: (url) => (url.includes("/search/results/content/") && !url.includes("page=") ? fixture("posts.html") : "<main></main>"),
    });
    const r = await findHiringPosts(app, { keywords: ["hiring software developer Canada"] });

    expect(r.scanned).toBe(3);
    expect(r.matches).toHaveLength(1);
    const m = r.matches[0];
    expect(m).toMatchObject({ author: "Alex Martin", role: "Software Developer" });
    expect(m.job).toMatchObject({ id: "4100000001", meetsCriteria: true });

    // Job saved to tracker with a pointer back to the post.
    expect(app.repo.getJob("4100000001")).toMatchObject({ status: "saved" });
    expect(app.repo.getJob("4100000001")!.notes).toContain("urn:li:activity:7300000000000000001");

    // Invite queued as pending, with follow, never sent.
    const [inv] = app.repo.listInvites("pending");
    expect(inv).toMatchObject({ personId: "alex-hiring-mgr", follow: true, status: "pending" });
    expect(inv.note).toBe(
      "Hi Alex, I saw your post about the Software Developer role on your team. I have 2-3 years of relevant experience and would love to connect and learn more.",
    );
    expect(app.sent).toEqual([]);

    // The US company post and the non-hiring post were noted as non-matching.
    expect(r.notMatching.map((n) => n.author)).toEqual(["US Co", "Jamie Doe"]);
    expect(app.repo.listPosts(10)).toHaveLength(3);
  });

  it("doesn't re-process posts it has already seen", async () => {
    const app = testApp({ http: jobHttp, pages: () => fixture("posts.html") });
    await findHiringPosts(app, { keywords: ["hiring"] });
    const again = await findHiringPosts(app, { keywords: ["hiring"] });
    expect(again.matches).toEqual([]);
    expect(again.alreadySeen).toBe(3);
  });
});

describe("findPeople", () => {
  it("keeps only requested roles located in Canada", async () => {
    const urls: string[] = [];
    const app = testApp({
      pages: (url) => {
        urls.push(url);
        return fixture("people-results.html");
      },
    });
    const r = await findPeople(app, { roles: ["recruiter_hr", "engineering_manager"] });

    expect(r.people.map((p) => p.id).sort()).toEqual(["priya-recruits", "tom-eng-mgr"]);
    expect(r.rejected).toEqual([expect.objectContaining({ name: "Sam Lee" })]);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get("geoUrn")).toBe('["101174742"]');
    expect(app.repo.getPerson("priya-recruits")).toBeDefined();
  });

  it("rejects senior developers outside Canada", async () => {
    const app = testApp({ pages: () => fixture("people-results.html") });
    const r = await findPeople(app, { roles: ["senior_developer"] });
    expect(r.people).toEqual([]);
    expect(r.rejected.find((x) => x.name === "Sam Lee")?.reason).toMatch(/not in Canada/);
  });
});

describe("sendApprovedInvites", () => {
  async function appWithApproved(n: number) {
    const app = testApp({ pages: () => fixture("people-results.html") });
    await findPeople(app, { roles: ["recruiter_hr", "engineering_manager"] });
    const people = ["priya-recruits", "tom-eng-mgr"].slice(0, n);
    const ids = people.map((id) => app.repo.insertInvite(id, `Hi ${id}`, { follow: true }).id);
    return { app, ids };
  }

  it("only sends approved invites, logs them, and paces between them", async () => {
    const { app, ids } = await appWithApproved(2);
    decideInvites(app.repo, [ids[0]], "approved");
    let r = await sendApprovedInvites(app, {});
    expect(r.results).toEqual([expect.objectContaining({ inviteId: ids[0], outcome: "sent", followed: true })]);
    expect(app.sent).toHaveLength(1);
    expect(app.repo.getInvite(ids[1])!.status).toBe("pending");

    decideInvites(app.repo, [ids[1]], "approved");
    const t0 = app.clock.t;
    r = await sendApprovedInvites(app, {});
    expect(r.results).toHaveLength(1);
    expect(app.repo.countActionsSince(ACTION_INVITE_SENT, 0)).toBe(2);
    expect(app.repo.countActionsSince(ACTION_FOLLOW, 0)).toBe(2);
    expect(app.clock.t).toBeGreaterThan(t0);
  });

  it("dry run sends nothing and changes nothing", async () => {
    const { app, ids } = await appWithApproved(1);
    decideInvites(app.repo, ids, "approved");
    const r = await sendApprovedInvites(app, { dryRun: true });
    expect(r.results[0].outcome).toMatch(/dry run/);
    expect(app.repo.getInvite(ids[0])!.status).toBe("approved");
    expect(app.repo.countActionsSince(ACTION_INVITE_SENT, 0)).toBe(0);
  });

  it("halts on a security checkpoint and refuses further work", async () => {
    const app = testApp({
      pages: () => fixture("people-results.html"),
      send: async () => ({ status: "halt", state: "checkpoint", followed: false }),
    });
    await findPeople(app, { roles: ["recruiter_hr"] });
    const inv = app.repo.insertInvite("priya-recruits", null);
    decideInvites(app.repo, [inv.id], "approved");
    const r = await sendApprovedInvites(app, {});
    expect(r.stoppedBecause).toMatch(/halted/);
    expect(app.guard.haltReason()).toMatch(/checkpoint/);
    await expect(sendApprovedInvites(app, {})).rejects.toThrow(/halted/);
    await expect(findPeople(app, { roles: ["recruiter_hr"] })).rejects.toThrow(/halted/);
  });

  it("marks failures with the reason", async () => {
    const app = testApp({
      pages: () => fixture("people-results.html"),
      send: async () => ({ status: "failed", reason: "no Connect option", followed: false }),
    });
    await findPeople(app, { roles: ["recruiter_hr"] });
    const inv = app.repo.insertInvite("priya-recruits", null);
    decideInvites(app.repo, [inv.id], "approved");
    await sendApprovedInvites(app, {});
    expect(app.repo.getInvite(inv.id)).toMatchObject({ status: "failed", error: "no Connect option" });
  });
});
