import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

import { getSupabaseAdminKey, loadEnvFiles, requireEnv } from "../lib/env.mjs";

const callConvex = async (convexUrl, path, args = {}) => {
  const response = await fetch(`${convexUrl}/api/action`, {
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

  const payload = await response.json();
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.errorMessage || `${response.status} ${response.statusText}`);
  }

  return payload.value;
};

const main = async () => {
  await loadEnvFiles(fileURLToPath(new URL("../", import.meta.url)));
  const env = requireEnv("SUPABASE_URL", "CONVEX_URL");
  const supabase = createClient(env.SUPABASE_URL, getSupabaseAdminKey(), {
    auth: { persistSession: false }
  });

  const result = await supabase
    .from("feeds")
    .select("feed_url, folder, icon_url, is_active, site_url, title")
    .order("title", { ascending: true });

  if (result.error) {
    throw new Error(result.error.message || "Could not read Supabase feeds");
  }

  const feeds = (result.data || []).map((feed) => ({
    feedUrl: feed.feed_url,
    feedGroup: feed.folder,
    iconUrl: feed.icon_url || undefined,
    isActive: Boolean(feed.is_active),
    siteUrl: feed.site_url || undefined,
    title: feed.title
  }));

  const imported = await callConvex(env.CONVEX_URL, "migration:importFeeds", { feeds });
  console.log(JSON.stringify(imported, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
