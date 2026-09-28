import { describe, expect, it } from "vitest";
import { parseJobCards, parseJobDetail, parsePeopleResults, parsePosts } from "../src/linkedin/parse.js";
import { jobIdFrom, jobSearchUrl, peopleSearchUrl, postSearchUrl } from "../src/linkedin/urls.js";
import { fixture } from "./helpers.js";

describe("job cards", () => {
  const cards = parseJobCards(fixture("job-cards.html"));
  it("parses every card", () => {
    expect(cards.map((c) => c.id)).toEqual(["4100000001", "4100000002", "4100000003", "4100000004"]);
  });
  it("extracts fields", () => {
    expect(cards[0]).toMatchObject({
      title: "Software Developer",
      company: "Maple Tech",
      location: "Toronto, Ontario, Canada",
      postedAt: "2026-09-26",
      easyApply: true,
      url: "https://www.linkedin.com/jobs/view/4100000001/",
    });
    expect(cards[1].salary).toBe("CA$140,000.00 - CA$170,000.00");
  });
});

describe("job detail", () => {
  const d = parseJobDetail("4100000001", fixture("job-detail-match.html"));
  it("extracts header and criteria", () => {
    expect(d).toMatchObject({
      title: "Software Developer",
      company: "Maple Tech",
      location: "Toronto, Ontario, Canada",
      applicants: "Over 100 applicants",
    });
    expect(d.criteria).toEqual({ "Seniority level": "Associate", "Employment type": "Full-time" });
  });
  it("keeps bullets as lines", () => {
    expect(d.description).toContain("• 2-3 years of professional experience building web applications");
    expect(d.description.split("\n").length).toBeGreaterThan(4);
  });
});

describe("people results", () => {
  const people = parsePeopleResults(fixture("people-results.html"));
  it("parses classic and churned markup", () => {
    expect(people).toEqual([
      expect.objectContaining({
        id: "priya-recruits",
        name: "Priya Sharma",
        headline: "Senior Technical Recruiter at Maple Tech",
        location: "Toronto, Ontario, Canada",
        degree: "2nd",
        profileUrl: "https://www.linkedin.com/in/priya-recruits/",
      }),
      expect.objectContaining({
        id: "tom-eng-mgr",
        name: "Tom Chen",
        headline: "Engineering Manager @ Big Bank | Hiring!",
        location: "Vancouver, British Columbia, Canada",
        degree: "3rd+",
      }),
      expect.objectContaining({ id: "sam-dev-us", location: "Austin, Texas, United States" }),
    ]);
  });
});

describe("posts", () => {
  const posts = parsePosts(fixture("posts.html"));
  it("parses authors, text and linked jobs", () => {
    expect(posts).toHaveLength(3);
    expect(posts[0]).toMatchObject({
      id: "7300000000000000001",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/",
      authorId: "alex-hiring-mgr",
      authorKind: "person",
      authorName: "Alex Martin",
      authorHeadline: "Engineering Manager at Maple Tech",
      jobIds: ["4100000001"],
    });
    expect(posts[0].text).toContain("My team is hiring!");
    expect(posts[1]).toMatchObject({ authorKind: "company", authorId: null });
  });
});

describe("urls", () => {
  it("builds a Canada job search", () => {
    const u = new URL(jobSearchUrl({ keywords: "software developer", location: "Canada", geoId: "101174742", datePosted: "week", workplace: ["remote", "hybrid"] }, 10));
    expect(u.searchParams.get("geoId")).toBe("101174742");
    expect(u.searchParams.get("f_TPR")).toBe("r604800");
    expect(u.searchParams.get("f_WT")).toBe("2,3");
    expect(u.searchParams.get("start")).toBe("10");
  });
  it("builds people and post searches", () => {
    expect(new URL(peopleSearchUrl({ keywords: "recruiter", geoIds: ["101174742"], network: ["second"] })).searchParams.get("geoUrn")).toBe('["101174742"]');
    expect(new URL(postSearchUrl({ keywords: "hiring" })).searchParams.get("datePosted")).toBe('"past-week"');
  });
  it.each([
    ["4100000001", "4100000001"],
    ["https://www.linkedin.com/jobs/view/software-developer-at-x-4100000001?position=1", "4100000001"],
    ["https://www.linkedin.com/jobs/search/?currentJobId=4100000009", "4100000009"],
    ["urn:li:jobPosting:4100000007", "4100000007"],
    ["nope", null],
  ])("jobIdFrom(%s)", (input, id) => expect(jobIdFrom(input)).toBe(id));
});
