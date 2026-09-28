/**
 * stdout carries the MCP protocol, so all logging must go to stderr.
 */
export function log(message: string, extra?: Record<string, unknown>): void {
  const line = extra ? `${message} ${JSON.stringify(extra)}` : message;
  process.stderr.write(`[linkedin-job-mcp] ${new Date().toISOString()} ${line}\n`);
}
