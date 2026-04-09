export const normalizeFeedGroupName = (value, fallback = "Uncategorized") => {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\x20-\x7E]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

  return normalized || fallback;
};
