export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);

export const sanitizeHtml = (dirty) =>
  typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(dirty, {
      ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy", "src", "title"],
      ADD_TAGS: ["iframe"]
    })
    : dirty;

const trustedHtml = (value) => String(value ?? "");

export const clearHtml = (element) => {
  if (element) {
    element.replaceChildren();
  }
};

export const setTrustedHtml = (element, html) => {
  if (element) {
    element.innerHTML = trustedHtml(html);
  }
};
