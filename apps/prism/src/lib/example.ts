// An editable copy created through the same session/draft APIs as a real project.
// Acceptance criteria intentionally remain unresolved so the user can see the gate.
export const EXAMPLE_SPEC = `# Example: Reading queue

## Overview
A personal reading queue for saving articles to read later.

## Problem
Readers lose article links scattered across browser tabs and chat messages.

## Users
Individual readers collecting articles on their own laptop.

## Goals
- Save a URL with a title to a local reading queue.
- Mark a saved article as read and filter unread articles.

## Non-Goals
- Team sharing, accounts, recommendations, and article extraction.

## Constraints
- Store the queue in this browser's local storage.
- Do not send saved URLs to a server.

## Success Criteria
_To be defined through clarification._

## Open Questions
- [non-blocker] Choose the empty-state illustration after the core workflow works.

## Decisions
- Build a standalone single-user web app.

## Decision History
None.

## Assumptions
- The reader uses the same browser profile between visits.
`;
export const EXAMPLE_ACCEPTANCE = `- When a reader saves a valid URL and title, the unread list shows that title and URL after a page reload.
- When a reader marks an article as read, it disappears from the unread filter and remains in the all-items list.
- When a reader submits an invalid URL, the form shows an error and does not create an item.`;
