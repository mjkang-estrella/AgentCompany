import {
  addIconHtml,
  allArticlesIconHtml,
  booksIconHtml,
  deleteIconHtml,
  editIconHtml,
  externalLinkIconHtml,
  fallbackFeedIconHtml,
  feedGroupIconHtml,
  feedsIconHtml,
  highlightsIconHtml,
  libraryIconHtml,
  menuIconHtml,
  nextIconHtml,
  previousIconHtml,
  savedIconHtml,
  settingsIconHtml,
  shareIconHtml,
  todayIconHtml,
  youtubeIconHtml
} from "./icons.js";
import {
  buildReaderPath,
  parseReaderPath,
  slugifySegment
} from "./lib/reader-routes.mjs";
import { normalizeFeedGroupName } from "./lib/feed-group-name.mjs";

const sanitizeHtml = (dirty) =>
  typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(dirty, {
      ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy", "src", "title"],
      ADD_TAGS: ["iframe"]
    })
    : dirty;

const PAGE_LIMIT = 50;
const LOAD_MORE_THRESHOLD = 240;
const THEME_STORAGE_KEY = "reader.theme";
const LEGACY_BOOKS_STORAGE_KEY = "reader.books.items";
const LEGACY_BOOK_NOTES_STORAGE_KEY = "reader.books.notes";
const LEGACY_BOOKS_MIGRATION_KEY = "reader.books.migrated.v1";
const MAX_BOOK_COVER_BYTES = 750_000;
const DIGEST_DATE_LABEL = "Today";
const emptyCounts = {
  all: 0,
  feedGroups: {},
  manual: 0,
  saved: 0,
  today: 0
};
const state = {
  articles: [],
  counts: { ...emptyCounts },
  convexUrl: "",
  canReturnToFeedGroups: false,
  calendarMonth: "",
  digest: null,
  digestDate: "",
  books: [],
  bookDialogCoverDataUrl: "",
  bookDialogEditingId: "",
  bookSaveFeedback: {
    message: "Synced",
    tone: "idle"
  },
  isLoadingBooks: false,
  feedGroup: "",
  hasMore: false,
  isHighlightsPanelOpen: true,
  isSyncingNewsletters: false,
  isLoadingArticle: false,
  isLoadingDigest: false,
  isLoadingMore: false,
  nextCursor: null,
  newsletterInboxEmail: "",
  newsletterStatus: null,
  explicitArticleSelection: false,
  pendingFeedGroupRemoval: "",
  overlayOpen: false,
  browseFeedGroups: false,
  scope: "today",
  editingBookSectionId: "",
  selectedBookId: "",
  selectedBookSectionId: "",
  theme: "auto",
  selectedArticle: null,
  selectedArticleId: ""
};

const elements = {
  addFeedButton: document.querySelector("#add-feed-button"),
  addFeedMenuButton: document.querySelector("#add-feed-menu-button"),
  addManualArticleButton: document.querySelector("#add-manual-article-button"),
  appLayout: document.querySelector(".app-layout"),
  articleCancelButton: document.querySelector("#article-cancel-button"),
  articleDialog: document.querySelector("#article-dialog"),
  articleForm: document.querySelector("#article-form"),
  articleList: document.querySelector("#article-list"),
  articleListPanel: document.querySelector("#article-list-panel"),
  articleUrlInput: document.querySelector("#article-url-input"),
  articleView: document.querySelector("#article-view"),
  bookCancelButton: document.querySelector("#book-cancel-button"),
  bookCoverFileInput: document.querySelector("#book-cover-file-input"),
  bookCoverPreview: document.querySelector("#book-cover-preview"),
  bookCoverPreviewFrame: document.querySelector("#book-cover-preview-frame"),
  bookDescriptionInput: document.querySelector("#book-description-input"),
  bookDialog: document.querySelector("#book-dialog"),
  bookDialogCopy: document.querySelector("#book-dialog-copy"),
  bookDialogTitle: document.querySelector("#book-dialog-title"),
  bookEditButton: document.querySelector("#book-edit-button"),
  bookEditSeparator: document.querySelector("#book-edit-separator"),
  bookForm: document.querySelector("#book-form"),
  bookAuthorInput: document.querySelector("#book-author-input"),
  bookOutlineInput: document.querySelector("#book-outline-input"),
  bookRemoveCoverButton: document.querySelector("#book-remove-cover-button"),
  bookSubmitButton: document.querySelector("#book-submit-button"),
  bookStatusInput: document.querySelector("#book-status-input"),
  bookTitleInput: document.querySelector("#book-title-input"),
  deleteArticleButton: document.querySelector("#delete-article-button"),
  inspectorCloseButton: document.querySelector("#inspector-close-button"),
  inspectorPanel: document.querySelector("#inspector-panel"),
  inspectorPanelBody: document.querySelector("#inspector-panel-body"),
  feedCancelButton: document.querySelector("#feed-cancel-button"),
  feedDialog: document.querySelector("#feed-dialog"),
  feedGroupList: document.querySelector("#feed-groups-list"),
  feedForm: document.querySelector("#feed-form"),
  feedGroupInput: document.querySelector("#feed-group-input"),
  feedUrlInput: document.querySelector("#feed-url-input"),
  listActions: document.querySelector(".list-actions"),
  listBackButton: document.querySelector("#list-back-button"),
  listMenu: document.querySelector("#list-menu"),
  listMenuButton: document.querySelector("#list-menu-button"),
  listTitle: document.querySelector("#list-title"),
  navAll: document.querySelector("#nav-all"),
  navFeeds: document.querySelector("#nav-feeds"),
  navBooks: document.querySelector("#nav-books"),
  navManualArticles: document.querySelector("#nav-manual-articles"),
  navSaved: document.querySelector("#nav-saved"),
  navToday: document.querySelector("#nav-today"),
  navYoutube: document.querySelector("#nav-youtube"),
  newsletterCopyButton: document.querySelector("#newsletter-copy-button"),
  newsletterStatusCopy: document.querySelector("#newsletter-status-copy"),
  newsletterSyncButton: document.querySelector("#newsletter-sync-button"),
  nextArticleButton: document.querySelector("#next-article-button"),
  openArticleButton: document.querySelector("#open-article-button"),
  toggleHighlightsButton: document.querySelector("#toggle-highlights-button"),

  paneContentScroll: document.querySelector(".pane-content-scroll"),
  previousArticleButton: document.querySelector("#previous-article-button"),
  renameFeedGroupButton: document.querySelector("#rename-feed-group-button"),
  renameFeedGroupCancelButton: document.querySelector("#rename-feed-group-cancel-button"),
  renameFeedGroupDialog: document.querySelector("#rename-feed-group-dialog"),
  renameFeedGroupForm: document.querySelector("#rename-feed-group-form"),
  renameFeedGroupInput: document.querySelector("#rename-feed-group-input"),
  removeFeedGroupButton: document.querySelector("#remove-feed-group-button"),
  removeFeedGroupCancelButton: document.querySelector("#remove-feed-group-cancel-button"),
  removeFeedGroupConfirmButton: document.querySelector("#remove-feed-group-confirm-button"),
  removeFeedGroupCopy: document.querySelector("#remove-feed-group-copy"),
  removeFeedGroupDialog: document.querySelector("#remove-feed-group-dialog"),
  removeFeedGroupForm: document.querySelector("#remove-feed-group-form"),
  saveArticleButton: document.querySelector("#save-article-button"),
  settingsButton: document.querySelector("#settings-button"),
  settingsCloseButton: document.querySelector("#settings-close-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  shareArticleButton: document.querySelector("#share-article-button"),
  themeAutoButton: document.querySelector("#theme-auto-button"),
  themeDarkButton: document.querySelector("#theme-dark-button"),
  themeLightButton: document.querySelector("#theme-light-button"),
  manualSyncButton: document.querySelector("#manual-sync-button"),
  toast: document.querySelector("#toast")
};

let toastTimer = null;
let feedGroupEditedManually = false;
let articleRequestToken = 0;
let isListMenuOpen = false;
let isApplyingRoute = false;
const pendingBookSyncTimers = new Map();

const applyStaticIcons = () => {
  elements.navToday.innerHTML = todayIconHtml;
  elements.navAll.innerHTML = allArticlesIconHtml;
  elements.navSaved.innerHTML = savedIconHtml;
  elements.navFeeds.innerHTML = feedsIconHtml;
  elements.navManualArticles.innerHTML = libraryIconHtml;
  elements.navYoutube.innerHTML = youtubeIconHtml;
  elements.navBooks.innerHTML = booksIconHtml;
  elements.bookEditButton.innerHTML = editIconHtml;
  elements.addManualArticleButton.innerHTML = addIconHtml;
  elements.listBackButton.innerHTML = previousIconHtml.replace('width="20"', 'width="18"').replace('height="20"', 'height="18"');
  elements.listMenuButton.innerHTML = menuIconHtml;
  elements.previousArticleButton.innerHTML = previousIconHtml;
  elements.nextArticleButton.innerHTML = nextIconHtml;
  elements.saveArticleButton.innerHTML = savedIconHtml.replace('width="18"', 'width="20"').replace('height="18"', 'height="20"');
  elements.shareArticleButton.innerHTML = shareIconHtml;
  elements.toggleHighlightsButton.innerHTML = highlightsIconHtml;
  elements.deleteArticleButton.innerHTML = deleteIconHtml;
  elements.openArticleButton.innerHTML = `Original ${externalLinkIconHtml}`;
  elements.settingsButton.innerHTML = settingsIconHtml;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);

const canOpenExternalArticle = (article) =>
  Boolean(article?.url && /^https?:\/\//iu.test(article.url));

const isYouTubeArticle = (article) =>
  Boolean(article) && (
    article.feedTitle === "YouTube" ||
    /(?:youtube\.com|youtu\.be)/iu.test(String(article.url || article.canonicalUrl || ""))
  );

const isLibraryLikeScope = () => state.scope === "manual" || state.scope === "youtube";
const isBooksMode = () => state.scope === "books";
const isNarrowViewport = () => window.matchMedia("(max-width: 640px)").matches;

const BOOK_COVER_THEMES = [
  { accent: "linear-gradient(160deg, #C96B3B 0%, #7B341E 100%)", coverTone: "Warm Copper" },
  { accent: "linear-gradient(160deg, #234E52 0%, #0F172A 100%)", coverTone: "Sea Ink" },
  { accent: "linear-gradient(160deg, #312E81 0%, #111827 100%)", coverTone: "Indigo Signal" },
  { accent: "linear-gradient(160deg, #3F3F46 0%, #18181B 100%)", coverTone: "Stone Archive" },
  { accent: "linear-gradient(160deg, #14532D 0%, #052E16 100%)", coverTone: "Forest Study" },
  { accent: "linear-gradient(160deg, #7C2D12 0%, #431407 100%)", coverTone: "Editorial Brick" }
];

const saveBooksToState = (books) => {
  state.books = books;
};

const getBookById = (bookId) => state.books.find((book) => book.id === bookId) || null;
const getSelectedBookSection = (book) => {
  if (!book) {
    return null;
  }

  const sections = Array.isArray(book.sections) ? book.sections : [];
  return sections.find((section) => section.id === state.selectedBookSectionId) || sections[0] || null;
};

const findBookBySlug = (slug) =>
  state.books.find((book) => slugifySegment(book.title) === String(slug || "")) || null;

const setBookSaveFeedback = (message, tone = "idle") => {
  state.bookSaveFeedback = { message, tone };
  const status = elements.articleView.querySelector("[data-book-save-status]");
  if (status) {
    status.textContent = message;
    status.classList.remove("is-error", "is-success");
    if (tone === "error") {
      status.classList.add("is-error");
    } else if (tone === "success") {
      status.classList.add("is-success");
    }
  }
};

const readLegacyJson = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const updateBookInState = (bookId, updater) => {
  state.books = state.books.map((book) => {
    if (book.id !== bookId) {
      return book;
    }

    return typeof updater === "function"
      ? updater(book)
      : { ...book, ...updater };
  });
};

const replaceBookInState = (nextBook) => {
  const existing = state.books.some((book) => book.id === nextBook.id);
  state.books = existing
    ? state.books.map((book) => book.id === nextBook.id ? nextBook : book)
    : [nextBook, ...state.books];
};

const clearPendingBookSync = (key) => {
  const timer = pendingBookSyncTimers.get(key);
  if (timer) {
    window.clearTimeout(timer);
    pendingBookSyncTimers.delete(key);
  }
};

const scheduleBookSync = (key, task, successMessage) => {
  clearPendingBookSync(key);
  setBookSaveFeedback("Saving…", "idle");
  const timer = window.setTimeout(async () => {
    pendingBookSyncTimers.delete(key);
    try {
      const savedBook = await task();
      if (savedBook?.id) {
        replaceBookInState(mapBookRecord(savedBook));
      }
      setBookSaveFeedback(successMessage, "success");
    } catch (error) {
      console.error(error);
      setBookSaveFeedback("Couldn’t sync changes right now.", "error");
      showToast(error.message || "Couldn’t sync changes right now.", { error: true });
    }
  }, 400);
  pendingBookSyncTimers.set(key, timer);
};

const loadBooks = async ({ preserveSelection = true } = {}) => {
  state.isLoadingBooks = true;
  if (isBooksMode()) {
    render();
  }

  try {
    const legacyMigrationDone = window.localStorage.getItem(LEGACY_BOOKS_MIGRATION_KEY) === "1";
    if (!legacyMigrationDone) {
      const legacyBooks = readLegacyJson(LEGACY_BOOKS_STORAGE_KEY, null);
      const legacyNotes = readLegacyJson(LEGACY_BOOK_NOTES_STORAGE_KEY, {});
      if (Array.isArray(legacyBooks) && legacyBooks.length > 0) {
        await convexRequest("mutation", "books:migrateLegacyShelf", {
          books: legacyBooks,
          notesByBookId: legacyNotes
        });
        window.localStorage.setItem(LEGACY_BOOKS_MIGRATION_KEY, "1");
        window.localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_BOOK_NOTES_STORAGE_KEY);
        window.localStorage.removeItem("reader.books.highlights");
      } else {
        window.localStorage.setItem(LEGACY_BOOKS_MIGRATION_KEY, "1");
      }
    }

    await convexRequest("mutation", "books:ensureDefaultShelf", {});
    const books = await convexRequest("query", "books:list", {});
    saveBooksToState(books.map(mapBookRecord));

    if (preserveSelection && state.selectedBookId) {
      state.selectedBookId = getBookById(state.selectedBookId)?.id || books[0]?.id || "";
    } else {
      state.selectedBookId = books[0]?.id || "";
    }
    const currentBook = getBookById(state.selectedBookId);
    state.selectedBookSectionId = getSelectedBookSection(currentBook)?.id || "";
  } finally {
    state.isLoadingBooks = false;
  }
};

const mapBookRecord = (book) => ({
  accent: book.accent || getBookTheme(book.title).accent,
  author: book.author || "",
  coverImage: book.coverImage || "",
  coverTone: book.coverTone || getBookTheme(book.title).coverTone,
  description: book.description || "",
  id: book.id,
  sections: Array.isArray(book.sections) && book.sections.length > 0
    ? book.sections.map((section) => ({
      id: section.id,
      notes: section.notes || "",
      status: section.status || "todo",
      title: section.title || "Untitled section"
    }))
    : [createBookSection("Overview")],
  slug: book.slug || slugifySegment(book.title),
  status: book.status || "Reading",
  title: book.title || "Untitled book",
  updatedAt: book.updatedAt || ""
});

const getBookTheme = (seed) => {
  const normalized = String(seed || "");
  let total = 0;
  for (const character of normalized) {
    total += character.charCodeAt(0);
  }
  return BOOK_COVER_THEMES[total % BOOK_COVER_THEMES.length];
};

const createBookId = (title) => {
  const base = slugifySegment(title || "book");
  const existingIds = new Set(state.books.map((book) => book.id));
  if (!existingIds.has(base)) {
    return base;
  }

  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
};

const createBookSection = (title = "Untitled section", index = 0) => ({
  id: `${slugifySegment(title || "section")}-${Date.now()}-${index + 1}`,
  notes: "",
  status: "todo",
  title
});

const normalizeSectionKey = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();

const parseBookOutlineSections = (outlineText) => {
  const lines = String(outlineText || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const headingLines = lines
    .map((line) => line.replace(/^#{2,}\s*/u, "").trim())
    .filter((line, index) => /^#{2,}\s/u.test(lines[index]));

  const candidateLines = headingLines.length > 0
    ? headingLines
    : lines
      .map((line) => line
        .replace(/^[-*]\s+/u, "")
        .replace(/^\d+\.\s+/u, "")
        .trim()
      )
      .filter((line) => line.length > 0 && line.length < 160);

  return candidateLines.filter((line, index, array) =>
    array.findIndex((candidate) => normalizeSectionKey(candidate) === normalizeSectionKey(line)) === index
  );
};

const mergeSectionsFromOutline = (existingSections, outlineText) => {
  const titles = parseBookOutlineSections(outlineText);
  if (titles.length === 0) {
    return existingSections;
  }

  const existingBySlug = new Map(
    existingSections.map((section) => [normalizeSectionKey(section.title), section])
  );

  return titles.map((title, index) => {
    const existing = existingBySlug.get(normalizeSectionKey(title));
    if (existing) {
      return {
        ...existing,
        title
      };
    }

    return createBookSection(title, index);
  });
};

const patchBookSections = (bookId, updater) => {
  const book = getBookById(bookId);
  if (!book) {
    return [];
  }

  const nextSections = updater(Array.isArray(book.sections) ? book.sections : []);
  updateBookInState(bookId, { sections: nextSections });
  return nextSections;
};

const advanceBookSection = (bookId, sectionId) => {
  if (!bookId || !sectionId) {
    return;
  }

  const book = getBookById(bookId);
  const sections = Array.isArray(book?.sections) ? book.sections : [];
  const currentIndex = sections.findIndex((section) => section.id === sectionId);
  if (currentIndex === -1) {
    return;
  }

  const nextSectionId = sections[currentIndex + 1]?.id || sectionId;
  const nextSections = patchBookSections(bookId, (items) =>
    items.map((section) => section.id === sectionId
      ? { ...section, status: "done" }
      : section)
  );

  state.selectedBookSectionId = nextSectionId;
  state.explicitArticleSelection = true;
  scheduleBookSync(`sections:${bookId}`, () =>
    convexRequest("mutation", "books:updateSections", {
      bookId,
      sections: nextSections
    }),
  "Sections synced");
  syncRoute({ replace: false });
  render();
};

const commitBookSectionTitle = (bookId, sectionId, nextTitle) => {
  const book = getBookById(bookId);
  const currentSection = Array.isArray(book?.sections)
    ? book.sections.find((section) => section.id === sectionId)
    : null;
  if (!bookId || !sectionId || !currentSection) {
    state.editingBookSectionId = "";
    return;
  }

  const normalizedTitle = String(nextTitle || "").trim() || currentSection.title || "Untitled section";
  state.editingBookSectionId = "";
  const nextSections = patchBookSections(bookId, (sections) =>
    sections.map((section) => section.id === sectionId
      ? { ...section, title: normalizedTitle }
      : section)
  );
  scheduleBookSync(`sections:${bookId}`, () =>
    convexRequest("mutation", "books:updateSections", {
      bookId,
      sections: nextSections
    }),
  "Sections synced");
  render();
};

window.__readerAdvanceBookSection = advanceBookSection;

const renderBookCoverMarkup = (book, className = "book-cover") => {
  const tone = book.coverTone || "";

  if (book.coverImage) {
    return `
      <div class="${className} is-image-cover" style="--book-accent:${book.accent}">
        <img class="book-cover-image" src="${escapeHtml(book.coverImage)}" alt="${escapeHtml(book.title)} cover">
      </div>
    `;
  }

  return `
    <div class="${className}" style="--book-accent:${book.accent}">
      <div class="book-cover-tone">${escapeHtml(tone)}</div>
      <div class="book-cover-title">${escapeHtml(book.title)}</div>
      <div class="book-cover-author">${escapeHtml(book.author)}</div>
    </div>
  `;
};

const getYouTubeVideoIdFromUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.replace(/^www\./iu, "");

    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || "";
    }

    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname)) {
      return "";
    }

    if (url.pathname === "/watch") {
      return url.searchParams.get("v") || "";
    }

    const [, resource, id] = url.pathname.split("/");
    if (resource === "shorts" || resource === "embed" || resource === "live") {
      return id || "";
    }

    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
};

const buildYouTubeHero = (value, title) => {
  const videoId = getYouTubeVideoIdFromUrl(value);
  if (!videoId) {
    return "";
  }

  return `
    <div class="article-video-frame">
      <iframe
        src="https://www.youtube.com/embed/${escapeHtml(videoId)}?rel=0"
        title="${escapeHtml(title || "YouTube video")}"
        data-youtube-player="true"
        data-youtube-video-id="${escapeHtml(videoId)}"
        loading="eager"
        referrerpolicy="strict-origin-when-cross-origin"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    </div>
  `;
};

const formatMonthLabel = (localDate) => {
  const [year, month] = String(localDate || "").split("-").map(Number);
  if (!year || !month) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
};

const formatListTime = (isoString) => {
  const date = new Date(isoString);
  const now = new Date();
  const dayDiff = new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dayDiff === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  if (dayDiff === 86_400_000) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(date);
};

const formatArticleDate = (isoString) =>
  new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(isoString));

const shiftLocalDate = (localDate, dayOffset) => {
  const [year, month, day] = String(localDate || "").split("-").map(Number);
  if (!year || !month || !day || !Number.isFinite(dayOffset)) {
    return localDate;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

const startOfMonthKey = (localDate) => {
  const [year, month] = String(localDate || "").split("-").map(Number);
  if (!year || !month) {
    return "";
  }

  return `${year}-${String(month).padStart(2, "0")}-01`;
};

const shiftMonth = (localDate, monthOffset) => {
  const [year, month] = String(localDate || "").split("-").map(Number);
  if (!year || !month || !Number.isFinite(monthOffset)) {
    return localDate;
  }

  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + monthOffset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

const compareLocalDates = (left, right) => String(left || "").localeCompare(String(right || ""));

const buildCalendarDays = (monthKey) => {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) {
    return [];
  }

  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ key: `empty-${index}`, label: "", outside: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      label: String(day),
      outside: false
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-tail-${cells.length}`, label: "", outside: true });
  }

  return cells;
};

const isTodaySidebarMode = () => state.scope === "today" && !state.feedGroup && !state.browseFeedGroups;

const getArticleBodyElement = () => elements.articleView.querySelector(".article-body");

const HIGHLIGHT_CONTEXT_CHARS = 48;
const HIGHLIGHT_MIN_LENGTH = 3;
let isHighlightInProgress = false;

const collectArticleTextNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const nodes = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }

  return nodes;
};

const getRangeTextOffset = (root, container, offset) => {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(container, offset);
  return range.cloneContents().textContent.length;
};

const resolveHighlightOffsets = (fullText, highlight) => {
  if (!fullText || !highlight.selectedText) {
    return null;
  }

  if (
    highlight.startOffset >= 0 &&
    highlight.endOffset <= fullText.length &&
    fullText.slice(highlight.startOffset, highlight.endOffset) === highlight.selectedText
  ) {
    return { endOffset: highlight.endOffset, startOffset: highlight.startOffset };
  }

  let bestMatch = null;
  let bestScore = -1;
  let searchIndex = 0;

  while (true) {
    const matchIndex = fullText.indexOf(highlight.selectedText, searchIndex);
    if (matchIndex === -1) break;

    const before = fullText.slice(Math.max(0, matchIndex - (highlight.prefixText || "").length), matchIndex);
    const after = fullText.slice(
      matchIndex + highlight.selectedText.length,
      matchIndex + highlight.selectedText.length + (highlight.suffixText || "").length
    );
    let score = 0;
    if (highlight.prefixText && before.endsWith(highlight.prefixText)) score += highlight.prefixText.length + 20;
    if (highlight.suffixText && after.startsWith(highlight.suffixText)) score += highlight.suffixText.length + 20;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { endOffset: matchIndex + highlight.selectedText.length, startOffset: matchIndex };
    }

    searchIndex = matchIndex + Math.max(1, highlight.selectedText.length);
  }

  return bestMatch;
};

const wrapHighlightRange = (root, startOffset, endOffset, highlightId) => {
  const textNodes = collectArticleTextNodes(root);
  let cursor = 0;

  for (const node of textNodes) {
    const length = node.textContent.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + length;
    cursor = nodeEnd;

    if (nodeEnd <= startOffset || nodeStart >= endOffset) continue;

    const localStart = Math.max(0, startOffset - nodeStart);
    const localEnd = Math.min(length, endOffset - nodeStart);
    if (localStart >= localEnd) continue;

    const text = node.textContent;
    const fragment = document.createDocumentFragment();

    if (localStart > 0) fragment.append(document.createTextNode(text.slice(0, localStart)));

    const mark = document.createElement("mark");
    mark.className = "article-highlight";
    mark.dataset.highlightId = highlightId;
    mark.tabIndex = 0;
    mark.append(document.createTextNode(text.slice(localStart, localEnd)));
    fragment.append(mark);

    if (localEnd < length) fragment.append(document.createTextNode(text.slice(localEnd)));

    node.parentNode.replaceChild(fragment, node);
  }
};

const applyHighlightsToArticleBody = (root, highlights = []) => {
  const fullText = root.textContent || "";
  const resolved = [];

  for (const h of [...highlights].sort((a, b) => a.startOffset - b.startOffset)) {
    const offsets = resolveHighlightOffsets(fullText, h);
    if (!offsets || offsets.startOffset === offsets.endOffset) {
      resolved.push({ ...h, resolved: false });
      continue;
    }
    wrapHighlightRange(root, offsets.startOffset, offsets.endOffset, h.id);
    resolved.push({ ...h, resolved: true, ...offsets });
  }

  return resolved;
};

const truncateHighlightText = (value) => {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

const buildSelectionPayload = (root, range) => {
  const startOffset = getRangeTextOffset(root, range.startContainer, range.startOffset);
  const endOffset = getRangeTextOffset(root, range.endContainer, range.endOffset);
  const fullText = root.textContent || "";

  let start = Math.max(0, Math.min(startOffset, fullText.length));
  let end = Math.max(start, Math.min(endOffset, fullText.length));

  while (start < end && /\s/u.test(fullText[start] || "")) start += 1;
  while (end > start && /\s/u.test(fullText[end - 1] || "")) end -= 1;

  const selectedText = fullText.slice(start, end);
  if (!selectedText || selectedText.length < HIGHLIGHT_MIN_LENGTH) return null;

  return {
    endOffset: end,
    prefixText: fullText.slice(Math.max(0, start - HIGHLIGHT_CONTEXT_CHARS), start),
    selectedText,
    startOffset: start,
    suffixText: fullText.slice(end, Math.min(fullText.length, end + HIGHLIGHT_CONTEXT_CHARS))
  };
};

const renderHighlightsRail = () => {
  if (!elements.inspectorPanelBody) {
    return;
  }

  elements.inspectorPanel.hidden = !state.isHighlightsPanelOpen;
  if (!state.isHighlightsPanelOpen) {
    elements.inspectorPanelBody.innerHTML = "";
    return;
  }

  const highlights = state.selectedArticle?.highlights || [];
  const inspectorTitle = `${highlights.length} Highlight${highlights.length === 1 ? "" : "s"}`;
  const titleElement = elements.inspectorPanel.querySelector(".inspector-panel-title");
  if (titleElement) {
    titleElement.textContent = inspectorTitle;
  }

  elements.inspectorPanelBody.innerHTML = `
    <div class="inspector-section">
      ${highlights.length === 0
        ? '<div class="inspector-empty">Select text in the article to highlight it.</div>'
        : `<div class="inspector-list">
         ${highlights.map((h) => {
           const hasMark = Boolean(elements.articleView.querySelector(`[data-highlight-id="${CSS.escape(h.id)}"]`));
           return `
             <div class="highlight-item ${hasMark ? "" : "is-unresolved"}">
               <div class="highlight-item-row">
                 <button class="highlight-jump-btn" data-highlight-jump-id="${h.id}" type="button">
                   <div class="highlight-item-text">${escapeHtml(truncateHighlightText(h.selectedText))}</div>
                 </button>
                 <button class="icon-btn highlight-remove-inline" data-highlight-remove-id="${h.id}" type="button" aria-label="Remove highlight">×</button>
               </div>
             </div>`;
         }).join("")}
       </div>`}
    </div>
  `;
};

const unwrapHighlightMarks = (root, highlightId) => {
  for (const mark of root.querySelectorAll(`[data-highlight-id="${CSS.escape(highlightId)}"]`)) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
};

const instantHighlight = async () => {
  const root = getArticleBodyElement();
  const selection = window.getSelection();
  if (!state.selectedArticle || !root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  if (isHighlightInProgress) return;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const startParent = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  if (startParent?.closest("[data-highlight-id]")) return;

  const payload = buildSelectionPayload(root, range);
  if (!payload) return;

  isHighlightInProgress = true;
  const currentArticleId = state.selectedArticle.id;
  const tempId = `temp-${Date.now()}`;

  wrapHighlightRange(root, payload.startOffset, payload.endOffset, tempId);
  selection.removeAllRanges();

  try {
    const result = await convexRequest("mutation", "reader:addHighlight", {
      articleId: currentArticleId,
      endOffset: payload.endOffset,
      prefixText: payload.prefixText,
      selectedText: payload.selectedText,
      startOffset: payload.startOffset,
      suffixText: payload.suffixText
    });

    for (const mark of root.querySelectorAll(`[data-highlight-id="${tempId}"]`)) {
      mark.dataset.highlightId = result.id;
    }

    if (state.selectedArticle && state.selectedArticle.id === currentArticleId) {
      state.selectedArticle.highlights = [
        ...(state.selectedArticle.highlights || []),
        { id: result.id, color: result.color || "amber", ...payload }
      ];
      renderHighlightsRail();
    }
  } catch (error) {
    unwrapHighlightMarks(root, tempId);
    showToast(error.message, { error: true });
  } finally {
    isHighlightInProgress = false;
  }
};

const removeHighlight = async (highlightId) => {
  const root = getArticleBodyElement();
  if (root) unwrapHighlightMarks(root, highlightId);

  if (state.selectedArticle) {
    state.selectedArticle.highlights = (state.selectedArticle.highlights || []).filter((h) => h.id !== highlightId);
    renderHighlightsRail();
  }

  try {
    await convexRequest("mutation", "reader:removeHighlight", { highlightId });
  } catch (error) {
    if (state.selectedArticleId) await loadArticle(state.selectedArticleId);
    showToast(error.message, { error: true });
  }
};

const listTitle = () => {
  if (state.feedGroup) {
    return state.feedGroup;
  }

  if (state.scope === "today") {
    if (state.digestDate && state.digest?.todayLocalDate && state.digestDate !== state.digest.todayLocalDate) {
      return formatArticleDate(`${state.digestDate}T00:00:00.000Z`);
    }

    return "Daily Digest";
  }

  if (state.scope === "saved") {
    return "Saved";
  }

  if (state.scope === "manual") {
    return "Library";
  }

  if (state.scope === "youtube") {
    return "YouTube";
  }

  if (state.scope === "books") {
    return "Books";
  }

  return "All Articles";
};

const isTodayDigestMode = () => state.scope === "today" && !state.feedGroup;

const showToast = (message, options = {}) => {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  elements.toast.classList.toggle("is-error", Boolean(options.error));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    elements.toast.classList.remove("is-error");
  }, 3200);
};

const syncListMenuState = () => {
  elements.listMenu.hidden = !isListMenuOpen;
  elements.listMenuButton.setAttribute("aria-expanded", isListMenuOpen ? "true" : "false");
};

const openListMenu = () => {
  isListMenuOpen = true;
  syncListMenuState();
  const firstItem = elements.listMenu.querySelector(".list-menu-item:not([hidden]):not(:disabled)");
  if (firstItem) {
    firstItem.focus();
  }
};

const closeListMenu = () => {
  isListMenuOpen = false;
  syncListMenuState();
  elements.listMenuButton.focus();
};

const toggleListMenu = () => {
  isListMenuOpen = !isListMenuOpen;
  syncListMenuState();
};

const openPanel = () => {
  state.overlayOpen = true;
  elements.articleListPanel.classList.add("is-open");
};

const closePanel = () => {
  state.overlayOpen = false;
  elements.articleListPanel.classList.remove("is-open");
  closeListMenu();
};

const articleIndex = () =>
  state.articles.findIndex((article) => article.id === state.selectedArticleId);

const feedIconMarkup = (iconUrl) =>
  iconUrl
    ? `<img class="feed-icon-small" src="${escapeHtml(iconUrl)}" alt="" referrerpolicy="no-referrer">`
    : fallbackFeedIconHtml;

const titleCaseWord = (word) =>
  word ? word.charAt(0).toUpperCase() + word.slice(1) : "";

const deriveFeedGroupFromUrl = (value) => {
  if (!value) {
    return "";
  }

  try {
    const normalizedUrl = new URL(
      /^https?:\/\//iu.test(value.trim()) ? value.trim() : `https://${value.trim()}`
    );
    const parts = normalizedUrl.hostname.replace(/^www\./iu, "").split(".");
    const base = parts.length > 1 ? parts.at(-2) : parts[0];

    return normalizeFeedGroupName(base
      .split(/[-_]+/u)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(" "));
  } catch {
    return "";
  }
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const payload = await response.json();
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore malformed error bodies.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const loadConfig = async () => {
  if (state.convexUrl) {
    return state.convexUrl;
  }

  const payload = await requestJson("/api/config");
  if (!payload.convexUrl) {
    throw new Error("Reader is missing CONVEX_URL");
  }

  state.convexUrl = payload.convexUrl;
  state.newsletterInboxEmail = payload.newsletterInboxEmail || "";
  return state.convexUrl;
};

const renderNewsletterStatus = () => {
  if (!elements.newsletterStatusCopy) {
    return;
  }

  const inboxEmail = state.newsletterInboxEmail || "news@mj-kang.com";
  const status = state.newsletterStatus;
  let message = `Send or subscribe newsletters to ${inboxEmail} and Reader will pull them into the Newsletters feed.`;

  if (status?.configured === false) {
    message = `Reader is configured to use ${inboxEmail}, but AGENTMAIL_API_KEY is missing so newsletter sync is disabled.`;
  } else if (state.isSyncingNewsletters || status?.status === "running") {
    message = `Syncing unread messages from ${inboxEmail} now.`;
  } else if (status?.status === "error" && status?.lastError) {
    message = `Newsletter sync for ${inboxEmail} failed: ${status.lastError}`;
  } else if (status?.lastSyncedAt) {
    const syncedAt = new Date(status.lastSyncedAt);
    const syncedLabel = Number.isNaN(syncedAt.valueOf())
      ? status.lastSyncedAt
      : syncedAt.toLocaleString();
    message = `Reader checks ${inboxEmail} once an hour. Last sync: ${syncedLabel}.`;

    if (status.lastImportedCount > 0) {
      message += ` Imported ${status.lastImportedCount} newsletter${status.lastImportedCount === 1 ? "" : "s"} last run.`;
    }
  }

  elements.newsletterStatusCopy.textContent = message;
  elements.newsletterCopyButton.disabled = !inboxEmail;
  elements.newsletterSyncButton.disabled = state.isSyncingNewsletters || status?.configured === false;
};

const loadNewsletterStatus = async () => {
  const status = await convexRequest("query", "newsletters:getStatus", {});
  state.newsletterStatus = status;
  if (status?.inboxEmail) {
    state.newsletterInboxEmail = status.inboxEmail;
  }
  renderNewsletterStatus();
  return status;
};

const syncNewsletters = async () => {
  state.isSyncingNewsletters = true;
  renderNewsletterStatus();

  try {
    const result = await convexRequest("action", "newsletters:syncNow", {});
    await loadNewsletterStatus();
    await refreshCurrentView();
    showToast(
      `Newsletter sync complete. Processed ${result.processed || 0} message${result.processed === 1 ? "" : "s"}.`
    );
  } finally {
    state.isSyncingNewsletters = false;
    renderNewsletterStatus();
  }
};

const convexRequest = async (kind, path, args = {}) => {
  const convexUrl = await loadConfig();
  const response = await fetch(`${convexUrl}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      args,
      format: "json",
      path
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.errorMessage || `${response.status} ${response.statusText}`);
  }

  return payload.value;
};

const normalizeComparableUrl = (value) => {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value), window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).trim();
  }
};

const normalizeComparableText = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[“”]/gu, "\"")
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

const collectImageUrls = (node) =>
  Array.from(node?.querySelectorAll?.("img") || [])
    .map((image) => normalizeComparableUrl(image.getAttribute("src")))
    .filter(Boolean);

const isIgnorableLeadNode = (node) => {
  if (!node) {
    return true;
  }

  if (node.tagName === "HR") {
    return true;
  }

  const hasMedia = Boolean(node.querySelector("img, picture, video, iframe, canvas, svg"));
  return !hasMedia && normalizeComparableText(node.textContent) === "";
};

const isImageOnlyContainer = (node) => {
  if (!node) {
    return false;
  }

  if (node.tagName === "FIGURE") {
    return Boolean(node.querySelector("img, picture, video"));
  }

  if (node.tagName === "IMG" || node.tagName === "PICTURE" || node.tagName === "VIDEO") {
    return true;
  }

  if (!["P", "DIV"].includes(node.tagName)) {
    return false;
  }

  const hasSingleMediaChild = node.children.length === 1 &&
    ["IMG", "PICTURE", "VIDEO"].includes(node.firstElementChild?.tagName || "");

  return hasSingleMediaChild && normalizeComparableText(node.textContent) === "";
};

const isSubstantialTextBlock = (node) => {
  if (!node) {
    return false;
  }

  const text = normalizeComparableText(node.textContent);
  if (text.length === 0) {
    return false;
  }

  if (/^H[1-6]$/u.test(node.tagName)) {
    return true;
  }

  return text.length >= 48;
};

const stripLeadingDuplicateTitle = (root, title) => {
  const comparableTitle = normalizeComparableText(title);

  while (root?.firstElementChild) {
    const firstNode = root.firstElementChild;
    const isHeading = /^H[1-6]$/u.test(firstNode.tagName);

    if (!isHeading || normalizeComparableText(firstNode.textContent) !== comparableTitle) {
      break;
    }

    firstNode.remove();
  }
};

const trimLeadingIgnorableNodes = (root) => {
  while (root?.firstElementChild && isIgnorableLeadNode(root.firstElementChild)) {
    root.firstElementChild.remove();
  }
};

const isLikelyMetadataBlock = (node, comparableThumbnailUrl) => {
  if (!node) {
    return false;
  }

  const text = normalizeComparableText(node.textContent);
  const imageUrls = collectImageUrls(node);
  const linkCount = node.querySelectorAll("a").length;
  const hasThumbnailImage = Boolean(
    comparableThumbnailUrl && imageUrls.includes(comparableThumbnailUrl)
  );
  const hasBylineMarkers = /\bby\b/u.test(text) || /\bin\b/u.test(text);
  const isCompact = text.length <= 140;

  if (node.tagName === "TABLE") {
    return isCompact && (hasThumbnailImage || hasBylineMarkers || imageUrls.length > 0);
  }

  return isCompact && imageUrls.length <= 2 && linkCount <= 4 && hasThumbnailImage && hasBylineMarkers;
};

const stripLeadingMetadataBlocks = (root, comparableThumbnailUrl) => {
  const removedImageUrls = new Set();
  let removedCount = 0;

  trimLeadingIgnorableNodes(root);
  while (root?.firstElementChild && removedCount < 2) {
    const firstNode = root.firstElementChild;
    if (!isLikelyMetadataBlock(firstNode, comparableThumbnailUrl)) {
      break;
    }

    for (const imageUrl of collectImageUrls(firstNode)) {
      removedImageUrls.add(imageUrl);
    }

    firstNode.remove();
    removedCount += 1;
    trimLeadingIgnorableNodes(root);
  }

  return removedImageUrls;
};

const consumeLeadMediaNode = (root) => {
  trimLeadingIgnorableNodes(root);
  const leadNodes = Array.from(root?.children || []).filter((node) => !isIgnorableLeadNode(node)).slice(0, 3);

  for (const node of leadNodes) {
    if (isImageOnlyContainer(node)) {
      const heroHtml = node.outerHTML;
      node.remove();
      return heroHtml;
    }

    if (isSubstantialTextBlock(node)) {
      return "";
    }
  }

  return "";
};

const buildArticleHero = (bodyHtml, thumbnailUrl, title, url = "") => {
  if (!bodyHtml && !thumbnailUrl) {
    return { bodyHtml: bodyHtml || "", heroHtml: "" };
  }

  const youtubeHeroHtml = buildYouTubeHero(url, title);
  if (youtubeHeroHtml) {
    return {
      bodyHtml: bodyHtml || "",
      heroHtml: youtubeHeroHtml
    };
  }

  const parser = new DOMParser();
  const documentRoot = parser.parseFromString(`<div>${bodyHtml || ""}</div>`, "text/html");
  const root = documentRoot.body.firstElementChild;
  const comparableThumbnailUrl = normalizeComparableUrl(thumbnailUrl);
  let heroHtml = "";

  if (root) {
    stripLeadingDuplicateTitle(root, title);
    trimLeadingIgnorableNodes(root);
  }

  const metadataImageUrls = root ? stripLeadingMetadataBlocks(root, comparableThumbnailUrl) : new Set();
  const thumbnailWasMetadata = Boolean(
    comparableThumbnailUrl && metadataImageUrls.has(comparableThumbnailUrl)
  );

  if (root && comparableThumbnailUrl) {
    const matchingImage = Array.from(root.querySelectorAll("img")).find((image) =>
      normalizeComparableUrl(image.getAttribute("src")) === comparableThumbnailUrl
    );

    if (matchingImage) {
      const paragraphWrapper =
        matchingImage.parentElement?.tagName === "P" &&
        matchingImage.parentElement.children.length === 1
          ? matchingImage.parentElement
          : null;
      const heroNode = matchingImage.closest("figure") || paragraphWrapper || matchingImage;
      heroHtml = heroNode.outerHTML;
      heroNode.remove();
    }
  }

  const leadMediaHtml = !heroHtml && root ? consumeLeadMediaNode(root) : "";

  if (!heroHtml && thumbnailUrl && !thumbnailWasMetadata) {
    heroHtml = `
      <img
        src="${escapeHtml(thumbnailUrl)}"
        alt="${escapeHtml(title)}"
        loading="eager"
        referrerpolicy="no-referrer"
      >
    `;
  }

  if (!heroHtml && leadMediaHtml) {
    heroHtml = leadMediaHtml;
  }

  if (!heroHtml && thumbnailUrl) {
    heroHtml = `
      <img
        src="${escapeHtml(thumbnailUrl)}"
        alt="${escapeHtml(title)}"
        loading="eager"
        referrerpolicy="no-referrer"
      >
    `;
  }

  return {
    bodyHtml: root ? root.innerHTML : (bodyHtml || ""),
    heroHtml
  };
};

const parseTimestampToSeconds = (value) => {
  const normalized = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/u.test(normalized)) {
    return null;
  }

  const parts = normalized.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

const enhanceYouTubeTranscriptTimestamps = (root) => {
  if (!root) {
    return;
  }

  for (const paragraph of root.querySelectorAll("p")) {
    const firstElement = paragraph.firstElementChild;
    if (!firstElement || firstElement.tagName !== "STRONG") {
      continue;
    }

    const timestamp = firstElement.textContent?.trim() || "";
    const seconds = parseTimestampToSeconds(timestamp);
    if (seconds == null) {
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "transcript-timestamp";
    button.dataset.seekSeconds = String(seconds);
    button.textContent = timestamp;
    button.setAttribute("aria-label", `Play video from ${timestamp}`);
    firstElement.replaceWith(button);

    const textWrapper = document.createElement("span");
    textWrapper.className = "transcript-line-text";
    while (button.nextSibling) {
      textWrapper.append(button.nextSibling);
    }

    paragraph.classList.add("transcript-line");
    paragraph.append(textWrapper);
  }
};

const seekYouTubeHeroPlayer = (seconds) => {
  const iframe = elements.articleView.querySelector('iframe[data-youtube-player="true"]');
  const videoId = iframe?.dataset.youtubeVideoId;
  if (!iframe || !videoId || !Number.isFinite(seconds)) {
    return;
  }

  const startSeconds = Math.max(0, Math.floor(seconds));
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&start=${startSeconds}`;
  iframe.scrollIntoView({ behavior: "smooth", block: "center" });
};

const buildRequestArgs = ({
  cursor = null,
  includeCounts = true,
  includeSelectedArticleId = false
} = {}) => {
  const args = {
    limit: PAGE_LIMIT,
    scope: state.scope
  };

  if (state.feedGroup) {
    args.feedGroup = state.feedGroup;
  }

  if (!includeCounts) {
    args.includeCounts = false;
  }

  if (includeSelectedArticleId && state.selectedArticleId) {
    args.selectedArticleId = state.selectedArticleId;
  }

  if (cursor) {
    args.cursor = cursor;
  }

  return args;
};

const clearSelection = () => {
  articleRequestToken += 1;
  state.explicitArticleSelection = false;
  state.isLoadingArticle = false;
  state.selectedBookId = "";
  state.selectedBookSectionId = "";
  state.selectedArticle = null;
  state.selectedArticleId = "";
};

const currentRoutePath = () => {
  const selectedBook = getBookById(state.selectedBookId);
  const summaryArticle = state.articles.find((article) => article.id === state.selectedArticleId);

  return buildReaderPath({
    articleTitle: isBooksMode()
      ? (selectedBook?.title || "")
      : (summaryArticle?.title || state.selectedArticle?.title || ""),
    browseFeedGroups: state.browseFeedGroups,
    digestDate: state.digestDate,
    explicitArticleSelection: state.explicitArticleSelection,
    feedGroup: state.feedGroup,
    scope: state.scope,
    todayLocalDate: state.digest?.todayLocalDate || ""
  });
};

const syncRoute = ({ replace = false } = {}) => {
  if (isApplyingRoute) {
    return;
  }

  const nextPath = currentRoutePath();
  if (window.location.pathname === nextPath) {
    return;
  }

  window.history[replace ? "replaceState" : "pushState"]({}, "", nextPath);
};

const findFeedGroupBySlug = (feedGroupSlug) => {
  const groups = Object.keys(state.counts.feedGroups || {});
  return groups.find((group) => slugifySegment(group) === feedGroupSlug) || "";
};

const findArticleBySlug = (articleSlug) =>
  state.articles.find((article) => slugifySegment(article.title) === articleSlug) || null;

const ensureArticleInCurrentList = async (articleSlug) => {
  let article = findArticleBySlug(articleSlug);
  while (!article && state.hasMore) {
    const loadedMore = await loadMoreArticles();
    if (!loadedMore) {
      break;
    }
    article = findArticleBySlug(articleSlug);
  }
  return article;
};

const flattenDigestArticles = (digest) =>
  (digest?.sections || []).flatMap((section) =>
    (section.articles || []).map((article) => ({
      ...article,
      feedGroup: article.feedGroup || section.feedGroup || "",
      feedIconUrl: article.feedIconUrl || section.feedIconUrl || "",
      feedTitle: article.feedTitle || section.feedTitle
    }))
  );

const mergeArticleUpdateIntoState = (updated) => {
  if (!updated?.id) {
    return;
  }

  if (state.selectedArticle?.id === updated.id) {
    state.selectedArticle = {
      ...state.selectedArticle,
      ...updated
    };
  }

  const summary = state.articles.find((article) => article.id === updated.id);
  if (summary) {
    Object.assign(summary, updated);
  }
};

const loadCountsOnly = async () => {
  const payload = await convexRequest("query", "reader:getCounts", {});
  state.counts = payload.counts || { ...emptyCounts };
  return state.counts;
};

const renderRail = () => {
  elements.navToday.classList.toggle("is-active", state.scope === "today" && !state.feedGroup && !state.browseFeedGroups);
  elements.navAll.classList.toggle("is-active", state.scope === "all" && !state.feedGroup && !state.browseFeedGroups);
  elements.navSaved.classList.toggle("is-active", state.scope === "saved" && !state.feedGroup && !state.browseFeedGroups);
  elements.navFeeds.classList.toggle("is-active", state.browseFeedGroups || Boolean(state.feedGroup));
  elements.navManualArticles.classList.toggle("is-active", state.scope === "manual" && !state.feedGroup && !state.browseFeedGroups);
  elements.navYoutube.classList.toggle("is-active", state.scope === "youtube" && !state.feedGroup && !state.browseFeedGroups);
  elements.navBooks.classList.toggle("is-active", state.scope === "books" && !state.feedGroup && !state.browseFeedGroups);

  const feedGroups = Object.entries(state.counts.feedGroups || {}).sort((left, right) =>
    left[0].localeCompare(right[0])
  );

  if (feedGroups.length === 0) {
    elements.feedGroupList.innerHTML = `<div class="empty-state" style="padding:12px 16px">No feeds yet. Add one with the + button below.</div>`;
    return;
  }

  elements.feedGroupList.innerHTML = feedGroups
    .map(([feedGroup, count]) => `
      <button class="nav-item ${state.feedGroup === feedGroup ? "active" : ""}" data-feed-group="${escapeHtml(feedGroup)}">
        ${feedGroupIconHtml}
        ${escapeHtml(feedGroup)}
        <span class="nav-item-count">${count}</span>
      </button>
    `)
    .join("");
};

const renderTodaySidebar = () => {
  const selectedDate = state.digestDate || state.digest?.localDate || "";
  const todayDate = state.digest?.todayLocalDate || selectedDate;
  const monthKey = state.calendarMonth || startOfMonthKey(selectedDate || todayDate);
  const monthLabel = formatMonthLabel(monthKey);
  const canGoForward = compareLocalDates(shiftMonth(monthKey, 1), startOfMonthKey(todayDate)) <= 0;

  return `
    <div class="today-sidebar">
      <div class="today-calendar">
        <div class="today-calendar-header">
          <button class="icon-btn today-calendar-nav" data-calendar-month-offset="-1" type="button" aria-label="Previous month">${previousIconHtml.replace('width=\"20\"', 'width=\"18\"').replace('height=\"20\"', 'height=\"18\"')}</button>
          <div class="today-calendar-title">${escapeHtml(monthLabel || "Daily Digest")}</div>
          <button class="icon-btn today-calendar-nav" data-calendar-month-offset="1" type="button" aria-label="Next month" ${canGoForward ? "" : "disabled"}>${nextIconHtml.replace('width=\"20\"', 'width=\"18\"').replace('height=\"20\"', 'height=\"18\"')}</button>
        </div>
        <div class="today-calendar-grid">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => `
            <div class="today-calendar-weekday">${label}</div>
          `).join("")}
          ${buildCalendarDays(monthKey).map((day) => {
            if (day.outside) {
              return '<div class="today-calendar-day is-outside" aria-hidden="true"></div>';
            }

            const isSelected = day.key === selectedDate;
            const isToday = day.key === todayDate;
            const isFuture = compareLocalDates(day.key, todayDate) > 0;

            return `
              <button
                class="today-calendar-day ${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""}"
                data-calendar-date="${day.key}"
                type="button"
                ${isFuture ? "disabled" : ""}
              >
                ${day.label}
              </button>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
};

const renderBookCovers = (books = state.books) => `
  <div class="books-grid">
    ${books.map((book) => `
      <button
        class="book-card ${state.selectedBookId === book.id ? "is-active" : ""}"
        data-book-id="${book.id}"
        type="button"
        aria-label="${escapeHtml(book.title)} by ${escapeHtml(book.author)}"
      >
        ${renderBookCoverMarkup(book)}
        <div class="book-card-meta">
          <div class="book-card-title">${escapeHtml(book.title)}</div>
          <div class="book-card-author">${escapeHtml(book.author)}</div>
        </div>
      </button>
    `).join("")}
  </div>
`;

const renderBooksList = () => {
  elements.listTitle.textContent = "Books";
  elements.listBackButton.hidden = true;
  elements.addManualArticleButton.hidden = false;
  elements.addManualArticleButton.title = "Add book";
  elements.addManualArticleButton.setAttribute("aria-label", "Add book");
  elements.feedGroupList.hidden = true;
  elements.articleList.hidden = false;
  elements.listActions.hidden = false;
  elements.listMenuButton.hidden = true;
  elements.addFeedMenuButton.hidden = true;
  elements.renameFeedGroupButton.hidden = true;
  elements.removeFeedGroupButton.hidden = true;

  elements.articleList.innerHTML = `
    <div class="books-sidebar">
      ${state.books.length === 0 ? `
        <div class="empty-state">
          No books yet. Add one to start a reading notebook.
        </div>
      ` : renderBookCovers(state.books)}
    </div>
  `;
};

const renderBookView = () => {
  if (state.isLoadingBooks) {
    elements.bookEditButton.hidden = true;
    elements.bookEditButton.disabled = true;
    elements.bookEditSeparator.hidden = true;
    elements.articleView.innerHTML = `
      <div class="books-empty-state">
        <div class="books-empty-copy">
          <div class="books-empty-kicker">Books</div>
          <h1 class="books-empty-title">Loading your shelf…</h1>
          <p class="books-empty-text">Fetching synced books, notes, and highlights.</p>
        </div>
      </div>
    `;
    return;
  }

  const book = getBookById(state.selectedBookId);
  elements.bookEditButton.hidden = !book;
  elements.bookEditButton.disabled = !book;
  elements.bookEditSeparator.hidden = !book;
  elements.previousArticleButton.disabled = true;
  elements.nextArticleButton.disabled = true;
  elements.saveArticleButton.disabled = true;
  elements.deleteArticleButton.disabled = !book;
  elements.deleteArticleButton.title = "Delete book";
  elements.deleteArticleButton.setAttribute("aria-label", "Delete book");
  elements.shareArticleButton.disabled = true;
  elements.toggleHighlightsButton.disabled = true;
  elements.openArticleButton.disabled = true;
  elements.saveArticleButton.classList.remove("is-active");
  elements.toggleHighlightsButton.classList.remove("is-active");

  if (!book) {
    elements.articleView.innerHTML = `
      <div class="books-empty-state">
        <div class="books-empty-copy">
          <div class="books-empty-kicker">Shelf notes</div>
          <h1 class="books-empty-title">Pick a book cover to start a memo.</h1>
          <p class="books-empty-text">Use this synced reading workspace to sketch ideas, save quotes, or keep a running reaction log while you read.</p>
        </div>
      </div>
    `;
    return;
  }

  const sections = Array.isArray(book.sections) ? book.sections : [];
  const selectedSection = getSelectedBookSection(book);
  const completedCount = sections.filter((section) => section.status === "done").length;
  elements.articleView.innerHTML = `
    <div class="book-page">
      <div class="book-page-hero">
        ${renderBookCoverMarkup(book, "book-page-cover")}
        <div class="book-page-header">
          <div class="book-page-kicker">Books</div>
          <h1 class="book-page-title">${escapeHtml(book.title)}</h1>
          <div class="book-page-author">${escapeHtml(book.author)}</div>
          <div class="book-page-progress">${completedCount}/${sections.length || 1} sections complete</div>
          <p class="book-page-blurb">${escapeHtml(book.description)}</p>
        </div>
      </div>
      <div class="book-sections-layout">
        <aside class="book-sections-panel">
          <div class="book-sections-header">
            <h2 class="book-panel-title">Table of Contents</h2>
            <button class="btn-secondary" data-book-section-add="${book.id}" type="button">Add</button>
          </div>
          <div class="book-sections-list">
            ${sections.map((section) => `
              <button class="book-section-item ${selectedSection?.id === section.id ? "is-active" : ""}" data-book-section-id="${section.id}" type="button">
                ${state.editingBookSectionId === section.id ? `
                  <input
                    class="book-section-title-edit-input"
                    data-book-section-title-edit-input="${book.id}:${section.id}"
                    type="text"
                    value="${escapeHtml(section.title)}"
                    aria-label="Edit section title"
                  >
                ` : `
                  <div class="book-section-title">${escapeHtml(section.title)}</div>
                `}
                <div class="book-section-status ${section.status === "done" ? "is-done" : ""}">${section.status === "done" ? "Done" : "Active"}</div>
              </button>
            `).join("")}
          </div>
        </aside>
        <div class="book-section-editor">
          ${selectedSection ? `
            <section class="book-notes-panel">
              <div class="book-notes-header">
                <h2 class="book-notes-chapter-title">${escapeHtml(selectedSection.title)}</h2>
                <button class="btn-secondary" data-book-section-next="${book.id}:${selectedSection.id}" onclick="window.__readerAdvanceBookSection && window.__readerAdvanceBookSection('${escapeHtml(book.id)}', '${escapeHtml(selectedSection.id)}')" type="button">Next</button>
              </div>
              <textarea
                class="book-notes-textarea"
                data-book-notes-input="${book.id}:${selectedSection.id}"
              >${escapeHtml(selectedSection.notes || "")}</textarea>
            </section>
          ` : `
            <div class="books-empty-state">
              <div class="books-empty-copy">
                <div class="books-empty-kicker">Sections</div>
                <h1 class="books-empty-title">Add your first section.</h1>
                <p class="books-empty-text">Break notes down by chapter or idea, then track progress section by section.</p>
              </div>
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  const titleEditInput = elements.articleView.querySelector("[data-book-section-title-edit-input]");
  if (titleEditInput) {
    titleEditInput.focus();
    titleEditInput.select();
  }

};

const renderArticleList = () => {
  if (isBooksMode()) {
    renderBooksList();
    return;
  }

  elements.addManualArticleButton.title = "Add article";
  elements.addManualArticleButton.setAttribute("aria-label", "Add article");

  elements.listTitle.textContent = state.browseFeedGroups ? "Feeds" : listTitle();
  elements.listBackButton.hidden = !(
    state.canReturnToFeedGroups &&
    state.feedGroup &&
    !state.browseFeedGroups
  );
  elements.addManualArticleButton.hidden = !isLibraryLikeScope() || state.browseFeedGroups;

  if (state.browseFeedGroups) {
    elements.feedGroupList.hidden = false;
    elements.articleList.hidden = true;
    elements.listActions.hidden = false;
    elements.listMenuButton.hidden = false;
    elements.addFeedMenuButton.hidden = false;
    elements.renameFeedGroupButton.hidden = true;
    elements.removeFeedGroupButton.hidden = true;
    return;
  }

  elements.feedGroupList.hidden = true;
  elements.articleList.hidden = false;
  const showFeedSettings = state.browseFeedGroups || Boolean(state.feedGroup);
  elements.listActions.hidden = !(showFeedSettings || isLibraryLikeScope());
  elements.listMenuButton.hidden = !showFeedSettings;
  elements.addFeedMenuButton.hidden = !showFeedSettings;
  elements.renameFeedGroupButton.hidden = !state.feedGroup;
  elements.renameFeedGroupButton.disabled = !state.feedGroup;
  elements.renameFeedGroupButton.textContent = state.feedGroup
    ? `Edit ${state.feedGroup}`
    : "Edit feed";
  elements.removeFeedGroupButton.hidden = !state.feedGroup;
  elements.removeFeedGroupButton.disabled = !state.feedGroup;
  elements.removeFeedGroupButton.textContent = state.feedGroup
    ? `Remove ${state.feedGroup}`
    : "Remove feed";

  if (state.articles.length === 0) {
    elements.articleList.innerHTML = `
      ${isTodaySidebarMode() ? renderTodaySidebar() : ""}
      <div class="empty-state">
        ${state.scope === "youtube"
          ? "No YouTube videos saved yet. Paste a YouTube URL to add one here."
          : `No articles match this view yet. Add a feed, paste an article URL, send newsletters to ${escapeHtml(state.newsletterInboxEmail || "news@mj-kang.com")}, or wait for the next scheduled sync.`}
      </div>
    `;
    return;
  }

  const statusMarkup = state.isLoadingMore
    ? '<div class="list-status">Loading more articles…</div>'
    : (state.hasMore ? '<div class="list-status">Scroll for more</div>' : "");

  elements.articleList.innerHTML = `
    ${isTodaySidebarMode() ? renderTodaySidebar() : ""}
    ${state.articles
      .map((article) => `
        <button class="article-item ${article.id === state.selectedArticleId ? "active" : ""} ${article.isRead ? "" : "is-unread"}" data-article-id="${article.id}" type="button" aria-label="${escapeHtml(article.title)}">
          <div class="item-meta">
            <div class="item-source">
              ${article.isRead ? "" : '<span class="unread-dot"></span>'}
              ${escapeHtml(article.feedTitle)}
            </div>
            <span class="item-time">${escapeHtml(formatListTime(article.publishedAt))}</span>
          </div>
          <div class="item-title">${escapeHtml(article.title)}</div>
          <div class="item-preview">${escapeHtml(article.previewText || "No preview available.")}</div>
        </button>
      `)
      .join("")}
    ${statusMarkup}
  `;
};

const renderDigestView = () => {
  if (state.isLoadingDigest) {
    elements.articleView.innerHTML = `
      <div class="digest-state">
        Loading today’s digest…
      </div>
    `;
    return;
  }

  if (!state.digest) {
    elements.articleView.innerHTML = `
      <div class="digest-state">
        Today’s digest is not ready yet.
      </div>
    `;
    return;
  }

  if (state.digest.status === "failed") {
    elements.articleView.innerHTML = `
      <div class="digest-state">
        Today’s digest is unavailable right now.
        ${state.digest.error ? `<div style="margin-top:8px;">${escapeHtml(state.digest.error)}</div>` : ""}
      </div>
    `;
    return;
  }

  if (state.digest.status !== "ready") {
    elements.articleView.innerHTML = `
      <div class="digest-state">
        Today’s digest is being prepared.
      </div>
    `;
    return;
  }

  const sections = state.digest.sections || [];
  elements.articleView.innerHTML = `
    <div class="digest-view">
      <header class="digest-header">
        <button class="digest-eyebrow digest-eyebrow-button" data-digest-reset-today="true" type="button">
          ${DIGEST_DATE_LABEL}
        </button>
        <div class="digest-title">Daily Digest</div>
        <div class="digest-meta">
          ${escapeHtml(state.digest.localDateLabel || "")}
        </div>
        <div class="digest-intro">${escapeHtml(state.digest.intro || "No new feed articles arrived for this morning’s digest.")}</div>
      </header>
      ${sections.length === 0 ? `
        <div class="digest-state">
          No feed-backed articles made it into today’s digest.
        </div>
      ` : sections.map((section) => `
        <section class="digest-section">
          <div class="digest-section-header">
            ${feedIconMarkup(section.feedIconUrl)}
            <div class="digest-section-title">${escapeHtml(section.feedTitle)}</div>
          </div>
          <div class="digest-section-summary">${escapeHtml(section.summary)}</div>
          <div class="digest-article-list">
            ${section.articles.map((article) => `
              <button class="digest-article-button" data-digest-article-id="${article.id}" type="button">
                <div class="digest-article-meta">${escapeHtml(formatListTime(article.publishedAt))}${article.author ? ` • ${escapeHtml(article.author)}` : ""}</div>
                <div class="digest-article-title">${escapeHtml(article.title)}</div>
                ${article.subtitle ? `<div class="digest-article-subtitle">${escapeHtml(article.subtitle)}</div>` : ""}
                ${article.previewText ? `<div class="digest-article-preview">${escapeHtml(article.previewText)}</div>` : ""}
              </button>
            `).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
};

const renderArticle = () => {
  if (isBooksMode()) {
    renderBookView();
    return;
  }

  elements.bookEditButton.hidden = true;
  elements.bookEditButton.disabled = true;
  elements.bookEditSeparator.hidden = true;
  elements.deleteArticleButton.title = "Delete article";
  elements.deleteArticleButton.setAttribute("aria-label", "Delete article");

  const article = state.selectedArticle;
  const selectedIndex = articleIndex();
  const hasSelection = Boolean(state.selectedArticleId);
  const hasExternalUrl = canOpenExternalArticle(article);

  elements.previousArticleButton.disabled = !hasSelection || selectedIndex <= 0;
  elements.nextArticleButton.disabled =
    !hasSelection ||
    (selectedIndex === -1 && !state.hasMore) ||
    (selectedIndex >= state.articles.length - 1 && !state.hasMore);
  elements.saveArticleButton.disabled = !article;
  elements.deleteArticleButton.disabled = !article;
  elements.shareArticleButton.disabled = !article || !hasExternalUrl;
  elements.toggleHighlightsButton.disabled = !article;
  elements.openArticleButton.disabled = !article || !hasExternalUrl;

  elements.saveArticleButton.classList.toggle("is-active", Boolean(article?.isSaved));
  elements.toggleHighlightsButton.classList.toggle("is-active", Boolean(state.isHighlightsPanelOpen));

  if (isTodayDigestMode() && !state.selectedArticleId) {
    renderDigestView();
    return;
  }

  if (state.isLoadingArticle && state.selectedArticleId) {
    elements.articleView.innerHTML = `
      <div class="article-loading-state">
        Loading article…
      </div>
    `;
    return;
  }

  if (!article) {
    elements.articleView.innerHTML = `
      <div class="empty-state">
        Select an article to start reading. New feeds sync through Convex once an hour, and library saves show up here right away.
      </div>
    `;
    return;
  }

  const articleHero = buildArticleHero(
    article.bodyHtml,
    article.thumbnailUrl,
    article.title,
    article.url || article.canonicalUrl || ""
  );

  elements.articleView.innerHTML = `
    <div class="article-layout">
      <div class="article-main">
        ${articleHero.heroHtml ? `<div class="article-hero">${sanitizeHtml(articleHero.heroHtml)}</div>` : ""}
        <header class="article-header">
          <div class="article-feed-name">
            ${feedIconMarkup(article.feedIconUrl)}
            ${escapeHtml(article.feedTitle)}
          </div>
          <h1 class="article-h1">${escapeHtml(article.title)}</h1>
          ${article.subtitle ? `<div class="article-subtitle">${escapeHtml(article.subtitle)}</div>` : ""}
          <div class="article-meta-row">
            <span>By <span class="article-author">${escapeHtml(article.author || "Unknown author")}</span></span>
            <span>•</span>
            <span>${escapeHtml(formatArticleDate(article.publishedAt))}</span>
            <span>•</span>
            <span>${escapeHtml(`${article.readTimeMinutes} min read`)}</span>
          </div>
        </header>
        <div class="article-body">${sanitizeHtml(articleHero.bodyHtml) || "<p>No article body available yet.</p>"}</div>
      </div>
    </div>
  `;

  const articleBody = elements.articleView.querySelector(".article-body");
  if (articleBody) {
    if (isYouTubeArticle(article)) {
      enhanceYouTubeTranscriptTimestamps(articleBody);
    }
    applyHighlightsToArticleBody(articleBody, article.highlights || []);
  }

  renderHighlightsRail();

  for (const link of elements.articleView.querySelectorAll(".article-body a[href]")) {
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("target", "_blank");
  }

  for (const img of elements.articleView.querySelectorAll(".article-body img")) {
    img.setAttribute("loading", "lazy");
  }
};

const render = () => {
  elements.articleView.classList.toggle("is-books-view", isBooksMode());
  renderRail();
  renderArticleList();
  renderArticle();
  syncListMenuState();
};

const loadArticle = async (articleId, options = {}) => {
  const { preserveScrollTop = null } = options;
  const requestToken = ++articleRequestToken;
  state.isLoadingArticle = true;
  state.selectedArticle = null;
  render();

  try {
    const article = await convexRequest("query", "reader:getArticle", { articleId });
    if (requestToken !== articleRequestToken || state.selectedArticleId !== articleId) {
      return;
    }

    state.selectedArticle = article;
  } finally {
    if (requestToken === articleRequestToken && state.selectedArticleId === articleId) {
      state.isLoadingArticle = false;
      render();

      if (preserveScrollTop != null) {
        window.requestAnimationFrame(() => {
          elements.paneContentScroll.scrollTop = preserveScrollTop;
        });
      }
    }
  }
};

const pollTodayDigest = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const payload = await convexRequest("query", "digest:getToday", {
      includeCounts: false
    });

    state.digest = payload.digest
      ? {
        ...payload.digest,
        isToday: payload.isToday,
        localDateLabel: payload.localDateLabel || payload.digest.localDate,
        todayLocalDate: payload.todayLocalDate
      }
      : null;
    state.articles = flattenDigestArticles(state.digest);
    state.digestDate = payload.localDate || "";
    state.calendarMonth = startOfMonthKey(state.digestDate || payload.todayLocalDate || "");
    state.isLoadingDigest = false;
    render();

    if (payload.status === "ready" || payload.status === "failed") {
      return;
    }
  }
};

const ensureTodayDigest = async () => {
  state.isLoadingDigest = true;
  render();

  await convexRequest("action", "digest:ensureToday", {});
  await pollTodayDigest();
};

const loadDigestForDate = async (localDate = "", options = {}) => {
  const { updateRoute = false } = options;
  articleRequestToken += 1;
  state.articles = [];
  state.hasMore = false;
  state.nextCursor = null;
  state.isLoadingArticle = false;
  state.isLoadingMore = false;
  state.isLoadingDigest = true;
  state.selectedArticle = null;
  state.selectedArticleId = "";
  state.digestDate = localDate;
  openPanel();
  render();

  const payload = localDate
    ? await convexRequest("query", "digest:getForDate", { localDate })
    : await convexRequest("query", "digest:getToday", {});

  if (payload.counts) {
    state.counts = payload.counts;
  }
  state.digest = payload.digest
    ? {
      ...payload.digest,
      isToday: payload.isToday,
      localDateLabel: payload.localDateLabel || payload.digest.localDate,
      todayLocalDate: payload.todayLocalDate
    }
    : null;
  state.articles = flattenDigestArticles(state.digest);
  state.digestDate = payload.localDate || localDate || "";
  state.calendarMonth = startOfMonthKey(state.digestDate || payload.todayLocalDate || "");
  state.isLoadingDigest = false;
  if (updateRoute) {
    syncRoute({ replace: false });
  }
  render();

  if (!localDate && payload.status === "missing") {
    await ensureTodayDigest();
  }
};

const bootstrap = async ({ includeCounts = true } = {}) => {
  const payload = await convexRequest(
    "query",
    "reader:bootstrap",
    buildRequestArgs({ includeCounts, includeSelectedArticleId: true })
  );
  articleRequestToken += 1;
  state.articles = payload.articles || [];
  if (payload.counts) {
    state.counts = payload.counts;
  }
  state.hasMore = Boolean(payload.hasMore);
  state.nextCursor = payload.nextCursor || null;
  state.selectedArticle = null;
  state.selectedArticleId = payload.selectedArticleId || "";
  state.isLoadingArticle = Boolean(state.selectedArticleId);
  state.isLoadingMore = false;
  render();
  elements.articleList.scrollTop = 0;

  if (state.selectedArticleId) {
    await loadArticle(state.selectedArticleId);
  }
};

const refreshCurrentView = async () => {
  if (isTodayDigestMode()) {
    await loadDigestForDate(state.digestDate);
    return;
  }

  await bootstrap();
};

const appendArticles = (articles) => {
  const existingIds = new Set(state.articles.map((article) => article.id));
  const nextArticles = articles.filter((article) => !existingIds.has(article.id));
  state.articles = [...state.articles, ...nextArticles];
};

const loadMoreArticles = async () => {
  if (!state.hasMore || state.isLoadingMore || !state.nextCursor) {
    return false;
  }

  state.isLoadingMore = true;
  renderArticleList();

  try {
    const payload = await convexRequest(
      "query",
      "reader:listArticles",
      buildRequestArgs({ cursor: state.nextCursor })
    );
    appendArticles(payload.articles || []);
    state.hasMore = Boolean(payload.hasMore);
    state.nextCursor = payload.nextCursor || null;
    return (payload.articles || []).length > 0;
  } finally {
    state.isLoadingMore = false;
    render();
  }
};

const selectArticle = async (articleId, options = {}) => {
  const {
    explicit = true,
    updateRoute = true
  } = options;

  state.explicitArticleSelection = explicit;
  state.selectedArticleId = articleId;
  const summary = state.articles.find((article) => article.id === articleId);

  if (summary && !summary.isRead) {
    summary.isRead = true;
    convexRequest("mutation", "reader:updateArticle", {
      articleId,
      isRead: true
    })
      .then((updated) => {
        mergeArticleUpdateIntoState(updated);
      })
      .catch((error) => {
        showToast(error.message, { error: true });
      });
  }

  if (updateRoute) {
    syncRoute({ replace: false });
  }

  await loadArticle(articleId);
};

const toggleSave = async () => {
  if (!state.selectedArticle) {
    return;
  }

  const updated = await convexRequest("mutation", "reader:updateArticle", {
    articleId: state.selectedArticle.id,
    isSaved: !state.selectedArticle.isSaved
  });

  mergeArticleUpdateIntoState(updated);

  if (state.scope === "saved" && !updated.isSaved) {
    clearSelection();
    await bootstrap();
  } else {
    state.counts.saved += updated.isSaved ? 1 : -1;
    if (isLibraryLikeScope() && !updated.isSaved) {
      render();
      return;
    }
    render();
  }
};

const deleteSelectedArticle = async () => {
  if (!state.selectedArticle) {
    return;
  }

  const articleTitle = state.selectedArticle.title;
  const confirmed = window.confirm(`Delete "${articleTitle}" from Reader?`);
  if (!confirmed) {
    return;
  }

  const result = await convexRequest("mutation", "reader:deleteArticle", {
    articleId: state.selectedArticle.id
  });

  clearSelection();
  if (isTodayDigestMode() && result?.affectsTodayDigest) {
    await loadDigestForDate(state.digestDate, { updateRoute: false });
  } else {
    await refreshCurrentView();
  }
  showToast(`Deleted "${articleTitle}".`);
};

const markAllRead = async () => {
  await convexRequest("action", "reader:markAllRead", {
    feedGroup: state.feedGroup,
    scope: state.scope
  });

  clearSelection();
  await refreshCurrentView();
  showToast("Marked the current list as read.");
};

const openDialog = () => {
  feedGroupEditedManually = false;
  elements.feedDialog.showModal();
  elements.feedUrlInput.focus();
};

const closeDialog = () => {
  elements.feedDialog.close();
  elements.feedForm.reset();
  feedGroupEditedManually = false;
};

const openSettingsDialog = () => {
  elements.settingsDialog.showModal();
};

const closeSettingsDialog = () => {
  elements.settingsDialog.close();
};

const openArticleDialog = () => {
  elements.articleDialog.showModal();
  elements.articleUrlInput.focus();
};

const closeArticleDialog = () => {
  elements.articleDialog.close();
  elements.articleForm.reset();
};

const renderBookCoverPreview = () => {
  const coverImage = state.bookDialogCoverDataUrl;
  if (!elements.bookCoverPreview || !elements.bookCoverPreviewFrame) {
    return;
  }

  if (coverImage) {
    elements.bookCoverPreview.hidden = false;
    elements.bookCoverPreviewFrame.innerHTML = `
      <img class="book-cover-image" src="${escapeHtml(coverImage)}" alt="Book cover preview">
    `;
    return;
  }

  elements.bookCoverPreview.hidden = true;
  elements.bookCoverPreviewFrame.innerHTML = "";
};

const estimateDataUrlBytes = (value) => {
  const encoded = String(value || "").split(",")[1] || "";
  return Math.ceil((encoded.length * 3) / 4);
};

const loadImageElement = (dataUrl) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("Could not load the selected cover image"));
  image.src = dataUrl;
});

const resizeBookCover = async (file) => {
  const originalDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected cover image"));
    reader.readAsDataURL(file);
  });

  if (file.size <= MAX_BOOK_COVER_BYTES) {
    return originalDataUrl;
  }

  const image = await loadImageElement(originalDataUrl);
  const maxWidth = 900;
  const maxHeight = 1400;
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not process the selected cover image");
  }

  context.drawImage(image, 0, 0, width, height);

  let quality = 0.86;
  let candidate = canvas.toDataURL("image/jpeg", quality);
  while (estimateDataUrlBytes(candidate) > MAX_BOOK_COVER_BYTES && quality > 0.46) {
    quality -= 0.08;
    candidate = canvas.toDataURL("image/jpeg", quality);
  }

  if (estimateDataUrlBytes(candidate) > MAX_BOOK_COVER_BYTES) {
    throw new Error("Cover image is too large even after compression. Try a smaller image.");
  }

  return candidate;
};

const openBookDialog = (bookId = "") => {
  const book = getBookById(bookId);
  state.bookDialogEditingId = book?.id || "";
  state.bookDialogCoverDataUrl = book?.coverImage || "";
  setBookSaveFeedback("Synced", "idle");

  elements.bookDialogTitle.textContent = book ? "Edit book" : "Add book";
  elements.bookDialogCopy.textContent = book
    ? "Update the title, author, description, or book cover for this synced shelf entry."
    : "Create a new synced book entry for notes, reactions, and quotes.";
  elements.bookSubmitButton.textContent = book ? "Save book" : "Add book";
  elements.bookTitleInput.value = book?.title || "";
  elements.bookAuthorInput.value = book?.author || "";
  elements.bookDescriptionInput.value = book?.description || "";
  elements.bookOutlineInput.value = Array.isArray(book?.sections)
    ? book.sections.map((section) => `## ${section.title}`).join("\n")
    : "";
  elements.bookStatusInput.value = book?.status || "Reading";
  elements.bookCoverFileInput.value = "";
  elements.bookRemoveCoverButton.hidden = !state.bookDialogCoverDataUrl;
  renderBookCoverPreview();
  elements.bookDialog.showModal();
  elements.bookTitleInput.focus();
};

const closeBookDialog = () => {
  state.bookDialogEditingId = "";
  state.bookDialogCoverDataUrl = "";
  elements.bookDialog.close();
  elements.bookForm.reset();
  renderBookCoverPreview();
};

const saveBook = async () => {
  const title = elements.bookTitleInput.value.trim();
  const author = elements.bookAuthorInput.value.trim();
  const description = elements.bookDescriptionInput.value.trim();
  const outline = elements.bookOutlineInput.value;
  const status = elements.bookStatusInput.value.trim() || "Reading";

  if (!title) {
    throw new Error("Book title is required");
  }

  const existing = getBookById(state.bookDialogEditingId);
  const theme = getBookTheme(title);
  const nextBook = {
    accent: existing?.accent || theme.accent,
    author,
    coverImage: state.bookDialogCoverDataUrl || "",
    coverTone: existing?.coverTone || theme.coverTone,
    description,
    id: existing?.id || createBookId(title),
    status,
    title
  };

  const savedBook = await convexRequest("mutation", "books:upsert", {
    accent: nextBook.accent,
    author: nextBook.author,
    bookId: existing?.id || undefined,
    coverImage: nextBook.coverImage || undefined,
    coverTone: nextBook.coverTone,
    description: nextBook.description,
    status: nextBook.status,
    title: nextBook.title
  });

  const normalizedSavedBook = mapBookRecord(savedBook);
  replaceBookInState(normalizedSavedBook);
  const mergedSections = mergeSectionsFromOutline(normalizedSavedBook.sections || [], outline);
  let finalBook = normalizedSavedBook;
  if (mergedSections !== normalizedSavedBook.sections) {
    const updatedBook = await convexRequest("mutation", "books:updateSections", {
      bookId: savedBook.id,
      sections: mergedSections
    });
    finalBook = mapBookRecord(updatedBook);
    replaceBookInState(finalBook);
  }
  state.scope = "books";
  state.selectedBookId = finalBook.id;
  state.selectedBookSectionId = finalBook.sections?.[0]?.id || "";
  state.explicitArticleSelection = true;
  closeBookDialog();
  setBookSaveFeedback(existing ? "Book synced" : "Book created", "success");
  openPanel();
  syncRoute({ replace: false });
  render();
  showToast(existing ? `Updated ${finalBook.title}.` : `Added ${finalBook.title}.`);
};

const openRenameFeedGroupDialog = (feedGroup) => {
  if (!feedGroup) {
    return;
  }

  elements.renameFeedGroupInput.value = feedGroup;
  elements.renameFeedGroupDialog.showModal();
  elements.renameFeedGroupInput.focus();
  elements.renameFeedGroupInput.select();
};

const closeRenameFeedGroupDialog = () => {
  elements.renameFeedGroupDialog.close();
  elements.renameFeedGroupForm.reset();
};

const runManualSync = async () => {
  await convexRequest("action", "sync:runAllNow", {});
  await convexRequest("action", "newsletters:syncNow", {});
  await loadNewsletterStatus().catch(() => {});
  await refreshCurrentView();
};

const openRemoveFeedGroupDialog = (feedGroup) => {
  state.pendingFeedGroupRemoval = feedGroup;
  elements.removeFeedGroupCopy.textContent = `This will permanently delete all RSS feeds and articles in ${feedGroup}.`;
  elements.removeFeedGroupDialog.showModal();
  elements.removeFeedGroupConfirmButton.focus();
};

const closeRemoveFeedGroupDialog = () => {
  state.pendingFeedGroupRemoval = "";
  elements.removeFeedGroupDialog.close();
};

const setFormSubmitting = (form, submitting) => {
  const submitBtn = form.querySelector("[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = submitting;
    submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
    submitBtn.textContent = submitting ? "Adding…" : submitBtn.dataset.originalText;
  }
};

const submitFeed = async () => {
  await convexRequest("action", "feeds:add", {
    feedGroup: elements.feedGroupInput.value,
    inputUrl: elements.feedUrlInput.value
  });

  closeDialog();
  showToast("Feed added. Initial sync queued.");
  clearSelection();
  await refreshCurrentView();
};

const renameFeedGroup = async () => {
  const previousFeedGroup = state.feedGroup;
  const nextFeedGroup = normalizeFeedGroupName(elements.renameFeedGroupInput.value);

  if (!previousFeedGroup) {
    throw new Error("Feed not found");
  }

  if (!nextFeedGroup) {
    throw new Error("Feed title is required");
  }

  if (nextFeedGroup === previousFeedGroup) {
    closeRenameFeedGroupDialog();
    return;
  }

  const result = await convexRequest("action", "feeds:renameFeedGroup", {
    feedGroup: previousFeedGroup,
    nextFeedGroup
  });

  closeRenameFeedGroupDialog();
  closeListMenu();

  if (state.feedGroup === previousFeedGroup) {
    state.feedGroup = nextFeedGroup;
  }

  clearSelection();
  syncRoute({ replace: false });
  await refreshCurrentView();
  showToast(`Renamed ${result.previousFeedGroup} to ${result.nextFeedGroup}.`);
};

const submitArticle = async () => {
  const result = await convexRequest("action", "articles:addFromUrl", {
    url: elements.articleUrlInput.value
  });
  const article = await convexRequest("query", "reader:getArticle", { articleId: result.articleId });
  const nextScope = isYouTubeArticle(article) ? "youtube" : "manual";

  closeArticleDialog();
  state.scope = nextScope;
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  await bootstrap();

  const existing = state.articles.find((article) => article.id === result.articleId);
  if (!existing) {
    state.articles = [
      {
        author: article.author,
        feedGroup: article.feedGroup,
        feedIconUrl: article.feedIconUrl,
        feedId: article.feedId,
        feedTitle: article.feedTitle,
        id: article.id,
        isRead: article.isRead,
        isSaved: article.isSaved,
        previewText: article.previewText,
        publishedAt: article.publishedAt,
        readTimeMinutes: article.readTimeMinutes,
        sourceType: article.sourceType,
        thumbnailUrl: article.thumbnailUrl,
        title: article.title,
        url: article.url
      },
      ...state.articles.filter((entry) => entry.id !== article.id)
    ];
  }

  await selectArticle(result.articleId);
  showToast(result.deduped ? "Article already existed. Opened the saved copy." : "Article added.");
};

const removeFeedGroup = async () => {
  const feedGroup = state.pendingFeedGroupRemoval;
  if (!feedGroup) {
    return;
  }

  const removedCurrentFeedGroup = state.feedGroup === feedGroup;
  const removedSelectedArticle =
    state.selectedArticle?.feedGroup === feedGroup ||
    state.articles.find((article) => article.id === state.selectedArticleId)?.feedGroup === feedGroup;

  const result = await convexRequest("action", "feeds:removeFeedGroup", { feedGroup });

  closeRemoveFeedGroupDialog();

  if (removedCurrentFeedGroup) {
    state.scope = "all";
    state.canReturnToFeedGroups = false;
    state.feedGroup = "";
    state.browseFeedGroups = false;
    closePanel();
  }

  if (removedCurrentFeedGroup || removedSelectedArticle) {
    clearSelection();
  }

  await refreshCurrentView();
  showToast(`Removed ${result.removedFeeds} feed${result.removedFeeds === 1 ? "" : "s"} from ${feedGroup}.`);
};

const deleteSelectedBook = async () => {
  const book = getBookById(state.selectedBookId);
  if (!book) {
    return;
  }

  const confirmed = window.confirm(`Delete "${book.title}" from Books?`);
  if (!confirmed) {
    return;
  }

  clearPendingBookSync(`notes:${book.id}`);
  await convexRequest("mutation", "books:remove", { bookId: book.id });
  saveBooksToState(state.books.filter((entry) => entry.id !== book.id));
  state.selectedBookId = state.books[0]?.id || "";
  setBookSaveFeedback("Synced", "idle");
  syncRoute({ replace: false });
  render();
  showToast(`Deleted ${book.title}.`);
};

const shareArticle = async () => {
  if (!state.selectedArticle) {
    return;
  }

  if (!canOpenExternalArticle(state.selectedArticle)) {
    throw new Error("This article does not have a browser link.");
  }

  if (navigator.share) {
    await navigator.share({
      title: state.selectedArticle.title,
      url: state.selectedArticle.url
    });
    return;
  }

  await navigator.clipboard.writeText(state.selectedArticle.url);
  showToast("Article URL copied to clipboard.");
};

const moveSelection = async (direction) => {
  let currentIndex = articleIndex();
  if (currentIndex === -1) {
    return;
  }

  let nextArticle = state.articles[currentIndex + direction];
  if (!nextArticle && direction > 0 && state.hasMore) {
    const loadedMore = await loadMoreArticles();
    if (loadedMore) {
      currentIndex = articleIndex();
      nextArticle = state.articles[currentIndex + direction];
    }
  }

  if (nextArticle) {
    await selectArticle(nextArticle.id);
  }
};

const maybeLoadMoreFromScroll = async () => {
  const remaining = elements.articleList.scrollHeight -
    elements.articleList.scrollTop -
    elements.articleList.clientHeight;

  if (remaining <= LOAD_MORE_THRESHOLD) {
    await loadMoreArticles();
  }
};

elements.navToday.addEventListener("click", async () => {
  state.canReturnToFeedGroups = false;
  state.scope = "today";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  syncRoute({ replace: false });
  await loadDigestForDate("");
});

elements.navAll.addEventListener("click", async () => {
  if (state.scope === "all" && !state.feedGroup && !state.browseFeedGroups && state.overlayOpen) {
    closePanel();
    return;
  }
  state.canReturnToFeedGroups = false;
  state.scope = "all";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  openPanel();
  syncRoute({ replace: false });
  await bootstrap();
});

elements.navSaved.addEventListener("click", async () => {
  if (state.scope === "saved" && !state.feedGroup && !state.browseFeedGroups && state.overlayOpen) {
    closePanel();
    return;
  }
  state.canReturnToFeedGroups = false;
  state.scope = "saved";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  openPanel();
  syncRoute({ replace: false });
  await bootstrap();
});

elements.navManualArticles.addEventListener("click", async () => {
  if (state.scope === "manual" && !state.feedGroup && !state.browseFeedGroups && state.overlayOpen) {
    closePanel();
    return;
  }
  state.canReturnToFeedGroups = false;
  state.scope = "manual";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  openPanel();
  syncRoute({ replace: false });
  await bootstrap();
});

elements.navYoutube.addEventListener("click", async () => {
  if (state.scope === "youtube" && !state.feedGroup && !state.browseFeedGroups && state.overlayOpen) {
    closePanel();
    return;
  }
  state.canReturnToFeedGroups = false;
  state.scope = "youtube";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  openPanel();
  syncRoute({ replace: false });
  await bootstrap();
});

elements.navBooks.addEventListener("click", async () => {
  if (state.scope === "books" && state.overlayOpen) {
    closePanel();
    return;
  }
  state.canReturnToFeedGroups = false;
  state.scope = "books";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  state.explicitArticleSelection = false;
  setBookSaveFeedback("Synced", "idle");
  openPanel();
  syncRoute({ replace: false });
  await loadBooks({ preserveSelection: true });
  if (isNarrowViewport() && state.selectedBookId) {
    closePanel();
  }
  render();
});

elements.navFeeds.addEventListener("click", () => {
  if (state.browseFeedGroups && state.overlayOpen) {
    closePanel();
    return;
  }
  state.canReturnToFeedGroups = false;
  state.browseFeedGroups = true;
  state.feedGroup = "";
  openPanel();
  syncRoute({ replace: false });
  render();
});

elements.feedGroupList.addEventListener("click", async (event) => {
  const anchor = event.target.closest("[data-feed-group]");
  if (!anchor) {
    return;
  }

  state.scope = "all";
  state.canReturnToFeedGroups = true;
  state.feedGroup = anchor.dataset.feedGroup;
  state.browseFeedGroups = false;
  clearSelection();
  syncRoute({ replace: false });
  await bootstrap();
});

elements.listBackButton.addEventListener("click", () => {
  state.canReturnToFeedGroups = false;
  state.browseFeedGroups = true;
  state.feedGroup = "";
  openPanel();
  syncRoute({ replace: false });
  render();
});

elements.articleList.addEventListener("click", async (event) => {
  const monthButton = event.target.closest("[data-calendar-month-offset]");
  if (monthButton) {
    const offset = Number(monthButton.dataset.calendarMonthOffset || "0");
    if (!Number.isFinite(offset) || offset === 0) {
      return;
    }

    state.calendarMonth = shiftMonth(
      state.calendarMonth || startOfMonthKey(state.digestDate || state.digest?.todayLocalDate || ""),
      offset
    );
    renderArticleList();
    return;
  }

  const dateButton = event.target.closest("[data-calendar-date]");
  if (dateButton) {
    const localDate = dateButton.dataset.calendarDate;
    if (!localDate) {
      return;
    }

    clearSelection();
    await loadDigestForDate(localDate === state.digest?.todayLocalDate ? "" : localDate, {
      updateRoute: true
    });
    return;
  }

  const item = event.target.closest("[data-article-id]");
  if (item) {
    await selectArticle(item.dataset.articleId, { explicit: true, updateRoute: true });
    return;
  }

  const bookCard = event.target.closest("[data-book-id]");
  if (!bookCard) {
    return;
  }

  state.selectedBookId = bookCard.dataset.bookId;
  state.selectedBookSectionId = getSelectedBookSection(getBookById(state.selectedBookId))?.id || "";
  state.explicitArticleSelection = true;
  setBookSaveFeedback("Synced", "idle");
  if (isBooksMode() && isNarrowViewport()) {
    closePanel();
  }
  syncRoute({ replace: false });
  render();
});

elements.articleView.addEventListener("click", async (event) => {
  const titleEditInput = event.target.closest("[data-book-section-title-edit-input]");
  if (titleEditInput) {
    event.stopPropagation();
    return;
  }

  const addBookSectionButton = event.target.closest("[data-book-section-add]");
  if (addBookSectionButton) {
    const bookId = addBookSectionButton.dataset.bookSectionAdd;
    const book = getBookById(bookId);
    const sectionCount = Array.isArray(book?.sections) ? book.sections.length : 0;
    const suggestedTitle = `Section ${sectionCount + 1}`;
    const requestedTitle = window.prompt("New chapter title", suggestedTitle);
    if (requestedTitle == null) {
      return;
    }

    const nextTitle = requestedTitle.trim() || suggestedTitle;
    const nextSections = patchBookSections(bookId, (sections) => [...sections, createBookSection(nextTitle, sections.length)]);
    state.selectedBookSectionId = nextSections[nextSections.length - 1]?.id || "";
    scheduleBookSync(`sections:${bookId}`, () =>
      convexRequest("mutation", "books:updateSections", {
        bookId,
        sections: nextSections
      }),
    "Sections synced");
    render();
    return;
  }

  const sectionButton = event.target.closest("[data-book-section-id]");
  if (sectionButton) {
    state.editingBookSectionId = "";
    state.selectedBookSectionId = sectionButton.dataset.bookSectionId;
    state.explicitArticleSelection = true;
    syncRoute({ replace: false });
    render();
    return;
  }

  const highlightMark = event.target.closest("[data-highlight-id]");
  if (highlightMark) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.isHighlightsPanelOpen) {
      state.isHighlightsPanelOpen = true;
      renderHighlightsRail();
    }
    const jump = elements.inspectorPanelBody?.querySelector?.(`[data-highlight-jump-id="${CSS.escape(highlightMark.dataset.highlightId)}"]`);
    if (jump) {
      jump.scrollIntoView({ behavior: "smooth", block: "nearest" });
      jump.focus({ preventScroll: true });
    }
    return;
  }

  const transcriptTimestamp = event.target.closest("[data-seek-seconds]");
  if (transcriptTimestamp) {
    seekYouTubeHeroPlayer(Number(transcriptTimestamp.dataset.seekSeconds || "0"));
    return;
  }

  const highlightJump = event.target.closest("[data-highlight-jump-id]");
  if (highlightJump) {
    const highlightId = highlightJump.dataset.highlightJumpId;
    const mark = elements.articleView.querySelector(`[data-highlight-id="${CSS.escape(highlightId)}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      mark.focus({ preventScroll: true });
    }
    return;
  }

  const highlightRemove = event.target.closest("[data-highlight-remove-id]");
  if (highlightRemove) {
    event.preventDefault();
    event.stopPropagation();
    await removeHighlight(highlightRemove.dataset.highlightRemoveId);
    return;
  }

  const toggleHighlights = event.target.closest("[data-toggle-highlights-panel='true']");
  if (toggleHighlights) {
    event.preventDefault();
    event.stopPropagation();
    state.isHighlightsPanelOpen = false;
    renderHighlightsRail();
    return;
  }

  const item = event.target.closest("[data-digest-article-id]");
  if (item) {
    await selectArticle(item.dataset.digestArticleId);
    return;
  }

  const resetButton = event.target.closest("[data-digest-reset-today='true']");
  if (resetButton) {
    clearSelection();
    await loadDigestForDate("", { updateRoute: true });
    return;
  }

  const offsetButton = event.target.closest("[data-digest-date-offset]");
  if (!offsetButton) {
    return;
  }

  const offset = Number(offsetButton.dataset.digestDateOffset || "0");
  if (!Number.isFinite(offset) || offset === 0) {
    return;
  }

  if (offset > 0 && state.digest?.isToday) {
    return;
  }

  const baseDate = state.digestDate || state.digest?.localDate || "";
  if (!baseDate) {
    return;
  }

  clearSelection();
  await loadDigestForDate(shiftLocalDate(baseDate, offset), { updateRoute: true });
});

elements.articleView.addEventListener("dblclick", (event) => {
  const sectionButton = event.target.closest("[data-book-section-id]");
  if (!sectionButton) {
    return;
  }

  const sectionId = sectionButton.dataset.bookSectionId;
  if (!sectionId) {
    return;
  }

  state.selectedBookSectionId = sectionId;
  state.editingBookSectionId = sectionId;
  state.explicitArticleSelection = true;
  syncRoute({ replace: false });
  render();
});

elements.articleView.addEventListener("input", (event) => {
  const notesInput = event.target.closest("[data-book-notes-input]");
  if (!notesInput) {
    return;
  }

  const [bookId, sectionId] = String(notesInput.dataset.bookNotesInput || "").split(":");
  if (!bookId || !sectionId) {
    return;
  }

  const nextSections = patchBookSections(bookId, (sections) =>
    sections.map((section) => section.id === sectionId
      ? { ...section, notes: notesInput.value }
      : section)
  );
  scheduleBookSync(`sections:${bookId}`, () =>
    convexRequest("mutation", "books:updateSections", {
      bookId,
      sections: nextSections
    }),
  "Notes synced");
});

elements.articleView.addEventListener("keydown", (event) => {
  const titleEditInput = event.target.closest("[data-book-section-title-edit-input]");
  if (!titleEditInput) {
    return;
  }

  const [bookId, sectionId] = String(titleEditInput.dataset.bookSectionTitleEditInput || "").split(":");
  if (!bookId || !sectionId) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    commitBookSectionTitle(bookId, sectionId, titleEditInput.value);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    state.editingBookSectionId = "";
    render();
  }
});

elements.articleView.addEventListener("focusout", (event) => {
  const titleEditInput = event.target.closest("[data-book-section-title-edit-input]");
  if (!titleEditInput) {
    return;
  }

  const [bookId, sectionId] = String(titleEditInput.dataset.bookSectionTitleEditInput || "").split(":");
  if (!bookId || !sectionId) {
    return;
  }

  commitBookSectionTitle(bookId, sectionId, titleEditInput.value);
});

elements.inspectorPanelBody.addEventListener("click", async (event) => {
  const highlightJump = event.target.closest("[data-highlight-jump-id]");
  if (highlightJump) {
    event.preventDefault();
    const highlightId = highlightJump.dataset.highlightJumpId;
    const mark = elements.articleView.querySelector(`[data-highlight-id="${CSS.escape(highlightId)}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      mark.focus({ preventScroll: true });
    }
    return;
  }

  const highlightRemove = event.target.closest("[data-highlight-remove-id]");
  if (highlightRemove) {
    event.preventDefault();
    await removeHighlight(highlightRemove.dataset.highlightRemoveId);
  }
});

elements.articleView.addEventListener("mouseup", () => {
  window.requestAnimationFrame(() => {
    instantHighlight().catch((error) => {
      showToast(error.message, { error: true });
    });
  });
});

elements.articleList.addEventListener("scroll", () => {
  maybeLoadMoreFromScroll().catch((error) => {
    showToast(error.message, { error: true });
  });
});

elements.listMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleListMenu();
});

elements.listMenu.addEventListener("keydown", (event) => {
  const items = Array.from(elements.listMenu.querySelectorAll(".list-menu-item:not([hidden]):not(:disabled)"));
  const currentIndex = items.indexOf(document.activeElement);

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const next = items[(currentIndex + 1) % items.length];
    if (next) next.focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    const prev = items[(currentIndex - 1 + items.length) % items.length];
    if (prev) prev.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeListMenu();
  }
});

elements.saveArticleButton.addEventListener("click", async () => {
  try {
    await toggleSave();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.deleteArticleButton.addEventListener("click", async () => {
  try {
    if (isBooksMode()) {
      await deleteSelectedBook();
      return;
    }

    await deleteSelectedArticle();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.renameFeedGroupButton.addEventListener("click", () => {
  if (!state.feedGroup) {
    return;
  }

  closeListMenu();
  openRenameFeedGroupDialog(state.feedGroup);
});

elements.removeFeedGroupButton.addEventListener("click", () => {
  if (!state.feedGroup) {
    return;
  }

  closeListMenu();
  openRemoveFeedGroupDialog(state.feedGroup);
});

elements.addFeedMenuButton.addEventListener("click", () => {
  closeListMenu();
  openDialog();
});
elements.addManualArticleButton.addEventListener("click", () => {
  if (isBooksMode()) {
    openBookDialog();
    return;
  }

  openArticleDialog();
});
elements.bookEditButton.addEventListener("click", () => {
  if (!state.selectedBookId) {
    return;
  }

  openBookDialog(state.selectedBookId);
});
elements.settingsButton.addEventListener("click", openSettingsDialog);
elements.settingsCloseButton.addEventListener("click", closeSettingsDialog);
elements.manualSyncButton.addEventListener("click", async () => {
  try {
    elements.manualSyncButton.disabled = true;
    elements.manualSyncButton.textContent = "Syncing…";
    await runManualSync();
    closeSettingsDialog();
    showToast("Manual sync complete.");
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    elements.manualSyncButton.disabled = false;
    elements.manualSyncButton.textContent = "Sync now";
  }
});

elements.feedCancelButton.addEventListener("click", closeDialog);
elements.articleCancelButton.addEventListener("click", closeArticleDialog);
elements.bookCancelButton.addEventListener("click", closeBookDialog);
elements.renameFeedGroupCancelButton.addEventListener("click", closeRenameFeedGroupDialog);
elements.removeFeedGroupCancelButton.addEventListener("click", closeRemoveFeedGroupDialog);
elements.bookCoverFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const dataUrl = await resizeBookCover(file);
    state.bookDialogCoverDataUrl = dataUrl;
    elements.bookRemoveCoverButton.hidden = false;
    renderBookCoverPreview();
    setBookSaveFeedback("Cover ready to sync", "idle");
  } catch (error) {
    elements.bookCoverFileInput.value = "";
    setBookSaveFeedback(error.message, "error");
    showToast(error.message, { error: true });
  }
});
elements.bookRemoveCoverButton.addEventListener("click", () => {
  state.bookDialogCoverDataUrl = "";
  elements.bookCoverFileInput.value = "";
  elements.bookRemoveCoverButton.hidden = true;
  renderBookCoverPreview();
});
elements.feedUrlInput.addEventListener("input", () => {
  if (feedGroupEditedManually && elements.feedGroupInput.value.trim()) {
    return;
  }

  const feedGroup = deriveFeedGroupFromUrl(elements.feedUrlInput.value);
  elements.feedGroupInput.value = feedGroup;
});
elements.feedGroupInput.addEventListener("input", () => {
  feedGroupEditedManually = true;
});
elements.feedForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  setFormSubmitting(elements.feedForm, true);
  try {
    await submitFeed();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    setFormSubmitting(elements.feedForm, false);
  }
});

elements.articleForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  setFormSubmitting(elements.articleForm, true);
  try {
    await submitArticle();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    setFormSubmitting(elements.articleForm, false);
  }
});

elements.bookForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  setFormSubmitting(elements.bookForm, true);
  try {
    await saveBook();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    setFormSubmitting(elements.bookForm, false);
  }
});

elements.renameFeedGroupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  setFormSubmitting(elements.renameFeedGroupForm, true);
  try {
    await renameFeedGroup();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    setFormSubmitting(elements.renameFeedGroupForm, false);
  }
});

elements.removeFeedGroupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await removeFeedGroup();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

document.addEventListener("click", (event) => {
  if (!isListMenuOpen) {
    return;
  }

  if (elements.listActions && elements.listActions.contains(event.target)) {
    return;
  }

  closeListMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isListMenuOpen) {
    closeListMenu();
    return;
  }

  if (event.key === "Escape" && state.overlayOpen) {
    closePanel();
    return;
  }

  if (event.key === "Escape" && state.isHighlightsPanelOpen && state.selectedArticle) {
    state.isHighlightsPanelOpen = false;
    render();
  }
});

document.querySelector("#shortcuts-close-button").addEventListener("click", () => {
  document.querySelector("#shortcuts-dialog").close();
});

elements.previousArticleButton.addEventListener("click", async () => {
  try {
    await moveSelection(-1);
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.nextArticleButton.addEventListener("click", async () => {
  try {
    await moveSelection(1);
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.shareArticleButton.addEventListener("click", async () => {
  try {
    await shareArticle();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.toggleHighlightsButton.addEventListener("click", () => {
  if (!state.selectedArticle) {
    return;
  }

  state.isHighlightsPanelOpen = !state.isHighlightsPanelOpen;
  renderHighlightsRail();
});

elements.inspectorCloseButton.addEventListener("click", () => {
  state.isHighlightsPanelOpen = false;
  renderHighlightsRail();
});

elements.openArticleButton.addEventListener("click", () => {
  if (!canOpenExternalArticle(state.selectedArticle)) {
    return;
  }

  window.open(state.selectedArticle.url, "_blank", "noopener,noreferrer");
});

elements.newsletterCopyButton?.addEventListener("click", async () => {
  if (!state.newsletterInboxEmail) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.newsletterInboxEmail);
    showToast("Newsletter inbox copied.");
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.newsletterSyncButton?.addEventListener("click", async () => {
  try {
    await syncNewsletters();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

document.addEventListener("keydown", async (event) => {
  if (event.target.closest("input, textarea, select, dialog")) {
    return;
  }

  try {
    switch (event.key) {
      case "j":
        event.preventDefault();
        if (state.selectedArticleId) {
          await moveSelection(1);
        } else if (state.articles.length > 0) {
          await selectArticle(state.articles[0].id);
        }
        break;
      case "k":
        event.preventDefault();
        await moveSelection(-1);
        break;
      case "s":
        event.preventDefault();
        await toggleSave();
        break;
      case "o":
        if (canOpenExternalArticle(state.selectedArticle)) {
          event.preventDefault();
          window.open(state.selectedArticle.url, "_blank", "noopener,noreferrer");
        }
        break;
      case "?":
        event.preventDefault();
        document.querySelector("#shortcuts-dialog").showModal();
        break;
    }
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

const resolveTheme = (theme) => {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyTheme = () => {
  const resolved = resolveTheme(state.theme);
  document.documentElement.setAttribute("data-theme", resolved);
  elements.themeAutoButton.classList.toggle("is-active", state.theme === "auto");
  elements.themeLightButton.classList.toggle("is-active", state.theme === "light");
  elements.themeDarkButton.classList.toggle("is-active", state.theme === "dark");
};

const readStoredTheme = () => {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) || "auto";
  } catch {
    return "auto";
  }
};

const persistTheme = () => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  } catch {
    // Ignore unavailable storage.
  }
};

const setTheme = (theme) => {
  state.theme = theme;
  applyTheme();
  persistTheme();
};
elements.themeAutoButton.addEventListener("click", () => setTheme("auto"));
elements.themeLightButton.addEventListener("click", () => setTheme("light"));
elements.themeDarkButton.addEventListener("click", () => setTheme("dark"));

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "auto") {
    applyTheme();
  }
});

const start = async () => {
  await loadConfig();
  renderNewsletterStatus();
  await loadNewsletterStatus().catch((error) => {
    state.newsletterStatus = {
      configured: true,
      inboxEmail: state.newsletterInboxEmail,
      lastError: error.message,
      lastImportedCount: 0,
      lastProcessedCount: 0,
      lastSyncedAt: "",
      status: "error"
    };
    renderNewsletterStatus();
  });
  const route = parseReaderPath(window.location.pathname);
  isApplyingRoute = true;
  try {
    if (route.route === "feeds") {
      await loadCountsOnly();
      state.scope = "all";
      state.feedGroup = "";
      state.browseFeedGroups = true;
      state.canReturnToFeedGroups = false;
      clearSelection();
      openPanel();
      render();
    } else if (route.route === "feed") {
      await loadCountsOnly();
      state.scope = "all";
      state.browseFeedGroups = false;
      state.canReturnToFeedGroups = true;
      state.feedGroup = findFeedGroupBySlug(route.feedGroupSlug);
      clearSelection();
      openPanel();
      await bootstrap({ includeCounts: false });
      if (route.articleSlug) {
        const article = await ensureArticleInCurrentList(route.articleSlug);
        if (article) {
          await selectArticle(article.id, { explicit: true, updateRoute: false });
        }
      }
    } else if (route.scope === "today") {
      state.scope = "today";
      state.feedGroup = "";
      state.browseFeedGroups = false;
      state.canReturnToFeedGroups = false;
      clearSelection();
      await loadDigestForDate(route.localDate || "");
      if (route.articleSlug) {
        const article = findArticleBySlug(route.articleSlug);
        if (article) {
          await selectArticle(article.id, { explicit: true, updateRoute: false });
        }
      }
    } else if (route.scope === "books") {
      state.scope = "books";
      state.feedGroup = "";
      state.browseFeedGroups = false;
      state.canReturnToFeedGroups = false;
      clearSelection();
      await loadBooks({ preserveSelection: false });
      state.explicitArticleSelection = Boolean(route.articleSlug);
      state.selectedBookId = findBookBySlug(route.articleSlug)?.id || state.books[0]?.id || "";
      setBookSaveFeedback("Synced", "idle");
      if (isNarrowViewport() && state.selectedBookId) {
        closePanel();
      } else {
        openPanel();
      }
      render();
    } else {
      state.scope = route.scope;
      state.feedGroup = "";
      state.browseFeedGroups = false;
      state.canReturnToFeedGroups = false;
      clearSelection();
      openPanel();
      await bootstrap();
      if (route.articleSlug) {
        const article = await ensureArticleInCurrentList(route.articleSlug);
        if (article) {
          await selectArticle(article.id, { explicit: true, updateRoute: false });
        }
      }
    }
  } finally {
    isApplyingRoute = false;
    syncRoute({ replace: true });
  }
};

window.addEventListener("popstate", () => {
  start().catch((error) => {
    render();
    showToast(error.message, { error: true });
  });
});

state.theme = readStoredTheme();
applyStaticIcons();
applyTheme();

start().catch((error) => {
  render();
  showToast(error.message, { error: true });
});
