# Prism

Prism is a standalone Next.js clarification workspace for turning rough ideas into execution-ready specs. It deploys on Vercel and stores durable state in Convex.

## Owns

- Clarification UI
- Session and draft editing surfaces
- Prism-specific prompt and research logic
- Prism-owned Convex schema and functions
- Prism test fixtures and supporting data

## Does not own

- Reader UI
- Inbox ingestion or persistence logic
- Wallet operations

## Boundary rules

- Keep Prism self-contained under `apps/prism`.
- Do not import from other app directories.
- Share only stable config or generic utilities through `../../packages`.

## Commands

```bash
# install dependencies from the repo root once
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
```

## Environment

- Next.js loads app-local env files, not the repo root `.env`
- Put Prism runtime values in `apps/prism/.env.local`
- Configure these values for local dev and Vercel:
  - `CONVEX_DEPLOYMENT` for local Convex development
  - `NEXT_PUBLIC_CONVEX_URL`
  - `NEXT_PUBLIC_APP_URL`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `EXA_API_KEY`
- Prism uses separate Convex development and production deployments.
- Commit only [apps/prism/.env.example](/Users/mjkang/Develop/AgentCompany/apps/prism/.env.example)

## Vercel Deployment

Prism deploys from the `apps/prism` directory on Vercel using the standard Next.js preset.

- `Framework Preset`: `Next.js`
- `Root Directory`: `apps/prism`
- `Install Command`: `npm install`
- `Build Command`: `npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npm run build"`

Set these Vercel environment variables:

- `CONVEX_DEPLOY_KEY`
- `NEXT_PUBLIC_APP_URL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `EXA_API_KEY`

## Convex setup

- Run `npx convex dev` from `apps/prism` to configure or update the development deployment.
- Convex functions live in `apps/prism/convex` and preserve Prism's external UUID session IDs.
- Next.js route handlers keep the LLM workflow server-side and use the Convex HTTP client for persistence.

## Implementation readiness

Readiness is recomputed from the current specification on every read, draft save,
answer, session-list response, and export. Legacy saved scores never grant Ready.
Reads do not rewrite old sessions. Document completeness is a separate display.

The implementation checks cover users, problem, first-version scope, non-goals,
constraints, and observable acceptance criteria. Missing or generic answers,
active requirement conflicts, and unclassified open questions block Ready.
The percentage represents check coverage, not a probability of project success;
blocked specs are capped below 80%. Expand the evidence to review each check.
A functional pass/fail result is valid without revenue or user-count metrics.
Quantitative goals require a threshold and measurement context.

Questions address detected conflicts and critical dependencies before remaining
core gaps. They accept free text without invented multiple-choice recommendations.
An insufficient answer gets a follow-up about the still-missing detail. There is
no round-count shortcut to Ready and no arbitrary interview cutoff.

`Decisions` contains currently applicable choices. `Decision History` retains
replaced choices across AI and manual edits; the transcript retains answers.
`Assumptions` contains unverified premises. Use `[non-blocker]` for optional items
in `Open Questions`; all other open questions are treated conservatively as
blockers. With no working model provider, answers update the targeted section
without inventing other requirements. Answers to free-form open questions are
preserved as unverified assumptions; confirm their resolution in the draft.

Both draft and ready bundles include the status, blockers, current goal, scope,
constraints, acceptance criteria, active decisions, decision history, assumptions,
and open questions. Draft exports explicitly say not ready for implementation.

“Try an example copy” creates a separate editable reading-queue session through
the normal creation and draft APIs. It starts with acceptance criteria unresolved.
Answer that question or edit the spec to see the same readiness checks change;
no example-specific scores or Ready flags are stored.

### Verification and limits

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from this
app. Readiness tests cover missing information, vague criteria, numeric targets,
functional acceptance, conflicting choices, non-blockers, manual re-opening,
export, history preservation, and example isolation.

The deterministic checks catch explicit gaps and known conflict patterns. They
are not a complete natural-language consistency proof. The configured model
also checks semantic conflicts while rewriting, and its warnings are retained
as blockers. Review the evidence for domain-specific omissions before starting
implementation. No database migration or new dependency is needed.
