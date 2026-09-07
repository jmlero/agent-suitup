# Grok Build compatibility

Status: verified against Grok Build 1.0.4 on 2026-08-15.

## Result

The portable agent-suitup core is compatible with Codex and Grok Build. Full
harness parity is not: their plugin, configuration, MCP, and subagent surfaces
remain vendor-specific.

| Surface | Agent Suitup behavior | Status |
|---|---|---|
| Instructions | Both discover repository `AGENTS.md` from root to working directory. | Native |
| Skills | Both discover `.agents/skills/<name>/SKILL.md`. | Native |
| Commands | The canonical skill works in both. `--adapter grok` adds a metadata-only wrapper that enforces slash-only invocation without copying the workflow. Invoke `$name` in Codex or `/name` in Grok. | Supported |
| Plugins | Current `plugin/*` entries install through the Claude adapter. Grok and Codex use different native packaging and trust flows. | Not ported |
| Config and MCP | `.codex/config.toml` is not imported by Grok; Grok uses `.grok/config.toml`. | No automatic translation |
| Agents and subagents | No portable component is currently shipped, and native definitions differ. | Not supported |

This is deliberately not labeled “100% Codex compatible.” Grok's documented
`[compat.codex]` support currently covers sessions; its skills, rules, agents,
MCP, and hooks switches are reserved and do not enable `.codex` discovery.

## Use it

Portable instructions and normal skills need no adapter:

```bash
agent-suitup add block/tdd skill/audit-code
grok inspect
```

Use the Grok adapter when installing explicit commands so Grok cannot invoke
them automatically:

```bash
agent-suitup add command/verify-work --adapter grok
```

## Verification performed

- Installed a block, a normal skill, and an explicit command in an isolated
  project and home directory.
- Used `grok inspect --json` to confirm discovery of `AGENTS.md`, canonical
  `.agents/skills`, and the explicit command wrapper.
- Ran the complete agent-suitup test and syntax-check suite.

## Primary references

- [Grok Build project rules](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/12-project-rules.md)
- [Grok Build skills](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md)
- [Grok Build hooks](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)
- [Grok Build configuration](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md)
- [Codex `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
