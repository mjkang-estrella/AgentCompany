import { getConvexUrl } from "./env.mjs";

const getNewsletterInboxEmail = () =>
  process.env.READER_NEWSLETTER_INBOX_EMAIL || "news@mj-kang.com";

export const buildPublicConfig = () => ({
  convexUrl: getConvexUrl(),
  newsletterInboxEmail: getNewsletterInboxEmail()
});
