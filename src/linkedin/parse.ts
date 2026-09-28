import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { JOBS, PEOPLE, POSTS } from "../browser/selectors.js";
import { jobIdFrom, profileSlug, profileUrl } from "./urls.js";

const clean = (s: string | undefined | null): string => (s ?? "").replace(/\s+/g, " ").trim();
const orNull = (s: string): string | null => (s.length > 0 ? s : null);

export interface JobCard {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  postedAt: string | null;
  postedText: string | null;
  salary: string | null;
  easyApply: boolean;
}

/** Parses the guest seeMoreJobPostings HTML fragment into job cards. */
export function parseJobCards(html: string): JobCard[] {
  const $ = cheerio.load(html);
  const c = JOBS.card;
  const out: JobCard[] = [];
  const seen = new Set<string>();

  $(c.urnHolder).each((_, el) => {
    const card = $(el);
    const urn = card.attr(c.urnAttr) ?? "";
    const href = card.find(c.link).first().attr("href") ?? (card.is("a") ? card.attr("href") : undefined) ?? "";
    const id = jobIdFrom(urn) ?? jobIdFrom(href);
    if (!id || seen.has(id)) return;
    const title = clean(card.find(c.title).first().text());
    if (!title) return;
    seen.add(id);
    const time = card.find(c.listDate).first();
    out.push({
      id,
      title,
      company: orNull(clean(card.find(c.company).first().text())),
      location: orNull(clean(card.find(c.location).first().text())),
      url: JOBS.viewUrl(id),
      postedAt: orNull(clean(time.attr("datetime"))),
      postedText: orNull(clean(time.text())),
      salary: orNull(clean(card.find(c.salary).first().text())),
      easyApply: /easy apply/i.test(card.find(c.easyApply).text()),
    });
  });
  return out;
}

export interface JobDetail {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  postedText: string | null;
  description: string;
  criteria: Record<string, string>;
  salary: string | null;
  applicants: string | null;
}

/** Converts a description HTML block to readable plain text (keeps paragraphs and bullets). */
function htmlToText($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
  const copy = el.clone();
  copy.find("br").replaceWith("\n");
  copy.find("li").each((_, li) => {
    $(li).prepend("• ").append("\n");
  });
  copy.find("p, div, ul, ol, h1, h2, h3, h4").each((_, b) => {
    $(b).append("\n");
  });
  return copy
    .text()
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

/** Parses the guest jobPosting/<id> HTML page. */
export function parseJobDetail(id: string, html: string): JobDetail {
  const $ = cheerio.load(html);
  const d = JOBS.detail;
  const criteria: Record<string, string> = {};
  $(d.criteriaItem).each((_, el) => {
    const label = clean($(el).find(d.criteriaLabel).text());
    const value = clean($(el).find(d.criteriaValue).text());
    if (label && value) criteria[label] = value;
  });
  return {
    id,
    title: clean($(d.title).first().text()),
    company: orNull(clean($(d.company).first().text())),
    location: orNull(clean($(d.location).first().text())),
    url: JOBS.viewUrl(id),
    postedText: orNull(clean($(d.postedAgo).first().text())),
    description: htmlToText($, $(d.description).first()),
    criteria,
    salary: orNull(clean($(d.salary).first().text())),
    applicants: orNull(clean($(d.applicants).first().text())),
  };
}

export interface PersonResult {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  profileUrl: string;
  degree: string | null;
}

function isNoise(line: string): boolean {
  return PEOPLE.noiseLines.some((re) => re.test(line));
}

/** Collects the visible text lines of an element, skipping screen-reader-only duplicates. */
function textLines($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string[] {
  const copy = el.clone();
  copy.find(".visually-hidden, .sr-only, script, style, button, svg").remove();
  const lines: string[] = [];
  copy.find("*").each((_, node) => {
    const own = $(node)
      .contents()
      .filter((__, c) => c.type === "text")
      .text();
    const t = clean(own);
    if (t && lines[lines.length - 1] !== t) lines.push(t);
  });
  return lines;
}

/** Parses a rendered logged-in people-search results page. */
export function parsePeopleResults(html: string): PersonResult[] {
  const $ = cheerio.load(html);
  const out: PersonResult[] = [];
  const seen = new Set<string>();

  $(PEOPLE.resultItem).each((_, li) => {
    const item = $(li);
    // Skip wrapper <li>s that contain other result <li>s.
    if (item.find("li").find(PEOPLE.profileLink).length > 0) return;
    const link = item.find(PEOPLE.profileLink).first();
    const href = link.attr("href");
    if (!href) return;
    const slug = profileSlug(href);
    if (!slug || seen.has(slug)) return;

    const name =
      clean(link.find(PEOPLE.nameInLink).first().text()) ||
      clean(link.text()).replace(/^View\s+/i, "").replace(/[’']s\s+profile$/i, "");
    // "LinkedIn Member" = out-of-network profile with no usable identity.
    if (!name || /^linkedin member$/i.test(name)) return;

    const rawText = clean(item.text());
    const degree =
      rawText.match(/(1st|2nd|3rd\+?)\s+degree connection/i)?.[1] ??
      rawText.match(/•\s*(1st|2nd|3rd\+?)\b/)?.[1] ??
      null;

    let headline = clean(item.find(PEOPLE.classic.headline).first().text());
    let location = clean(item.find(PEOPLE.classic.location).first().text());
    if (!headline) {
      const lines = textLines($, item).filter((l) => l !== name && !isNoise(l));
      headline = lines[0] ?? "";
      location = location || (lines[1] ?? "");
    }

    seen.add(slug);
    out.push({
      id: slug,
      name,
      headline: orNull(headline),
      location: orNull(location),
      profileUrl: profileUrl(slug),
      degree: degree ? degree.replace(/^3rd$/, "3rd+") : null,
    });
  });
  return out;
}

export interface PostResult {
  /** Activity id (numeric part of the urn). */
  id: string;
  urn: string;
  url: string;
  authorId: string | null;
  authorKind: "person" | "company" | "unknown";
  authorName: string | null;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  text: string;
  jobIds: string[];
}

/** Parses a rendered logged-in content (posts) search page. */
export function parsePosts(html: string): PostResult[] {
  const $ = cheerio.load(html);
  const out: PostResult[] = [];
  const seen = new Set<string>();

  $(POSTS.container).each((_, el) => {
    const card = $(el);
    // Nested containers (reshares) - keep the outermost only.
    if (card.parents(POSTS.container).length > 0) return;
    const urn = POSTS.urnAttrs.map((a) => card.attr(a)).find((v) => v && v.startsWith("urn:li:")) ?? "";
    const id = urn.split(":").pop() ?? "";
    if (!id || seen.has(id)) return;

    const actor = card.find(POSTS.actor).first();
    const actorScope = actor.length > 0 ? actor : card;
    const href = actorScope.find(POSTS.actorLink).first().attr("href") ?? "";
    const slug = profileSlug(href);
    const authorKind = slug ? "person" : /\/company\//.test(href) ? "company" : "unknown";

    const text = htmlToText($, card.find(POSTS.text).first());
    if (!text) return;

    const jobIds = new Set<string>();
    card.find(POSTS.jobLink).each((__, a) => {
      const jid = jobIdFrom($(a).attr("href") ?? "");
      if (jid) jobIds.add(jid);
    });

    seen.add(id);
    out.push({
      id,
      urn,
      url: POSTS.postUrl(urn),
      authorId: slug,
      authorKind,
      authorName: orNull(clean(card.find(POSTS.actorName).first().text())),
      authorHeadline: orNull(clean(card.find(POSTS.actorHeadline).first().text())),
      authorProfileUrl: slug ? profileUrl(slug) : null,
      text,
      jobIds: [...jobIds],
    });
  });
  return out;
}
