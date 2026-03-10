# Login Email Triage

Use this reference to choose the correct login email and extract the right artifact.

## Inbox Selection

Choose one inbox for the run and keep it stable.

- Reuse a configured inbox when the site expects a known email address.
- Create a fresh inbox when isolation is safer and the site allows any address.
- Avoid mixing multiple inboxes in one run unless the site explicitly changes the address mid-flow.

## Candidate Thread Ranking

Rank candidate emails in this order:

1. Newest thread created after the login form submission
2. Exact recipient match for the chosen inbox
3. Sender domain matching the product or its auth provider
4. Subject containing login language
5. Body containing a code or a sign-in link

Common subject terms:

- Sign in
- Verify
- Login code
- Security code
- Magic link
- Confirm your email

## Link vs Code Choice

Prefer a magic link when:

- The site explicitly says "check your email and click the link"
- The email contains one obvious auth link and no code-entry UI is waiting
- The link appears to target the same product or a known auth provider

Prefer a code when:

- The site is already waiting on a code-entry form
- The email includes both a link and a code
- The email contains multiple links but only one obvious verification code

## Unsafe Links to Ignore

Do not confuse the login link with:

- Unsubscribe links
- Help-center links
- Privacy-policy or terms links
- "Manage preferences" links
- Marketing CTA buttons

Treat links with auth-related paths, tokens, or verification language as stronger candidates than generic navigation links.

## Code Extraction Heuristics

Common login codes are:

- 4 to 8 digits
- 6 to 10 uppercase alphanumeric characters
- Surrounded by words such as "code", "OTP", "verification", "security", or "login"

When multiple codes appear:

- Prefer the newest message in the newest thread
- Prefer the code nearest the verification language
- Ignore reference numbers, ticket IDs, and dates

## Thread Handling

Some providers place the usable link or code in the latest reply inside an existing thread instead of a brand-new message.

- Fetch the full thread, not only the thread summary.
- Inspect the last message first.
- Fall back to earlier messages only if the newest message is clearly incomplete.

## Deterministic Parsing

Use `scripts/extract_login_artifact.py` when:

- Multiple candidate links exist
- The email arrives as raw JSON from API, CLI, or MCP output
- HTML formatting makes manual extraction error-prone
- A forced preference for `link` or `code` is needed
