export const MIN_USABLE_ARTICLE_BODY_CHARS = 40;
export const RECENT_FEED_RECHECK_LIMIT = 5;

export const shouldProcessFeedEntry = ({
  existing,
  feedLastSyncedAt,
  index,
  publishedAt
}) =>
  !existing ||
  existing.bodyTextLength < MIN_USABLE_ARTICLE_BODY_CHARS ||
  !feedLastSyncedAt ||
  index < RECENT_FEED_RECHECK_LIMIT ||
  publishedAt >= feedLastSyncedAt;
