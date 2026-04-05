export const SESSION_TRASH_LIST_LIMIT = 500;
export const SESSION_TRASH_PAGE_SIZE = 200;
export const DEFAULT_MODEL_CONTEXT_WINDOW = 190000;
export const DEFAULT_MODEL_AUTO_COMPACT_TOKEN_LIMIT = 185000;
export const DEFAULT_OPENCLAW_TEMPLATE = `{
  // OpenClaw config (JSON5)
  agent: {
    model: "gpt-4.1"
  },
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace"
    }
  }
}`;
