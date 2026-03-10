---
name: agentmail-login
description: Complete passwordless website sign-ins by combining AgentMail with any browser automation tool. This skill should be used when a site emails a one-time code or magic link and the agent must supply an inbox, retrieve the email, extract the login artifact, and finish authentication.
---

# AgentMail Login

Complete email-based authentication flows on websites. Prefer AgentMail MCP for inbox and thread access, then fall back to `agentmail-cli` or direct API/SDK calls when MCP is unavailable.

## When to Use This Skill

Use this skill when the task involves:

- Passwordless sign-in by email
- One-time verification codes sent by email
- Magic links sent by email
- Account confirmation that must happen inside an active browser session
- A supplied inbox or a fresh inbox that should be created for the run

Do not use this skill for:

- TOTP authenticator apps
- SMS-only verification
- CAPTCHA-only or hardware-token-only flows unless another workflow handles those steps

## Required Inputs

Establish these inputs before acting:

- Target site and login URL
- Email address strategy: reuse an existing inbox or create a fresh inbox
- AgentMail access path: MCP, CLI, or API/SDK
- Browser automation tool available in the current environment
- Success signal: redirected page, authenticated UI element, cookie presence, or explicit dashboard state

Ask one short question before proceeding if any of those are ambiguous and cannot be discovered safely.

## Default Workflow

1. Identify the email-auth pattern on the site.
   - Determine whether the page expects a code entry, a magic-link click, or either.
2. Establish the inbox.
   - Reuse a known inbox if the task requires a stable address.
   - Create a fresh inbox if isolation is safer.
3. Submit the email in the browser.
   - Keep the browser session open.
   - Avoid refreshing away from the waiting state unless the site requires it.
4. Wait for the login email in AgentMail.
   - Prefer narrow filters: recent threads, sender domain, subject fragments, and the exact recipient inbox.
   - Ignore unrelated or older login emails.
5. Extract the login artifact.
   - Prefer the magic link if the site clearly expects a click-through flow.
   - Prefer the one-time code if the page is waiting for manual code entry or if the message includes both.
   - Use `scripts/extract_login_artifact.py` for deterministic parsing of raw message data.
6. Complete the auth step in the browser.
   - Click the magic link in the same logical browser context when possible.
   - If the link opens a new tab, preserve the original tab until authenticated state is confirmed.
   - If using a code, paste the freshest valid code and submit.
7. Verify success.
   - Confirm the page is authenticated before declaring completion.
   - Look for dashboard content, account avatar, logout controls, or a post-login URL change.
8. Clean up.
   - Record which inbox was used.
   - Delete the temporary inbox only if the task explicitly calls for cleanup.

## AgentMail Access Modes

### 1. MCP (Default)

Start here when AgentMail MCP is installed. AgentMail's AI onboarding docs describe an MCP server launched with `npx -y agentmail-mcp` and configured with `AGENTMAIL_API_KEY`.

Use MCP to:

- Create or list inboxes
- Inspect threads in the selected inbox
- Fetch the full thread content for the newest candidate email
- Download attachments if login instructions arrive as files

Read `references/agentmail-onboarding.md` for setup summary and source links. Reuse an already-installed official AgentMail skill if the environment provides one.

### 2. CLI Fallback

Use CLI only when MCP is unavailable or insufficient. Follow the locally installed AgentMail CLI or the commands documented in the official onboarding material. Prefer commands that return structured JSON so the results can be piped into `scripts/extract_login_artifact.py`.

Cache the chosen inbox ID and thread ID inside the task so repeated polling does not rediscover them from scratch.

### 3. API / SDK Fallback

Use direct API or SDK access when neither MCP nor CLI is available. AgentMail's API docs use `https://api.agentmail.to/v0/` as the base URL and document the core login-flow endpoints:

- `POST /v0/inboxes`
- `GET /v0/inboxes/:inbox_id/threads`
- `GET /v0/inboxes/:inbox_id/threads/:thread_id`

Prefer an SDK when available because it simplifies authentication and response handling. For raw HTTP, send `Authorization: Bearer $AGENTMAIL_API_KEY`.

## Matching the Right Email

Read `references/login-email-triage.md` when multiple candidate messages exist.

Prioritize:

- The newest thread that appeared after the browser submitted the email
- Sender domains matching the target site or its auth provider
- Subject terms such as "sign in", "verify", "magic link", "login code", or "security code"
- The exact inbox used during the run

Ignore stale codes because many sites invalidate older codes immediately.

## Browser Tool Agnostic Completion

Work with the active browser tool rather than assuming Playwright.

- Preserve the browser session that submitted the email address.
- Store the waiting-page location before switching attention to mail retrieval.
- If a magic link opens outside the active automation context, bring that URL back into the controlled browser session when possible.
- If the site uses a code field and a magic link in parallel, prefer the path that keeps state inside the existing browser session.

## Failure Handling

If no email arrives:

- Confirm the site accepted the email without validation errors
- Re-check the inbox choice
- Poll again with tighter time bounds
- Request resend once before changing strategy

If the wrong email arrives:

- Verify sender, subject, and timestamp
- Fetch the full thread because some providers put the actionable content in the latest reply
- Use `scripts/extract_login_artifact.py --prefer code` or `--prefer link` to force the correct artifact type

If the link or code fails:

- Confirm the browser is still in the same auth session
- Prefer the most recent email
- Request a new email instead of retrying older artifacts repeatedly

## Output Expectations

Report these details at the end of the task:

- Which inbox or email address was used
- Whether a code or link was used
- How success was verified
- Any remaining risk, such as expiring links or a temporary inbox left active

## Example Triggers

- "Log into this site with the agent inbox and use the email code."
- "Create a temporary AgentMail inbox, sign in, and click the magic link."
- "Use my configured AgentMail address to finish this passwordless login."

## Resources

- `references/agentmail-onboarding.md` for setup details and official docs
- `references/login-email-triage.md` for email matching and extraction heuristics
- `scripts/extract_login_artifact.py` for deterministic code or link extraction from raw email text or JSON
