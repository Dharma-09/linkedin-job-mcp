# linkedin-job-mcp

An MCP server that lets Claude help you with a LinkedIn job search. It:

- **Finds a few jobs that really fit.** It reads every job description and returns only jobs that pass all of your
  criteria (for example: in Canada, asks for 2–3 years of experience, not a Senior title). The default is 5 at a time.
  You never see the same job twice.
- **Watches "my team is hiring" posts.** It notes each matching post down, saves the linked job to your tracker, and
  queues a follow plus a connection request to the author.
- **Finds recruiters/HR, senior developers and engineering managers**, and keeps only people located where you want
  (for example Canada).
- **Sends connection requests only after you approve them**, with daily caps, human-like pacing and working hours.

> ⚠️ **Read this first.** LinkedIn's User Agreement (§8.2) prohibits bots and automated activity, and LinkedIn
> restricts accounts it thinks are automated. This server is designed to keep that risk low, but it can't remove it:
> - Browsing jobs uses LinkedIn's **public guest job pages** and never touches your account.
> - People and post searches use **your own logged-in browser**, paced and capped (150 page loads a day by default).
> - **Nothing is sent** (connection requests or follows) until **you approve each one**. Sending is capped at 15 a day
>   and 80 a week, with 45–120 s between sends, weekdays 9:00–19:00 only.
> - If LinkedIn ever shows a security check, a restriction or the weekly invite limit, **everything stops** until you
>   check your account and run `resume_automation`.
>
> Use it at your own risk.

## Setup

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite`).

```bash
git clone https://github.com/Dharma-09/linkedin-job-mcp && cd linkedin-job-mcp
npm install
npx playwright install chromium
npm run build

mkdir -p ~/.linkedin-job-mcp
cp config.example.json ~/.linkedin-job-mcp/config.json   # then edit it
npm run login                                            # log in once in the window that opens
```

`npm run login` opens a real Chromium window. You log in yourself (including 2FA). The session is saved in
`~/.linkedin-job-mcp/browser-profile`, and your password is never stored or seen by this code.

### Connect it to Claude

**Claude Code**

```bash
claude mcp add linkedin -- node /absolute/path/to/linkedin-job-mcp/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "linkedin": { "command": "node", "args": ["/absolute/path/to/linkedin-job-mcp/dist/index.js"] }
  }
}
```

Set `LINKEDIN_MCP_HOME` to keep data somewhere other than `~/.linkedin-job-mcp`.

## Everyday use (just ask Claude)

- *"Find me developer jobs in Canada that ask for 2–3 years."* → `find_matching_jobs`
- *"Look for hiring posts from people hiring developers in Canada."* → `find_hiring_posts` (queues pending invites)
- *"Find technical recruiters and engineering managers in Canada at Shopify."* → `find_people` then `draft_connection_requests`
- *"Show me the pending invites."* → `list_invites`. Then *"approve 3 and 5, reject the rest"* → `approve_invites` / `reject_invites`
- *"Send the approved ones."* → `send_approved_invites` (at most 3 per call; try `dryRun: true` first)
- *"What jobs have I saved?"* → `list_saved_jobs`. *"Mark 4100000001 as applied."* → `save_job`

## Tools

| Tool | What it does | Touches LinkedIn |
|---|---|---|
| `find_matching_jobs` | Search, filter cards, read descriptions, strict check, return the few matches | public job pages only |
| `get_job_details` | Read one job and show why it does or doesn't match | public job pages only |
| `list_job_matches` | Earlier matches you haven't saved or dismissed | no |
| `save_job` / `list_saved_jobs` | Job tracker (saved / applied / interviewing / offer / rejected / archived) | public page if new |
| `find_hiring_posts` | Hiring posts → note the post, save the job, queue a follow + connect (pending) | reads, with your login |
| `list_hiring_posts` | Posts noted so far | no |
| `find_people` | Recruiter/HR, senior dev or eng manager, filtered by headline + location | reads, with your login |
| `draft_connection_requests` | Queue invites with a personal note or template (pending) | no |
| `list_invites` / `approve_invites` / `reject_invites` | Your review queue | no |
| `send_approved_invites` | Send approved invites (+ follows) with pacing and caps | **writes** |
| `get_status` / `resume_automation` | Usage vs caps, halt state / clear a halt | no |

## How the strict job filter works

1. Search LinkedIn's public job listings for each keyword. The location defaults to `profile.requiredLocations[0]`,
   and Canada uses LinkedIn's geo id.
2. **Card filter** (no extra requests): location must be in `requiredLocations`, the title must match a
   `targetTitles` entry and must not contain an `excludeTitleKeywords` word, and the company must not be blocked.
3. **Reads each remaining description** and checks:
   - The **years of experience** it asks for ("2+ years", "2-4 years", "minimum of 3 years", "at least two years"…).
     The largest minimum in the posting counts, so "5+ years Java, 1+ years AWS" is treated as a 5-year job.
     It's rejected if that is above your max, or if the job tops out below your min. With `strictExperience: true`,
     jobs that don't state any years are rejected too.
   - `mustHave` words present, no `avoidKeywords`, and score ≥ `minScore`.
4. It stops as soon as `maxResults` jobs pass, and tells you how many were dropped and why
   (e.g. `too senior: 7, wrong location: 4`).

Every evaluated job is remembered, so later runs only show you new jobs.

## Configuration

See [`config.example.json`](config.example.json). All keys are optional. Limits are clamped to hard ceilings
(25 invites a day, 100 a week, 40 follows a day, 300 page loads a day, and at least 20 s between sends), whatever the
config says.

## Development

```bash
npm test          # vitest: parsers (HTML fixtures), filters, experience extraction, caps, workflows
npm run typecheck
npm run dev       # run from source with tsx
npx @modelcontextprotocol/inspector node dist/index.js
```

LinkedIn changes its page markup often. Every selector and text marker is in
[`src/browser/selectors.ts`](src/browser/selectors.ts). The test fixtures in `tests/fixtures/` are hand-written
approximations of LinkedIn's markup. If a live search returns nothing, save the page HTML and compare.

### Layout

```
src/
  index.ts            entry (serve | login)
  tools.ts            MCP tool definitions
  app.ts              wiring (config, db, guard, browser)
  config.ts           config schema + hard limits
  core/               pure logic: scoring, match, experience, geo, roles, hiring, invites, ratelimit
  workflows/          find_matching_jobs, find_people, find_hiring_posts, send_approved_invites
  linkedin/           urls, parsers (cheerio), guest job fetches, logged-in page loads, connect/follow
  browser/            Playwright session, guard (halt/caps/pacing), selectors
  db/                 node:sqlite schema + repository
```
