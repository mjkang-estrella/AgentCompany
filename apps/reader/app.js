import {
  addIconHtml,
  allArticlesIconHtml,
  deleteIconHtml,
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
  todayIconHtml
} from "./icons.js";
import {
  buildReaderPath,
  parseReaderPath,
  slugifySegment
} from "./lib/reader-routes.mjs";
import { normalizeFeedGroupName } from "./lib/feed-group-name.mjs";

const sanitizeHtml = (dirty) =>
  typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(dirty, { ADD_ATTR: ["referrerpolicy"], ADD_TAGS: ["iframe"] })
    : dirty;

const PAGE_LIMIT = 50;
const LOAD_MORE_THRESHOLD = 240;
const THEME_STORAGE_KEY = "reader.theme";
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
  navManualArticles: document.querySelector("#nav-manual-articles"),
  navSaved: document.querySelector("#nav-saved"),
  navToday: document.querySelector("#nav-today"),
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

const applyStaticIcons = () => {
  elements.navToday.innerHTML = todayIconHtml;
  elements.navAll.innerHTML = allArticlesIconHtml;
  elements.navSaved.innerHTML = savedIconHtml;
  elements.navFeeds.innerHTML = feedsIconHtml;
  elements.navManualArticles.innerHTML = libraryIconHtml;
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

const buildArticleHero = (bodyHtml, thumbnailUrl, title) => {
  if (!bodyHtml && !thumbnailUrl) {
    return { bodyHtml: bodyHtml || "", heroHtml: "" };
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

const buildRequestArgs = ({ cursor = null, includeSelectedArticleId = false } = {}) => {
  const args = {
    limit: PAGE_LIMIT,
    scope: state.scope,
    timezoneOffsetMinutes: new Date().getTimezoneOffset()
  };

  if (state.feedGroup) {
    args.feedGroup = state.feedGroup;
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
  state.selectedArticle = null;
  state.selectedArticleId = "";
};

const currentRoutePath = () => {
  const summaryArticle = state.articles.find((article) => article.id === state.selectedArticleId);

  return buildReaderPath({
    articleTitle: summaryArticle?.title || state.selectedArticle?.title || "",
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

const loadCountsOnly = async () => {
  const payload = await convexRequest("query", "reader:getCounts", {
    timezoneOffsetMinutes: new Date().getTimezoneOffset()
  });
  state.counts = payload.counts || { ...emptyCounts };
  return state.counts;
};

const renderRail = () => {
  elements.navToday.classList.toggle("is-active", state.scope === "today" && !state.feedGroup && !state.browseFeedGroups);
  elements.navAll.classList.toggle("is-active", state.scope === "all" && !state.feedGroup && !state.browseFeedGroups);
  elements.navSaved.classList.toggle("is-active", state.scope === "saved" && !state.feedGroup && !state.browseFeedGroups);
  elements.navFeeds.classList.toggle("is-active", state.browseFeedGroups || Boolean(state.feedGroup));
  elements.navManualArticles.classList.toggle("is-active", state.scope === "manual" && !state.feedGroup && !state.browseFeedGroups);

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

const renderArticleList = () => {
  elements.listTitle.textContent = state.browseFeedGroups ? "Feeds" : listTitle();
  elements.listBackButton.hidden = !(
    state.canReturnToFeedGroups &&
    state.feedGroup &&
    !state.browseFeedGroups
  );
  elements.addManualArticleButton.hidden = state.scope !== "manual" || state.browseFeedGroups;

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
  elements.listActions.hidden = !(showFeedSettings || state.scope === "manual");
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
        No articles match this view yet. Add a feed, paste an article URL, send newsletters to ${escapeHtml(state.newsletterInboxEmail || "news@mj-kang.com")}, or wait for the next scheduled sync.
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
  const isTodayDigest = Boolean(state.digest.isToday);
  elements.articleView.innerHTML = `
    <div class="digest-view">
      <header class="digest-header">
        <button class="digest-eyebrow digest-eyebrow-button" data-digest-reset-today="true" type="button">
          ${DIGEST_DATE_LABEL}
        </button>
        <div class="digest-title">Daily Digest</div>
        <div class="digest-meta">
          <button class="inline-link digest-date-nav" data-digest-date-offset="-1" type="button">
            Previous day
          </button>
          <button class="inline-link digest-date-pill" data-digest-reset-today="true" type="button">
            ${escapeHtml(state.digest.localDateLabel || "")}
          </button>
          <button class="inline-link digest-date-nav" data-digest-date-offset="1" type="button" ${isTodayDigest ? "disabled" : ""}>
            Next day
          </button>
          ${state.digest.generatedAt ? ` • Generated ${escapeHtml(formatListTime(state.digest.generatedAt))}` : ""}
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

  const articleHero = buildArticleHero(article.bodyHtml, article.thumbnailUrl, article.title);

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
      timezoneOffsetMinutes: new Date().getTimezoneOffset()
    });

    state.articles = payload.articles || [];
    state.counts = payload.counts || { ...emptyCounts };
    state.digest = payload.digest
      ? {
        ...payload.digest,
        isToday: payload.isToday,
        localDateLabel: payload.localDateLabel || payload.digest.localDate,
        todayLocalDate: payload.todayLocalDate
      }
      : null;
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
    : await convexRequest("query", "digest:getToday", {
      timezoneOffsetMinutes: new Date().getTimezoneOffset()
    });

  state.articles = payload.articles || [];
  state.counts = payload.counts || { ...emptyCounts };
  state.digest = payload.digest
    ? {
      ...payload.digest,
      isToday: payload.isToday,
      localDateLabel: payload.localDateLabel || payload.digest.localDate,
      todayLocalDate: payload.todayLocalDate
    }
    : null;
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

const bootstrap = async () => {
  const payload = await convexRequest(
    "query",
    "reader:bootstrap",
    buildRequestArgs({ includeSelectedArticleId: true })
  );
  articleRequestToken += 1;
  state.articles = payload.articles || [];
  state.counts = payload.counts || { ...emptyCounts };
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
    }).catch((error) => {
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

  state.selectedArticle = updated;
  const summary = state.articles.find((article) => article.id === updated.id);
  if (summary) {
    summary.isSaved = updated.isSaved;
  }

  if (state.scope === "saved" && !updated.isSaved) {
    clearSelection();
    await bootstrap();
  } else {
    state.counts.saved += updated.isSaved ? 1 : -1;
    if (state.scope === "manual" && !updated.isSaved) {
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
    scope: state.scope,
    timezoneOffsetMinutes: new Date().getTimezoneOffset()
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

  closeArticleDialog();
  state.scope = "manual";
  state.feedGroup = "";
  state.browseFeedGroups = false;
  clearSelection();
  await bootstrap();

  const existing = state.articles.find((article) => article.id === result.articleId);
  if (!existing) {
    const article = await convexRequest("query", "reader:getArticle", { articleId: result.articleId });
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
  if (!item) {
    return;
  }

  await selectArticle(item.dataset.articleId, { explicit: true, updateRoute: true });
});

elements.articleView.addEventListener("click", async (event) => {
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
elements.addManualArticleButton.addEventListener("click", openArticleDialog);
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
elements.renameFeedGroupCancelButton.addEventListener("click", closeRenameFeedGroupDialog);
elements.removeFeedGroupCancelButton.addEventListener("click", closeRemoveFeedGroupDialog);
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
      await bootstrap();
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
