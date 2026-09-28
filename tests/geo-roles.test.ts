import { describe, expect, it } from "vitest";
import { inAnyLocation, geoIdFor } from "../src/core/geo.js";
import { rolesOf } from "../src/core/roles.js";

describe("inAnyLocation (Canada)", () => {
  it.each([
    "Toronto, Ontario, Canada",
    "Canada (Remote)",
    "Montreal, QC",
    "Greater Vancouver Metropolitan Area",
    "Calgary, Alberta",
  ])("accepts %s", (loc) => expect(inAnyLocation(loc, ["Canada"])).toBe(true));

  it.each(["Austin, TX", "London, England, United Kingdom", "Remote", null])("rejects %s", (loc) =>
    expect(inAnyLocation(loc, ["Canada"])).toBe(false),
  );

  it("has a geo id for Canada", () => expect(geoIdFor("Canada")).toBe("101174742"));
});

describe("rolesOf", () => {
  it.each([
    ["Senior Technical Recruiter at Maple Tech", "recruiter_hr"],
    ["Talent Acquisition Partner | Hiring devs", "recruiter_hr"],
    ["HR Business Partner", "recruiter_hr"],
    ["Senior Software Engineer at Shopify", "senior_developer"],
    ["Lead Backend Developer", "senior_developer"],
    ["Engineering Manager @ Big Bank", "engineering_manager"],
    ["Director of Engineering", "engineering_manager"],
  ])("%s -> %s", (headline, role) => expect(rolesOf(headline)).toContain(role));

  it("returns nothing for unrelated headlines", () => {
    expect(rolesOf("Marketing Coordinator")).toEqual([]);
    expect(rolesOf("Software Developer")).toEqual([]);
  });
});
