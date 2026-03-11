"use client";

import { useMemo, useState } from "react";
import { chatPrompts, documents, type ReaderDocument, type ReaderHighlight } from "@/lib/mock-data";

type Scope = "library" | "feed";
type LibraryTab = "inbox" | "later" | "shortlist" | "archive";
type FeedTab = "feed";
type SideTab = "info" | "notebook" | "links";

type DocumentState = ReaderDocument & {
  docNote?: string;
};

const railItems: Array<{ id: Scope | "search" | "mail" | "settings"; label: string; glyph: string }> = [
  { id: "library", label: "Library", glyph: "▥" },
  { id: "feed", label: "Feed", glyph: "◌" },
  { id: "search", label: "Search", glyph: "⌕" },
  { id: "mail", label: "Mail", glyph: "✉" },
  { id: "settings", label: "Settings", glyph: "⌘" },
];

const sortOptions = ["Last opened", "Recently saved", "Reading time"];

const sourceIcon: Record<ReaderDocument["sourceType"], string> = {
  article: "◫",
  pdf: "▣",
  rss: "◍",
  epub: "▤",
  tweet: "◌",
};

function domainFor(source: string) {
  const normalized = source.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("weekly")) return "everywhereweekly.com";
  if (normalized.includes("dispatch")) return "notebookdispatch.io";
  if (normalized.includes("review")) return "annotationreview.org";
  return `${normalized}.com`;
}

function buildReply(document: DocumentState, prompt: string) {
  if (prompt.includes("three bullets")) {
    return document.summary.map((line) => `• ${line}`).join("\n");
  }

  if (prompt.includes("tagging")) {
    return `Suggested tags: ${document.tags.join(", ")}. Queue: ${document.section}. Source: ${document.sourceType}.`;
  }

  if (prompt.includes("Compare")) {
    return `Closest neighbors: "${documents[0].title}" for the all-in-one reading workspace thesis and "${documents[3].title}" for long-term highlight retention.`;
  }

  return document.summary[0];
}

export default function ReaderApp() {
  const [scope, setScope] = useState<Scope>("library");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("later");
  const [feedTab] = useState<FeedTab>("feed");
  const [sort, setSort] = useState(sortOptions[0]);
  const [sideTab, setSideTab] = useState<SideTab>("notebook");
  const [query, setQuery] = useState("");
  const [stateDocs, setStateDocs] = useState<DocumentState[]>(
    documents.map((document, index) => ({
      ...document,
      docNote: index === 0 ? "Capture the strongest lines and keep the notes compact." : "",
    })),
  );
  const [selectedId, setSelectedId] = useState("doc-1");
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>("h-1");
  const [draftDocNote, setDraftDocNote] = useState("Capture the strongest lines and keep the notes compact.");
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

  const visibleDocs = useMemo(() => {
    return stateDocs.filter((document) => {
      const inScope = scope === "library"
        ? document.section === libraryTab
        : document.section === feedTab;
      const haystack = `${document.title} ${document.author} ${document.source} ${document.tags.join(" ")}`.toLowerCase();
      return inScope && haystack.includes(query.toLowerCase());
    });
  }, [feedTab, libraryTab, query, scope, stateDocs]);

  const selectedDocument = visibleDocs.find((document) => document.id === selectedId) ?? visibleDocs[0] ?? stateDocs[0];
  const selectedHighlight = selectedDocument.highlights.find((highlight) => highlight.id === selectedHighlightId)
    ?? selectedDocument.highlights[0]
    ?? null;

  function selectDocument(id: string) {
    const document = visibleDocs.find((entry) => entry.id === id);
    if (!document) return;
    setSelectedId(id);
    setSelectedHighlightId(document.highlights[0]?.id ?? null);
    setDraftDocNote(document.docNote ?? "");
  }

  function updateDocument(nextDocument: DocumentState) {
    setStateDocs((current) => current.map((document) => (document.id === nextDocument.id ? nextDocument : document)));
  }

  function saveDocNote() {
    updateDocument({
      ...selectedDocument,
      docNote: draftDocNote,
    });
  }

  function sendPrompt(prompt: string) {
    const reply = buildReply(selectedDocument, prompt);
    setChatHistory((current) => [
      ...current,
      { role: "user", text: prompt },
      { role: "assistant", text: reply },
    ]);
    setSideTab("notebook");
  }

  return (
    <main className="reader-app">
      <aside className="rail">
        <a className="rail-logo" href="/login" aria-label="Reader home">
          <span>R</span>
        </a>

        <nav className="rail-nav" aria-label="Primary">
          {railItems.map((item) => {
            const active = item.id === scope;
            return (
              <button
                key={item.id}
                type="button"
                className={`rail-button ${active ? "active" : ""}`}
                aria-label={item.label}
                onClick={() => {
                  if (item.id === "library" || item.id === "feed") {
                    setScope(item.id);
                  }
                }}
              >
                <span>{item.glyph}</span>
              </button>
            );
          })}
        </nav>

        <div className="rail-footer">
          <button type="button" className="rail-button ghost" aria-label="Add item">
            <span>＋</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="topbar-brand">
              <span className="topbar-icon">▥</span>
              <span>Library</span>
            </button>

            <div className="tabset">
              <button
                type="button"
                className={`top-tab ${scope === "library" && libraryTab === "inbox" ? "active" : ""}`}
                onClick={() => {
                  setScope("library");
                  setLibraryTab("inbox");
                }}
              >
                Inbox
              </button>
              <button
                type="button"
                className={`top-tab ${scope === "library" && libraryTab === "later" ? "active" : ""}`}
                onClick={() => {
                  setScope("library");
                  setLibraryTab("later");
                }}
              >
                Later
              </button>
              <button
                type="button"
                className={`top-tab ${scope === "library" && libraryTab === "shortlist" ? "active" : ""}`}
                onClick={() => {
                  setScope("library");
                  setLibraryTab("shortlist");
                }}
              >
                Shortlist
              </button>
              <button
                type="button"
                className={`top-tab ${scope === "library" && libraryTab === "archive" ? "active" : ""}`}
                onClick={() => {
                  setScope("library");
                  setLibraryTab("archive");
                }}
              >
                Archive
              </button>
            </div>
          </div>

          <div className="topbar-right">
            <button type="button" className="topbar-link">Manage tags</button>
            <button type="button" className="topbar-link">{sort}</button>
          </div>
        </header>

        <div className="content-grid">
          <section className="list-pane">
            <div className="pane-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, authors, tags"
                aria-label="Search library"
              />
            </div>

            <div className="rows">
              {visibleDocs.map((document) => {
                const active = document.id === selectedDocument.id;
                return (
                  <button
                    key={document.id}
                    type="button"
                    className={`doc-row ${active ? "active" : ""}`}
                    onClick={() => selectDocument(document.id)}
                  >
                    <div className="doc-thumb">
                      <span>{sourceIcon[document.sourceType]}</span>
                    </div>

                    <div className="doc-body">
                      <div className="doc-title-row">
                        <h2>{document.title}</h2>
                        <span className="doc-date">{document.savedAt}</span>
                      </div>

                      <div className="doc-summary-row">
                        <p className="doc-summary">{document.summary[0]}</p>
                        {active ? (
                          <div className="row-tools" aria-hidden="true">
                            <span>⋯</span>
                            <span>◔</span>
                            <span>⌵</span>
                          </div>
                        ) : null}
                      </div>

                      <div className="doc-meta">
                        <span>{domainFor(document.source)}</span>
                        <span>{document.author}</span>
                        <span>{document.readingTime}</span>
                        {document.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="meta-tag">{tag}</span>
                        ))}
                      </div>
                    </div>

                    {active ? (
                      <>
                        <div className="row-accent" />
                        <div className="row-progress" style={{ width: `${Math.max(document.progress, 12)}%` }} />
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="side-pane">
            <div className="side-tabs">
              <button
                type="button"
                className={`side-tab ${sideTab === "info" ? "active" : ""}`}
                onClick={() => setSideTab("info")}
              >
                Info
              </button>
              <button
                type="button"
                className={`side-tab ${sideTab === "notebook" ? "active" : ""}`}
                onClick={() => setSideTab("notebook")}
              >
                Notebook
                <span className="side-count">{selectedDocument.highlights.length}</span>
              </button>
              <button
                type="button"
                className={`side-tab ${sideTab === "links" ? "active" : ""}`}
                onClick={() => setSideTab("links")}
              >
                Links
              </button>
            </div>

            {sideTab === "notebook" ? (
              <div className="side-scroll">
                <section className="side-section">
                  <p className="side-label">Document note</p>
                  <textarea
                    value={draftDocNote}
                    onChange={(event) => setDraftDocNote(event.target.value)}
                    placeholder="Add a document note..."
                    aria-label="Document note"
                  />
                </section>

                <section className="side-section">
                  <div className="section-header">
                    <p className="side-label">Highlights</p>
                    <div className="chip-row">
                      {chatPrompts.slice(0, 2).map((prompt) => (
                        <button key={prompt} type="button" className="mini-chip" onClick={() => sendPrompt(prompt)}>
                          {prompt.includes("three bullets") ? "Summarize" : "Reusable insight"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="highlight-stack">
                    {selectedDocument.highlights.map((highlight) => (
                      <button
                        key={highlight.id}
                        type="button"
                        className={`highlight-strip ${selectedHighlight?.id === highlight.id ? "active" : ""}`}
                        onClick={() => setSelectedHighlightId(highlight.id)}
                      >
                        <span>{highlight.text}</span>
                        {highlight.note ? <small>{highlight.note}</small> : null}
                      </button>
                    ))}
                  </div>
                </section>

                <button type="button" className="save-button" onClick={saveDocNote}>
                  Save note
                </button>
              </div>
            ) : null}

            {sideTab === "info" ? (
              <div className="side-scroll">
                <section className="side-section">
                  <p className="side-label">Document</p>
                  <dl className="info-list">
                    <div>
                      <dt>Title</dt>
                      <dd>{selectedDocument.title}</dd>
                    </div>
                    <div>
                      <dt>Author</dt>
                      <dd>{selectedDocument.author}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{domainFor(selectedDocument.source)}</dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{selectedDocument.readingTime}</dd>
                    </div>
                  </dl>
                </section>
              </div>
            ) : null}

            {sideTab === "links" ? (
              <div className="side-scroll">
                <section className="side-section">
                  <p className="side-label">Actions</p>
                  <div className="link-list">
                    <button type="button" className="link-row">Open original</button>
                    <button type="button" className="link-row">Move to Later</button>
                    <button type="button" className="link-row">Copy highlights</button>
                  </div>
                </section>

                {chatHistory.length > 0 ? (
                  <section className="side-section">
                    <p className="side-label">Ghostreader</p>
                    <div className="chat-stack">
                      {chatHistory.map((entry, index) => (
                        <div key={`${entry.role}-${index}`} className={`chat-card ${entry.role}`}>
                          <strong>{entry.role}</strong>
                          <p>{entry.text}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
