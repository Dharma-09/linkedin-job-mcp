/**
 * Every LinkedIn-specific selector, URL pattern and text marker lives here.
 * When LinkedIn changes its markup, this is the file to update.
 */

export const LINKEDIN_ORIGIN = "https://www.linkedin.com";

/** Guest (logged-out) job pages. Plain server-rendered HTML fragments, stable for years. */
export const JOBS = {
  searchEndpoint: `${LINKEDIN_ORIGIN}/jobs-guest/jobs/api/seeMoreJobPostings/search`,
  detailEndpoint: (id: string) => `${LINKEDIN_ORIGIN}/jobs-guest/jobs/api/jobPosting/${id}`,
  viewUrl: (id: string) => `${LINKEDIN_ORIGIN}/jobs/view/${id}/`,
  pageSize: 10,
  card: {
    root: "li",
    urnAttr: "data-entity-urn",
    urnHolder: "[data-entity-urn]",
    link: "a.base-card__full-link, a.base-search-card--link, a[href*='/jobs/view/']",
    title: ".base-search-card__title",
    company: ".base-search-card__subtitle",
    location: ".job-search-card__location",
    listDate: "time",
    salary: ".job-search-card__salary-info",
    easyApply: ".job-posting-benefits__text",
  },
  detail: {
    title: ".top-card-layout__title, h1, h2",
    company: ".topcard__org-name-link, .top-card-layout__second-subline a",
    location: ".topcard__flavor--bullet",
    postedAgo: ".posted-time-ago__text",
    description: ".show-more-less-html__markup, .description__text",
    criteriaItem: ".description__job-criteria-item",
    criteriaLabel: ".description__job-criteria-subheader",
    criteriaValue: ".description__job-criteria-text",
    salary: ".compensation__salary",
    applicants: ".num-applicants__caption",
  },
} as const;

/** Logged-in people search (rendered SPA). */
export const PEOPLE = {
  searchUrl: `${LINKEDIN_ORIGIN}/search/results/people/`,
  /** Result list items. We fall back to "any li with a /in/ link" because class names churn. */
  resultItem: "main li",
  profileLink: "a[href*='/in/']",
  nameInLink: "span[aria-hidden='true']",
  classic: {
    headline: ".entity-result__primary-subtitle",
    location: ".entity-result__secondary-subtitle",
  },
  /** Text lines in a result card that are UI chrome, not person data. */
  noiseLines: [
    /^connect$/i,
    /^message$/i,
    /^follow$/i,
    /^pending$/i,
    /^view .*profile$/i,
    /^status is /i,
    /^•?\s*(1st|2nd|3rd\+?)$/i,
    /degree connection$/i,
    /mutual connections?$/i,
    /^current:/i,
    /^past:/i,
    /^summary:/i,
    /^skills:/i,
    /followers$/i,
    /^provides services/i,
    /^•$/,
  ],
} as const;

/** Logged-in content (posts) search. */
export const POSTS = {
  searchUrl: `${LINKEDIN_ORIGIN}/search/results/content/`,
  postUrl: (urn: string) => `${LINKEDIN_ORIGIN}/feed/update/${urn}/`,
  container: "[data-urn^='urn:li:activity:'], [data-urn^='urn:li:ugcPost:'], [data-id^='urn:li:activity:'], [data-urn^='urn:li:share:']",
  urnAttrs: ["data-urn", "data-id"],
  actor: ".update-components-actor, .feed-shared-actor",
  actorLink: "a[href*='/in/'], a[href*='/company/']",
  actorName: ".update-components-actor__title span[aria-hidden='true'], .update-components-actor__name span[aria-hidden='true'], .feed-shared-actor__name",
  actorHeadline:
    ".update-components-actor__description span[aria-hidden='true'], .feed-shared-actor__description",
  text: ".update-components-text, .feed-shared-update-v2__description, .feed-shared-inline-show-more-text, .feed-shared-text",
  jobLink: "a[href*='/jobs/view/'], a[href*='currentJobId=']",
} as const;

/** Profile page actions (send invitation). Matched by accessible name, not class. */
export const PROFILE = {
  /** Primary "Connect" button on the profile top card. */
  connectButtonName: /^Invite .+ to connect$/i,
  connectButtonText: /^Connect$/i,
  /** "More" overflow menu that sometimes hides Connect. */
  moreButtonName: /^More actions$/i,
  pendingButtonName: /^Pending, click to withdraw invitation/i,
  /** "Follow <name>" button, top card or inside the More menu. */
  followButtonName: /^Follow\b/i,
  followingButtonName: /^(Following|Unfollow)\b/i,
  messageButtonText: /^Message$/i,
  addNoteButtonName: /^Add a note$/i,
  noteTextarea: "textarea[name='message'], textarea#custom-message",
  sendWithNoteButtonName: /^Send( invitation| now)?$/i,
  sendWithoutNoteButtonName: /^Send without a note$/i,
  /** How-do-you-know-X dialog, shown for some 3rd+ degree profiles. Needs an email: we bail. */
  emailRequiredField: "input[name='email']",
} as const;

export type PageState = "ok" | "logged_out" | "checkpoint" | "restricted" | "invite_limit" | "note_limit";

const URL_MARKERS: [RegExp, PageState][] = [
  [/\/checkpoint\//i, "checkpoint"],
  [/\/authwall/i, "logged_out"],
  [/\/uas\/login|\/login(\?|$|\/)|\/signup/i, "logged_out"],
];

const TEXT_MARKERS: [RegExp, PageState][] = [
  [/let'?s do a quick security check|security verification|verify you'?re (a )?human|captcha/i, "checkpoint"],
  [/your account (has been|is) (temporarily )?restricted/i, "restricted"],
  [/reached the weekly invitation limit|weekly invitation limit|too many invitations/i, "invite_limit"],
  [/used all your personalized invitations|personalized invitation(s)? limit/i, "note_limit"],
];

/** Classifies a page by URL and visible text. Anything but "ok" should stop automation. */
export function classifyPage(url: string, bodyText: string): PageState {
  for (const [re, state] of URL_MARKERS) if (re.test(url)) return state;
  for (const [re, state] of TEXT_MARKERS) if (re.test(bodyText)) return state;
  return "ok";
}
