const sanitizeHtml = (dirty) =>
  typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(dirty, { ADD_ATTR: ["referrerpolicy"], ADD_TAGS: ["iframe"] })
    : dirty;

const PAGE_LIMIT = 50;
const LOAD_MORE_THRESHOLD = 240;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "reader.sidebarCollapsed";
const THEME_STORAGE_KEY = "reader.theme";
const DIGEST_DATE_LABEL = "Today";
const emptyCounts = {
  all: 0,
  feedGroups: {},
  manual: 0,
  saved: 0,
  today: 0
};
const THEME_ICON_LIGHT = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>
`;
const THEME_ICON_DARK = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>
`;
const SIDEBAR_COLLAPSE_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
`;
const SIDEBAR_EXPAND_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
`;

const state = {
  articles: [],
  counts: { ...emptyCounts },
  convexUrl: "",
  digest: null,
  digestDate: "",
  feedGroup: "",
  hasMore: false,
  isLoadingArticle: false,
  isLoadingDigest: false,
  isLoadingMore: false,
  nextCursor: null,
  pendingFeedGroupRemoval: "",
  scope: "today",
  sidebarCollapsed: false,
  theme: "auto",
  selectedArticle: null,
  selectedArticleId: ""
};

const elements = {
  addFeedButton: document.querySelector("#add-feed-button"),
  addManualArticleButton: document.querySelector("#add-manual-article-button"),
  appLayout: document.querySelector(".app-layout"),
  articleCancelButton: document.querySelector("#article-cancel-button"),
  articleDialog: document.querySelector("#article-dialog"),
  articleForm: document.querySelector("#article-form"),
  articleList: document.querySelector("#article-list"),
  articleUrlInput: document.querySelector("#article-url-input"),
  articleView: document.querySelector("#article-view"),
  countAll: document.querySelector("#count-all"),
  countManual: document.querySelector("#count-manual"),
  countSaved: document.querySelector("#count-saved"),
  countToday: document.querySelector("#count-today"),
  deleteArticleButton: document.querySelector("#delete-article-button"),
  feedCancelButton: document.querySelector("#feed-cancel-button"),
  feedDialog: document.querySelector("#feed-dialog"),
  feedGroupList: document.querySelector("#feed-groups-list"),
  feedForm: document.querySelector("#feed-form"),
  feedGroupInput: document.querySelector("#feed-group-input"),
  feedUrlInput: document.querySelector("#feed-url-input"),
  listActions: document.querySelector(".list-actions"),
  listMenu: document.querySelector("#list-menu"),
  listMenuButton: document.querySelector("#list-menu-button"),
  listTitle: document.querySelector("#list-title"),
  markAllReadButton: document.querySelector("#mark-all-read-button"),
  navAll: document.querySelector("#nav-all"),
  navManualArticles: document.querySelector("#nav-manual-articles"),
  navSaved: document.querySelector("#nav-saved"),
  navToday: document.querySelector("#nav-today"),
  nextArticleButton: document.querySelector("#next-article-button"),
  openArticleButton: document.querySelector("#open-article-button"),
  previousArticleButton: document.querySelector("#previous-article-button"),
  removeFeedGroupButton: document.querySelector("#remove-feed-group-button"),
  removeFeedGroupCancelButton: document.querySelector("#remove-feed-group-cancel-button"),
  removeFeedGroupConfirmButton: document.querySelector("#remove-feed-group-confirm-button"),
  removeFeedGroupCopy: document.querySelector("#remove-feed-group-copy"),
  removeFeedGroupDialog: document.querySelector("#remove-feed-group-dialog"),
  removeFeedGroupForm: document.querySelector("#remove-feed-group-form"),
  saveArticleButton: document.querySelector("#save-article-button"),
  shareArticleButton: document.querySelector("#share-article-button"),
  sidebarToggleButton: document.querySelector("#sidebar-toggle-button"),
  themeToggleButton: document.querySelector("#theme-toggle-button"),
  toast: document.querySelector("#toast")
};

const feedGroupIcon = `
  <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
`;

const fallbackFeedIcon = `
  <svg class="feed-icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
`;

let toastTimer = null;
let feedGroupEditedManually = false;
let articleRequestToken = 0;
let isListMenuOpen = false;

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);

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
    return "Articles";
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

const readStoredSidebarCollapsed = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const persistSidebarCollapsed = () => {
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      state.sidebarCollapsed ? "true" : "false"
    );
  } catch {
    // Ignore unavailable storage.
  }
};

const syncSidebarState = () => {
  elements.appLayout.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  elements.sidebarToggleButton.innerHTML = state.sidebarCollapsed
    ? SIDEBAR_EXPAND_ICON
    : SIDEBAR_COLLAPSE_ICON;
  elements.sidebarToggleButton.title = state.sidebarCollapsed
    ? "Expand sidebar"
    : "Collapse sidebar";
  elements.sidebarToggleButton.setAttribute(
    "aria-label",
    state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
  );
  elements.sidebarToggleButton.setAttribute(
    "aria-pressed",
    state.sidebarCollapsed ? "true" : "false"
  );
};

const syncLayoutMode = () => {
  elements.appLayout.classList.toggle("is-digest-view", isTodayDigestMode());
};

const articleIndex = () =>
  state.articles.findIndex((article) => article.id === state.selectedArticleId);

const feedIconMarkup = (iconUrl) =>
  iconUrl
    ? `<img class="feed-icon-small" src="${escapeHtml(iconUrl)}" alt="" referrerpolicy="no-referrer">`
    : fallbackFeedIcon;

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

    return base
      .split(/[-_]+/u)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(" ");
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
  return state.convexUrl;
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
  state.isLoadingArticle = false;
  state.selectedArticle = null;
  state.selectedArticleId = "";
};

const renderSidebar = () => {
  elements.countToday.textContent = String(state.counts.today || 0);
  elements.countAll.textContent = String(state.counts.all || 0);
  elements.countManual.textContent = String(state.counts.manual || 0);
  elements.countSaved.textContent = String(state.counts.saved || 0);

  elements.navToday.classList.toggle("active", state.scope === "today" && !state.feedGroup);
  elements.navAll.classList.toggle("active", state.scope === "all" && !state.feedGroup);
  elements.navManualArticles.classList.toggle("active", state.scope === "manual" && !state.feedGroup);
  elements.navSaved.classList.toggle("active", state.scope === "saved" && !state.feedGroup);

  const feedGroups = Object.entries(state.counts.feedGroups || {}).sort((left, right) =>
    left[0].localeCompare(right[0])
  );

  if (feedGroups.length === 0) {
    elements.feedGroupList.innerHTML = `<div class="empty-state">Feeds you add will show up here.</div>`;
    return;
  }

  elements.feedGroupList.innerHTML = feedGroups
    .map(([feedGroup, count]) => `
      <button class="nav-item ${state.feedGroup === feedGroup ? "active" : ""}" data-feed-group="${escapeHtml(feedGroup)}">
        ${feedGroupIcon}
        ${escapeHtml(feedGroup)}
        <span class="nav-item-count">${count}</span>
      </button>
    `)
    .join("");
};

const renderArticleList = () => {
  elements.listTitle.textContent = listTitle();
  elements.listActions.hidden = isTodayDigestMode();
  elements.markAllReadButton.disabled = state.articles.length === 0;
  elements.removeFeedGroupButton.hidden = !state.feedGroup;
  elements.removeFeedGroupButton.disabled = !state.feedGroup;
  elements.removeFeedGroupButton.textContent = state.feedGroup
    ? `Remove ${state.feedGroup}`
    : "Remove feed";

  if (state.articles.length === 0) {
    elements.articleList.innerHTML = `
      <div class="empty-state">
        No articles match this view yet. Add a feed, paste an article URL, or wait for the next scheduled sync.
      </div>
    `;
    return;
  }

  const statusMarkup = state.isLoadingMore
    ? '<div class="list-status">Loading more articles…</div>'
    : (state.hasMore ? '<div class="list-status">Scroll for more</div>' : "");

  elements.articleList.innerHTML = `
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

  elements.previousArticleButton.disabled = !hasSelection || selectedIndex <= 0;
  elements.nextArticleButton.disabled =
    !hasSelection ||
    (selectedIndex === -1 && !state.hasMore) ||
    (selectedIndex >= state.articles.length - 1 && !state.hasMore);
  elements.saveArticleButton.disabled = !article;
  elements.deleteArticleButton.disabled = !article;
  elements.shareArticleButton.disabled = !article;
  elements.openArticleButton.disabled = !article;

  elements.saveArticleButton.classList.toggle("is-active", Boolean(article?.isSaved));

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
        Select an article to start reading. New feeds sync through Convex every 30 minutes, and pasted article URLs show up here right away.
      </div>
    `;
    return;
  }

  const articleHero = buildArticleHero(article.bodyHtml, article.thumbnailUrl, article.title);

  elements.articleView.innerHTML = `
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
  `;

  for (const link of elements.articleView.querySelectorAll(".article-body a[href]")) {
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("target", "_blank");
  }

  for (const img of elements.articleView.querySelectorAll(".article-body img")) {
    img.setAttribute("loading", "lazy");
  }
};

const render = () => {
  syncLayoutMode();
  renderSidebar();
  renderArticleList();
  renderArticle();
  syncListMenuState();
};

const loadArticle = async (articleId) => {
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
    }
  }
};

const pollTodayDigest = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const payload = await convexRequest("query", "digest:getToday", {
      timezoneOffsetMinutes: new Date().getTimezoneOffset()
    });

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

const loadDigestForDate = async (localDate = "") => {
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
  render();

  const payload = localDate
    ? await convexRequest("query", "digest:getForDate", { localDate })
    : await convexRequest("query", "digest:getToday", {
      timezoneOffsetMinutes: new Date().getTimezoneOffset()
    });

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
  state.isLoadingDigest = false;
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

const selectArticle = async (articleId) => {
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

  await convexRequest("mutation", "reader:deleteArticle", {
    articleId: state.selectedArticle.id
  });

  clearSelection();
  await refreshCurrentView();
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

const openArticleDialog = () => {
  elements.articleDialog.showModal();
  elements.articleUrlInput.focus();
};

const closeArticleDialog = () => {
  elements.articleDialog.close();
  elements.articleForm.reset();
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

const submitArticle = async () => {
  const result = await convexRequest("action", "articles:addFromUrl", {
    url: elements.articleUrlInput.value
  });

  closeArticleDialog();
  state.scope = "manual";
  state.feedGroup = "";
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
    state.feedGroup = "";
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
  state.scope = "today";
  state.feedGroup = "";
  clearSelection();
  await loadDigestForDate("");
});

elements.navAll.addEventListener("click", async () => {
  state.scope = "all";
  state.feedGroup = "";
  clearSelection();
  await bootstrap();
});

elements.navSaved.addEventListener("click", async () => {
  state.scope = "saved";
  state.feedGroup = "";
  clearSelection();
  await bootstrap();
});

elements.navManualArticles.addEventListener("click", async () => {
  state.scope = "manual";
  state.feedGroup = "";
  clearSelection();
  await bootstrap();
});

elements.feedGroupList.addEventListener("click", async (event) => {
  const anchor = event.target.closest("[data-feed-group]");
  if (!anchor) {
    return;
  }

  state.scope = "all";
  state.feedGroup = anchor.dataset.feedGroup;
  clearSelection();
  await bootstrap();
});

elements.articleList.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-article-id]");
  if (!item) {
    return;
  }

  await selectArticle(item.dataset.articleId);
});

elements.articleView.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-digest-article-id]");
  if (item) {
    await selectArticle(item.dataset.digestArticleId);
    return;
  }

  const resetButton = event.target.closest("[data-digest-reset-today='true']");
  if (resetButton) {
    clearSelection();
    await loadDigestForDate("");
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
  await loadDigestForDate(shiftLocalDate(baseDate, offset));
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

elements.markAllReadButton.addEventListener("click", async () => {
  try {
    closeListMenu();
    await markAllRead();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.removeFeedGroupButton.addEventListener("click", () => {
  if (!state.feedGroup) {
    return;
  }

  closeListMenu();
  openRemoveFeedGroupDialog(state.feedGroup);
});

elements.addFeedButton.addEventListener("click", openDialog);
elements.addManualArticleButton.addEventListener("click", openArticleDialog);
elements.sidebarToggleButton.addEventListener("click", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  syncSidebarState();
  persistSidebarCollapsed();
});
elements.feedCancelButton.addEventListener("click", closeDialog);
elements.articleCancelButton.addEventListener("click", closeArticleDialog);
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

elements.openArticleButton.addEventListener("click", () => {
  if (!state.selectedArticle) {
    return;
  }

  window.open(state.selectedArticle.url, "_blank", "noopener,noreferrer");
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
        if (state.selectedArticle) {
          event.preventDefault();
          window.open(state.selectedArticle.url, "_blank", "noopener,noreferrer");
        }
        break;
      case "m":
        event.preventDefault();
        if (state.articles.length > 0 && window.confirm("Mark all articles in this view as read?")) {
          await markAllRead();
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
  elements.themeToggleButton.innerHTML = resolved === "dark" ? THEME_ICON_LIGHT : THEME_ICON_DARK;
  elements.themeToggleButton.title = resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";
  elements.themeToggleButton.setAttribute(
    "aria-label",
    resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"
  );
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

const toggleTheme = () => {
  const resolved = resolveTheme(state.theme);
  state.theme = resolved === "dark" ? "light" : "dark";
  applyTheme();
  persistTheme();
};

elements.themeToggleButton.addEventListener("click", toggleTheme);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "auto") {
    applyTheme();
  }
});

const start = async () => {
  await loadConfig();
  await refreshCurrentView();
};

state.sidebarCollapsed = readStoredSidebarCollapsed();
syncSidebarState();
state.theme = readStoredTheme();
applyTheme();

start().catch((error) => {
  render();
  showToast(error.message, { error: true });
});
