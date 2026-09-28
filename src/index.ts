#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp } from "./app.js";
import { BrowserSession } from "./browser/session.js";
import { loadConfig, resolvePaths } from "./config.js";
import { log } from "./log.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === "login") {
    const paths = resolvePaths();
    await new BrowserSession(paths, loadConfig(paths)).interactiveLogin();
    return;
  }
  if (cmd && cmd !== "serve") {
    process.stderr.write("usage: linkedin-job-mcp [serve|login]\n");
    process.exit(2);
  }

  const app = createApp();
  const server = new McpServer({ name: "linkedin-job-mcp", version: "0.1.0" });
  registerTools(server, app);

  const shutdown = async () => {
    await app.session.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);

  await server.connect(new StdioServerTransport());
  log("ready", { dataDir: app.paths.home });
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
