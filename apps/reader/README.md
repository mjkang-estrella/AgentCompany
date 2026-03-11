# Reader

Reader is a standalone static app that hosts the Reader-style reading UI prototype.

## Owns

- Reader-inspired article list and reading surface
- Static mock content for the prototype
- Local app runtime for serving the HTML UI

## Does not own

- Inbox ingestion, webhook handling, or persistence
- Prism workflows
- Shared runtime code for other apps

## Commands

```bash
npm run dev
```

The app serves [index.html](/Users/mjkang/Develop/AgentCompany/apps/reader/index.html) at `http://127.0.0.1:4173`.
