import { chromium, type BrowserContext, type Page } from "playwright";
import type { Config, Paths } from "../config.js";
import { log } from "../log.js";
import { classifyPage, LINKEDIN_ORIGIN, type PageState } from "./selectors.js";

const IDLE_CLOSE_MS = 10 * 60 * 1000;

/**
 * One persistent Chromium profile (your LinkedIn login lives in it).
 * Launched lazily on first use, closed after 10 idle minutes.
 */
export class BrowserSession {
  private ctx: BrowserContext | undefined;
  private launching: Promise<BrowserContext> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly paths: Paths,
    private readonly config: Config,
  ) {}

  private async launch(headless: boolean): Promise<BrowserContext> {
    log("launching browser", { headless, profile: this.paths.browserProfileDir });
    const ctx = await chromium.launchPersistentContext(this.paths.browserProfileDir, {
      headless,
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
    });
    ctx.on("close", () => {
      if (this.ctx === ctx) this.ctx = undefined;
    });
    return ctx;
  }

  async context(): Promise<BrowserContext> {
    this.touch();
    if (this.ctx) return this.ctx;
    this.launching ??= this.launch(this.config.headless).finally(() => (this.launching = undefined));
    this.ctx = await this.launching;
    return this.ctx;
  }

  /** Runs fn with a fresh tab, always closing the tab afterwards. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const ctx = await this.context();
    const page = await ctx.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
      this.touch();
    }
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const ctx = this.ctx;
    this.ctx = undefined;
    if (ctx) await ctx.close().catch(() => undefined);
  }

  /**
   * Interactive login: opens a visible window on the LinkedIn login page and
   * waits (up to 5 minutes) until you reach the feed. The session is saved in
   * the persistent profile directory; your password is never seen by this code.
   */
  async interactiveLogin(): Promise<void> {
    await this.close();
    const ctx = await this.launch(false);
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(`${LINKEDIN_ORIGIN}/login`);
      process.stderr.write("Log in to LinkedIn in the opened window (complete any 2FA). Waiting up to 5 minutes...\n");
      await page.waitForURL(/linkedin\.com\/(feed|in\/|mynetwork|jobs)/, { timeout: 5 * 60 * 1000 });
      process.stderr.write("Logged in. Session saved to the browser profile.\n");
    } finally {
      await ctx.close();
    }
  }
}

export async function pageState(page: Page): Promise<PageState> {
  const text = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  return classifyPage(page.url(), text);
}
