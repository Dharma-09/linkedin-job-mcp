import { describe, expect, it } from "vitest";
import { findMatchingJobs } from "../src/workflows/jobs.js";
import { fixture, testApp } from "./helpers.js";

function fakeLinkedIn() {
  const calls: string[] = [];
  const http = async (url: string) => {
    calls.push(url);
    if (url.includes("seeMoreJobPostings")) {
      const start = new URL(url).searchParams.get("start");
      return start === "0" ? { status: 200, body: fixture("job-cards.html") } : { status: 400, body: "" };
    }
    if (url.endsWith("/4100000001")) return { status: 200, body: fixture("job-detail-match.html") };
    if (url.endsWith("/4100000004")) return { status: 200, body: fixture("job-detail-senior.html") };
    return { status: 404, body: "" };
  };
  return { http, calls };
}

describe("findMatchingJobs", () => {
  it("returns only jobs that pass every check and explains the rest", async () => {
    const li = fakeLinkedIn();
    const app = testApp({ http: li.http });
    const r = await findMatchingJobs(app, { keywords: ["software developer"] });

    expect(r.matches.map((m) => m.id)).toEqual(["4100000001"]);
    expect(r.matches[0].why.join(" ")).toMatch(/asks 2-3 yrs/);
    expect(r.stats).toMatchObject({ listed: 4, rejectedFromListing: 2, descriptionsRead: 2, rejectedAfterReading: 1 });
    expect(r.rejectionSummary).toMatchObject({ "excluded title word": 1, "wrong location": 1, "too senior": 1 });

    // Only the two plausible descriptions were fetched.
    expect(li.calls.filter((u) => u.includes("jobPosting/"))).toHaveLength(2);
  });

  it("never shows the same job twice", async () => {
    const li = fakeLinkedIn();
    const app = testApp({ http: li.http });
    await findMatchingJobs(app, { keywords: ["software developer"] });
    const again = await findMatchingJobs(app, { keywords: ["software developer"] });
    expect(again.matches).toEqual([]);
    expect(again.stats.alreadySeen).toBe(2);
    expect(app.repo.listUnreviewedMatches(10).map((j) => j.id)).toEqual(["4100000001"]);
  });

  it("respects maxResults", async () => {
    const li = fakeLinkedIn();
    const app = testApp({ http: li.http });
    const r = await findMatchingJobs(app, { keywords: ["software developer"], maxResults: 1 });
    expect(r.matches).toHaveLength(1);
    expect(r.stats.descriptionsRead).toBe(1);
  });
});
