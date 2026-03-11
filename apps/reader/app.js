const state = {
  articles: [],
  counts: { all: 0, saved: 0, today: 0, folders: {} },
  folder: "",
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
  feedFolderInput: document.querySelector("#feed-folder-input"),
  feedForm: document.querySelector("#feed-form"),
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

const buildQuery = () => {
  const params = new URLSearchParams({
    scope: state.scope,
    tzOffsetMinutes: String(new Date().getTimezoneOffset())
  });

  if (state.folder) {
    params.set("folder", state.folder);
  }

  if (state.selectedArticleId) {
    params.set("selectedArticleId", state.selectedArticleId);
  }

  return params;
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
    elements.foldersList.innerHTML = `<div class="empty-state">Feeds you add will show up here by folder.</div>`;
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

  elements.articleList.innerHTML = state.articles
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
    .join("");
};

const renderArticle = () => {
  const article = state.selectedArticle;
  const selectedIndex = articleIndex();
  const hasSelection = Boolean(article);

  elements.previousArticleButton.disabled = !hasSelection || selectedIndex <= 0;
  elements.nextArticleButton.disabled =
    !hasSelection || selectedIndex === -1 || selectedIndex >= state.articles.length - 1;
  elements.saveArticleButton.disabled = !hasSelection;
  elements.shareArticleButton.disabled = !hasSelection;
  elements.openArticleButton.disabled = !hasSelection;
  elements.markAllReadButton.disabled = state.articles.length === 0;

  elements.saveArticleButton.classList.toggle("is-active", Boolean(article?.isSaved));

  if (!article) {
    elements.articleView.innerHTML = `
      <div class="empty-state">
        Select an article to start reading. New feeds sync through Supabase every 15 minutes.
      </div>
    `;
    return;
  }

  elements.articleView.innerHTML = `
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
    <div class="article-body">${article.bodyHtml || "<p>No article body available yet.</p>"}</div>
  `;
};

const render = () => {
  renderSidebar();
  renderArticleList();
  renderArticle();
};

const bootstrap = async () => {
  const payload = await requestJson(`/api/bootstrap?${buildQuery().toString()}`);
  state.articles = payload.articles;
  state.counts = payload.counts;
  state.selectedArticle = payload.selectedArticle;
  state.selectedArticleId = payload.selectedArticleId || "";
  render();
};

const selectArticle = async (articleId) => {
  state.selectedArticleId = articleId;
  const summary = state.articles.find((article) => article.id === articleId);

  if (summary && !summary.isRead) {
    summary.isRead = true;
    await requestJson(`/api/articles/${articleId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true })
    });
  }

  state.selectedArticle = await requestJson(`/api/articles/${articleId}`);
  render();
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

  await bootstrap();
  showToast("Marked the current list as read.");
};

const openDialog = () => {
  elements.feedDialog.showModal();
  elements.feedUrlInput.focus();
};

const closeDialog = () => {
  elements.feedDialog.close();
  elements.feedForm.reset();
};

const submitFeed = async () => {
  const payload = await requestJson("/api/feeds", {
    method: "POST",
    body: JSON.stringify({
      folder: elements.feedFolderInput.value,
      inputUrl: elements.feedUrlInput.value
    })
  });

  closeDialog();
  showToast(payload.syncError ? `Feed added. ${payload.syncError}` : "Feed added and syncing.");
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
  const currentIndex = articleIndex();
  if (currentIndex === -1) {
    return;
  }

  const nextArticle = state.articles[currentIndex + direction];
  if (nextArticle) {
    await selectArticle(nextArticle.id);
  }
};

elements.navToday.addEventListener("click", async (event) => {
  event.preventDefault();
  state.scope = "today";
  state.folder = "";
  await bootstrap();
});

elements.navAll.addEventListener("click", async (event) => {
  event.preventDefault();
  state.scope = "all";
  state.folder = "";
  await bootstrap();
});

elements.navSaved.addEventListener("click", async (event) => {
  event.preventDefault();
  state.scope = "saved";
  state.folder = "";
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
  await bootstrap();
});

elements.articleList.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-article-id]");
  if (!item) {
    return;
  }

  await selectArticle(item.dataset.articleId);
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
