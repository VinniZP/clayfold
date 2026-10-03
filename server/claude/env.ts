// Environment for child `claude` processes. Built from an allowlist: a server started from inside
// another Claude Code session inherits variables such as CLAUDE_CODE_COORDINATOR_MODE, which turn
// the child into a coordinator without tools.
const PASS_THROUGH = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "SHELL"] as const;

const ISOLATION = {
  TERM: "dumb",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
};

export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return { ...env, ...ISOLATION, ...extra };
}
