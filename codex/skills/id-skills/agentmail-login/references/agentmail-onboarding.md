# AgentMail Onboarding Reference

Use this reference to ground setup and fallback choices for the `agentmail-login` skill.

## Official Sources

- AI onboarding: `https://docs.agentmail.to/ai-onboarding`
- MCP integration: `https://docs.agentmail.to/integrations/mcp`
- API reference root: `https://docs.agentmail.to/api-reference`
- Official AgentMail skill: `https://docs.agentmail.to/integrations/skills`

## What the Official Docs Establish

- Create an AgentMail account in the console and generate an API key before starting agent access.
- Export `AGENTMAIL_API_KEY` for every integration mode.
- Prefer MCP as the default access path for AI clients.
- Expect MCP coverage for inbox management, message operations, thread access, and attachments.
- Use the API or SDK directly when MCP is unavailable.

## MCP Notes

AgentMail's onboarding documentation describes an MCP server launched through `npx -y agentmail-mcp` with `AGENTMAIL_API_KEY` provided through the MCP client configuration.

Operationally, that means:

- Reuse MCP if the current environment already has an AgentMail MCP server configured.
- Avoid raw HTTP calls if the MCP server already exposes `create_inbox`, `list_inboxes`, `list_threads`, and `get_thread`.
- Limit tool usage to the minimal read and write operations needed for the current login flow.

## CLI Notes

Treat CLI as a structured-shell fallback when MCP is missing.

- Prefer CLI commands that return JSON rather than human-formatted output.
- Cache inbox IDs and thread IDs locally within the task.
- Pipe raw JSON into `scripts/extract_login_artifact.py` when code or link extraction needs deterministic parsing.

The exact CLI surface may evolve. Check the locally installed AgentMail tooling or the latest official docs before hard-coding commands.

## API / SDK Notes

The API reference establishes the base URL as:

```text
https://api.agentmail.to/v0/
```

Core endpoints for login workflows:

- Create inbox: `POST /v0/inboxes`
- List inbox threads: `GET /v0/inboxes/:inbox_id/threads`
- Get full thread: `GET /v0/inboxes/:inbox_id/threads/:thread_id`

Authentication pattern:

```text
Authorization: Bearer $AGENTMAIL_API_KEY
```

Prefer SDK wrappers when available because they reduce boilerplate and make polling loops less error-prone.

## Official Skill

AgentMail also publishes an official skill for compatible assistants. If that skill is already installed in the current environment, reuse it as the transport and keep this skill focused on the website-login workflow.
