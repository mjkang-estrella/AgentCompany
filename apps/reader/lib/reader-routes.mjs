const normalizeText = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[’']/gu, "")
    .toLowerCase()
    .trim();

export const slugifySegment = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "untitled";

export const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""));

export const parseReaderPath = (pathname) => {
  const trimmed = String(pathname || "/").replace(/\/+$/u, "") || "/";
  const segments = trimmed
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(decodeURIComponent);

  if (segments.length === 0) {
    return { browseFeedGroups: false, feedGroupSlug: "", localDate: "", route: "today", scope: "today", articleSlug: "" };
  }

  const [head, second, third] = segments;

  if (head === "feeds") {
    return { browseFeedGroups: true, feedGroupSlug: "", localDate: "", route: "feeds", scope: "all", articleSlug: "" };
  }

  if (head === "feed" && second) {
    return {
      browseFeedGroups: false,
      feedGroupSlug: second,
      localDate: "",
      route: "feed",
      scope: "all",
      articleSlug: third || ""
    };
  }

  if (head === "all" || head === "saved" || head === "library") {
    return {
      browseFeedGroups: false,
      feedGroupSlug: "",
      localDate: "",
      route: head,
      scope: head === "library" ? "manual" : head,
      articleSlug: second || ""
    };
  }

  if (head === "today") {
    if (isDateKey(second)) {
      return {
        browseFeedGroups: false,
        feedGroupSlug: "",
        localDate: second,
        route: "today",
        scope: "today",
        articleSlug: third || ""
      };
    }

    return {
      browseFeedGroups: false,
      feedGroupSlug: "",
      localDate: "",
      route: "today",
      scope: "today",
      articleSlug: second || ""
    };
  }

  return { browseFeedGroups: false, feedGroupSlug: "", localDate: "", route: "today", scope: "today", articleSlug: "" };
};

export const buildReaderPath = ({
  articleTitle = "",
  browseFeedGroups = false,
  digestDate = "",
  explicitArticleSelection = false,
  feedGroup = "",
  scope = "today",
  todayLocalDate = ""
}) => {
  if (browseFeedGroups) {
    return "/feeds";
  }

  const articleSlug = explicitArticleSelection && articleTitle
    ? `/${slugifySegment(articleTitle)}`
    : "";

  if (feedGroup) {
    return `/feed/${slugifySegment(feedGroup)}${articleSlug}`;
  }

  if (scope === "saved") {
    return `/saved${articleSlug}`;
  }

  if (scope === "manual") {
    return `/library${articleSlug}`;
  }

  if (scope === "all") {
    return `/all${articleSlug}`;
  }

  const effectiveDate = digestDate || todayLocalDate || "";
  if (effectiveDate && effectiveDate !== todayLocalDate) {
    return `/today/${effectiveDate}${articleSlug}`;
  }

  if (articleSlug && effectiveDate) {
    return `/today/${effectiveDate}${articleSlug}`;
  }

  return "/today";
};
