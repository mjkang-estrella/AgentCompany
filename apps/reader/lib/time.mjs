const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const getTodayBounds = (timezoneOffsetMinutes, now = new Date()) => {
  const localTimestamp = now.getTime() - timezoneOffsetMinutes * MINUTE_MS;
  const localNow = new Date(localTimestamp);
  const startOfLocalDay = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate()
  );
  const startUtcTimestamp = startOfLocalDay + timezoneOffsetMinutes * MINUTE_MS;

  return {
    start: new Date(startUtcTimestamp),
    end: new Date(startUtcTimestamp + DAY_MS)
  };
};

export const isToday = (value, timezoneOffsetMinutes, now = new Date()) => {
  const publishedAt = new Date(value);
  const { start, end } = getTodayBounds(timezoneOffsetMinutes, now);
  return publishedAt >= start && publishedAt < end;
};
