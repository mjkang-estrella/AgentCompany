const PAGE_LIMIT = 50;
const LOAD_MORE_THRESHOLD = 240;

const state = {
  articles: [],
  counts: { all: 0, saved: 0, today: 0, folders: {} },
  folder: "",
  hasMore: false,
  isLoadingArticle: false,
  isLoadingMore: false,
  nextCursor: null,
  scope: "all",
  selectedArticle: null,
  selectedArticleId: ""
};

const elements = {
  addFeedButton: document.querySelector("#add-feed-button"),
  articleList: document.querySelector("#article-list"),
  articleView: document.querySelector("#article-view"),
  countAll: document.querySelector("#count-all"),
  countSaved: document.querySelector("#count-saved"),
  countToday: document.querySelector("#count-today"),
  feedCancelButton: document.querySelector("#feed-cancel-button"),
  feedDialog: document.querySelector("#feed-dialog"),
  feedForm: document.querySelector("#feed-form"),
  feedOrganizationInput: document.querySelector("#feed-organization-input"),
  feedUrlInput: document.querySelector("#feed-url-input"),
  foldersList: document.querySelector("#folders-list"),
  listTitle: document.querySelector("#list-title"),
  markAllReadButton: document.querySelector("#mark-all-read-button"),
  navAll: document.querySelector("#nav-all"),
  navSaved: document.querySelector("#nav-saved"),
  navToday: document.querySelector("#nav-today"),
  nextArticleButton: document.querySelector("#next-article-button"),
  openArticleButton: document.querySelector("#open-article-button"),
  previousArticleButton: document.querySelector("#previous-article-button"),
  saveArticleButton: document.querySelector("#save-article-button"),
  shareArticleButton: document.querySelector("#share-article-button"),
  toast: document.querySelector("#toast")
};

const folderIcon = `
  <svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
`;

const fallbackFeedIcon = `
  <svg class="feed-icon-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
`;

let toastTimer = null;
let organizationEditedManually = false;
let articleRequestToken = 0;

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

const listTitle = () => {
  if (state.folder) {
    return state.folder;
  }

  if (state.scope === "today") {
    return "Today";
  }

  if (state.scope === "saved") {
    return "Saved";
  }

  return "All Articles";
};

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

const articleIndex = () =>
  state.articles.findIndex((article) => article.id === state.selectedArticleId);

const feedIconMarkup = (iconUrl) =>
  iconUrl
    ? `<img class="feed-icon-small" src="${escapeHtml(iconUrl)}" alt="" referrerpolicy="no-referrer">`
    : fallbackFeedIcon;

const titleCaseWord = (word) =>
  word ? word.charAt(0).toUpperCase() + word.slice(1) : "";

const deriveOrganizationFromUrl = (value) => {
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

const buildQuery = ({ cursor = null, includeSelectedArticleId = false } = {}) => {
  const params = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    scope: state.scope,
    tzOffsetMinutes: String(new Date().getTimezoneOffset())
  });

  if (state.folder) {
    params.set("folder", state.folder);
  }

  if (includeSelectedArticleId && state.selectedArticleId) {
    params.set("selectedArticleId", state.selectedArticleId);
  }

  if (cursor?.beforePublishedAt) {
    params.set("beforePublishedAt", cursor.beforePublishedAt);
  }

  if (cursor?.beforeId) {
    params.set("beforeId", cursor.beforeId);
  }

  return params;
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
  elements.countSaved.textContent = String(state.counts.saved || 0);

  elements.navToday.classList.toggle("active", state.scope === "today" && !state.folder);
  elements.navAll.classList.toggle("active", state.scope === "all" && !state.folder);
  elements.navSaved.classList.toggle("active", state.scope === "saved" && !state.folder);

  const folders = Object.entries(state.counts.folders || {}).sort((left, right) =>
    left[0].localeCompare(right[0])
  );

  if (folders.length === 0) {
    elements.foldersList.innerHTML = `<div class="empty-state">Feeds you add will show up here by organization.</div>`;
    return;
  }

  elements.foldersList.innerHTML = folders
    .map(([folder, count]) => `
      <a href="#" class="nav-item ${state.folder === folder ? "active" : ""}" data-folder="${escapeHtml(folder)}">
        ${folderIcon}
        ${escapeHtml(folder)}
        <span class="nav-item-count">${count}</span>
      </a>
    `)
    .join("");
};

const renderArticleList = () => {
  elements.listTitle.textContent = listTitle();

  if (state.articles.length === 0) {
    elements.articleList.innerHTML = `
      <div class="empty-state">
        No articles match this view yet. Add a feed or wait for the next scheduled sync.
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
        <div class="article-item ${article.id === state.selectedArticleId ? "active" : ""}" data-article-id="${article.id}">
          <div class="item-meta">
            <div class="item-source">
              ${article.isRead ? "" : '<span class="unread-dot"></span>'}
              ${escapeHtml(article.feedTitle)}
            </div>
            <span class="item-time">${escapeHtml(formatListTime(article.publishedAt))}</span>
          </div>
          <div class="item-title">${escapeHtml(article.title)}</div>
          <div class="item-preview">${escapeHtml(article.previewText || "No preview available.")}</div>
        </div>
      `)
      .join("")}
    ${statusMarkup}
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
  elements.shareArticleButton.disabled = !article;
  elements.openArticleButton.disabled = !article;
  elements.markAllReadButton.disabled = state.articles.length === 0;

  elements.saveArticleButton.classList.toggle("is-active", Boolean(article?.isSaved));

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
        Select an article to start reading. New feeds sync through Supabase every 15 minutes.
      </div>
    `;
    return;
  }

  const articleHero = buildArticleHero(article.bodyHtml, article.thumbnailUrl, article.title);

  elements.articleView.innerHTML = `
    ${articleHero.heroHtml ? `<div class="article-hero">${articleHero.heroHtml}</div>` : ""}
    <header class="article-header">
      <div class="article-feed-name">
        ${feedIconMarkup(article.feedIconUrl)}
        ${escapeHtml(article.feedTitle)}
      </div>
      <h1 class="article-h1">${escapeHtml(article.title)}</h1>
      <div class="article-meta-row">
        <span>By <span class="article-author">${escapeHtml(article.author || "Unknown author")}</span></span>
        <span>•</span>
        <span>${escapeHtml(formatArticleDate(article.publishedAt))}</span>
        <span>•</span>
        <span>${escapeHtml(`${article.readTimeMinutes} min read`)}</span>
      </div>
    </header>
    <div class="article-body">${articleHero.bodyHtml || "<p>No article body available yet.</p>"}</div>
  `;
};

const render = () => {
  renderSidebar();
  renderArticleList();
  renderArticle();
};

const loadArticle = async (articleId) => {
  const requestToken = ++articleRequestToken;
  state.isLoadingArticle = true;
  state.selectedArticle = null;
  render();

  try {
    const article = await requestJson(`/api/articles/${articleId}`);
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

const bootstrap = async () => {
  const payload = await requestJson(`/api/bootstrap?${buildQuery({ includeSelectedArticleId: true }).toString()}`);
  articleRequestToken += 1;
  state.articles = payload.articles || [];
  state.counts = payload.counts || { all: 0, saved: 0, today: 0, folders: {} };
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
    const payload = await requestJson(`/api/articles?${buildQuery({ cursor: state.nextCursor }).toString()}`);
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
    requestJson(`/api/articles/${articleId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true })
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

  const updated = await requestJson(`/api/articles/${state.selectedArticle.id}`, {
    method: "PATCH",
    body: JSON.stringify({ isSaved: !state.selectedArticle.isSaved })
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
    render();
  }
};

const markAllRead = async () => {
  await requestJson("/api/articles/mark-all-read", {
    method: "POST",
    body: JSON.stringify({
      folder: state.folder,
      scope: state.scope,
      tzOffsetMinutes: new Date().getTimezoneOffset()
    })
  });

  clearSelection();
  await bootstrap();
  showToast("Marked the current list as read.");
};

const openDialog = () => {
  organizationEditedManually = false;
  elements.feedDialog.showModal();
  elements.feedUrlInput.focus();
};

const closeDialog = () => {
  elements.feedDialog.close();
  elements.feedForm.reset();
  organizationEditedManually = false;
};

const submitFeed = async () => {
  const payload = await requestJson("/api/feeds", {
    method: "POST",
    body: JSON.stringify({
      folder: elements.feedOrganizationInput.value,
      inputUrl: elements.feedUrlInput.value
    })
  });

  closeDialog();
  const syncedArticles = payload.sync?.results?.[0]?.syncedArticles;
  showToast(
    Number.isFinite(syncedArticles)
      ? `Feed added with ${syncedArticles} articles.`
      : "Feed added and synced."
  );
  clearSelection();
  await bootstrap();
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

elements.navToday.addEventListener("click", async (event) => {
  event.preventDefault();
  state.scope = "today";
  state.folder = "";
  clearSelection();
  await bootstrap();
});

elements.navAll.addEventListener("click", async (event) => {
  event.preventDefault();
  state.scope = "all";
  state.folder = "";
  clearSelection();
  await bootstrap();
});

elements.navSaved.addEventListener("click", async (event) => {
  event.preventDefault();
  state.scope = "saved";
  state.folder = "";
  clearSelection();
  await bootstrap();
});

elements.foldersList.addEventListener("click", async (event) => {
  const anchor = event.target.closest("[data-folder]");
  if (!anchor) {
    return;
  }

  event.preventDefault();
  state.scope = "all";
  state.folder = anchor.dataset.folder;
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

elements.articleList.addEventListener("scroll", () => {
  maybeLoadMoreFromScroll().catch((error) => {
    showToast(error.message, { error: true });
  });
});

elements.saveArticleButton.addEventListener("click", async () => {
  try {
    await toggleSave();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.markAllReadButton.addEventListener("click", async () => {
  try {
    await markAllRead();
  } catch (error) {
    showToast(error.message, { error: true });
  }
});

elements.addFeedButton.addEventListener("click", openDialog);
elements.feedCancelButton.addEventListener("click", closeDialog);
elements.feedUrlInput.addEventListener("input", () => {
  if (organizationEditedManually && elements.feedOrganizationInput.value.trim()) {
    return;
  }

  const organization = deriveOrganizationFromUrl(elements.feedUrlInput.value);
  elements.feedOrganizationInput.value = organization;
});
elements.feedOrganizationInput.addEventListener("input", () => {
  organizationEditedManually = true;
});
elements.feedForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await submitFeed();
  } catch (error) {
    showToast(error.message, { error: true });
  }
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

bootstrap().catch((error) => {
  render();
  showToast(error.message, { error: true });
});
