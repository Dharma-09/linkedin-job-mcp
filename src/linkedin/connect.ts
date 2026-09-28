import type { Locator, Page } from "playwright";
import { PROFILE, type PageState } from "../browser/selectors.js";
import { pageState } from "../browser/session.js";

export type SendOutcome =
  | { status: "sent"; followed: boolean; dryRun: boolean }
  | { status: "skipped"; reason: string; followed: boolean }
  | { status: "failed"; reason: string; followed: boolean }
  | { status: "halt"; state: PageState; followed: boolean };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function visible(l: Locator, timeout = 1_500): Promise<boolean> {
  try {
    await l.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

const humanPause = (page: Page, lo = 600, hi = 1_600) => page.waitForTimeout(lo + Math.random() * (hi - lo));

/** The profile's own top-card area. Scoping here avoids clicking buttons in "People also viewed". */
function topCard(page: Page): Locator {
  return page.locator("main section").first();
}

/**
 * Follows the person if a Follow button for *them* is available.
 * Returns true if we clicked Follow (or they were already followed).
 */
async function follow(page: Page, firstName: string, dryRun: boolean): Promise<boolean> {
  const card = topCard(page);
  if (await visible(card.getByRole("button", { name: PROFILE.followingButtonName }).first(), 800)) return true;

  const forThem = new RegExp(`^Follow\\b.*${escapeRegex(firstName)}`, "i");
  let btn = card.getByRole("button", { name: forThem }).first();
  if (!(await visible(btn, 800))) {
    const more = card.getByRole("button", { name: PROFILE.moreButtonName }).first();
    if (!(await visible(more, 800))) return false;
    await more.click();
    await humanPause(page);
    btn = page.getByRole("button", { name: forThem }).first();
    if (!(await visible(btn))) {
      await page.keyboard.press("Escape");
      return false;
    }
  }
  if (dryRun) return true;
  await btn.click();
  await humanPause(page);
  return true;
}

/** Finds this person's Connect control (top card, or inside the More menu). */
async function findConnect(page: Page, firstName: string): Promise<Locator | undefined> {
  const card = topCard(page);
  const forThem = new RegExp(`^Invite .*${escapeRegex(firstName)}.* to connect$`, "i");

  const direct = card.getByRole("button", { name: forThem }).first();
  if (await visible(direct)) return direct;

  const more = card.getByRole("button", { name: PROFILE.moreButtonName }).first();
  if (await visible(more)) {
    await more.click();
    await humanPause(page);
    const inMenu = page.getByRole("button", { name: forThem }).first();
    if (await visible(inMenu)) return inMenu;
    await page.keyboard.press("Escape");
  }
  return undefined;
}

/**
 * Opens the profile and sends one connection request (optionally with a note
 * and a follow). With dryRun it walks up to the Send click but never sends.
 */
export async function sendInvite(
  page: Page,
  person: { profileUrl: string; name: string },
  note: string | null,
  opts: { follow: boolean; dryRun: boolean },
): Promise<SendOutcome> {
  let followed = false;
  await page.goto(person.profileUrl, { waitUntil: "domcontentloaded" });
  await page.locator("main h1").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  await humanPause(page, 1_500, 3_500);

  const state = await pageState(page);
  if (state !== "ok") return { status: "halt", state, followed };

  const firstName = person.name.split(/\s+/)[0] ?? person.name;
  const card = topCard(page);

  if (opts.follow) followed = await follow(page, firstName, opts.dryRun);

  if (await visible(card.getByRole("button", { name: PROFILE.pendingButtonName }).first(), 800)) {
    return { status: "skipped", reason: "invitation already pending", followed };
  }

  const connect = await findConnect(page, firstName);
  if (!connect) {
    return { status: "failed", reason: "no Connect option on profile (already connected, or connect is disabled)", followed };
  }
  if (opts.dryRun) return { status: "sent", followed, dryRun: true };

  await connect.click();
  const dialog = page.getByRole("dialog").first();
  if (!(await visible(dialog, 5_000))) return { status: "failed", reason: "invite dialog did not open", followed };

  if (await visible(dialog.locator(PROFILE.emailRequiredField), 800)) {
    await page.keyboard.press("Escape");
    return { status: "failed", reason: "LinkedIn requires their email address to connect", followed };
  }

  if (note) {
    const addNote = dialog.getByRole("button", { name: PROFILE.addNoteButtonName }).first();
    if (!(await visible(addNote))) {
      await page.keyboard.press("Escape");
      return { status: "failed", reason: "'Add a note' not offered; approve without a note to send anyway", followed };
    }
    await addNote.click();
    await humanPause(page);
    const dialogState = await pageState(page);
    if (dialogState === "note_limit") {
      await page.keyboard.press("Escape");
      return { status: "failed", reason: "monthly personalized-note limit reached; remove the note to send", followed };
    }
    const box = dialog.locator(PROFILE.noteTextarea).first();
    if (!(await visible(box, 3_000))) {
      await page.keyboard.press("Escape");
      return { status: "failed", reason: "note box not found", followed };
    }
    await box.click();
    await box.pressSequentially(note, { delay: 25 + Math.random() * 45 });
    await humanPause(page);
    await dialog.getByRole("button", { name: PROFILE.sendWithNoteButtonName }).first().click();
  } else {
    const without = dialog.getByRole("button", { name: PROFILE.sendWithoutNoteButtonName }).first();
    const send = (await visible(without)) ? without : dialog.getByRole("button", { name: PROFILE.sendWithNoteButtonName }).first();
    await send.click();
  }

  await humanPause(page, 1_500, 3_000);
  const after = await pageState(page);
  if (after !== "ok") return { status: "halt", state: after, followed };

  const pending = await visible(card.getByRole("button", { name: PROFILE.pendingButtonName }).first(), 4_000);
  const dialogGone = !(await dialog.isVisible().catch(() => false));
  if (!pending && !dialogGone) return { status: "failed", reason: "could not confirm the invite was sent", followed };
  return { status: "sent", followed, dryRun: false };
}
