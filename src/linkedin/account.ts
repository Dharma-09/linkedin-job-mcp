import type { Guard } from "../browser/guard.js";
import { pageState, type BrowserSession } from "../browser/session.js";
import { SafetyBlock } from "../core/ratelimit.js";

/**
 * Loads a logged-in LinkedIn page through the guard (halt flag, working hours,
 * page-load cap, pacing), checks for security/login walls, scrolls a little
 * like a person skimming, and returns the rendered HTML.
 */
export async function loadAccountPage(
  session: BrowserSession,
  guard: Guard,
  url: string,
  readySelector: string,
): Promise<string> {
  await guard.beforeAccountPageLoad();
  return session.withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page
      .locator(readySelector)
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => undefined);

    const state = await pageState(page);
    if (state !== "ok") {
      if (state !== "logged_out") guard.halt(state, `while loading ${page.url()}`);
      throw new SafetyBlock(
        state === "logged_out"
          ? "Not logged in to LinkedIn. Run `linkedin-job-mcp login` first."
          : `LinkedIn showed a ${state} page. Automation halted.`,
      );
    }

    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 600 + Math.random() * 400);
      await page.waitForTimeout(700 + Math.random() * 900);
    }
    return page.content();
  });
}
