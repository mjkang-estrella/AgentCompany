import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

function getServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required.");
  }

  return key;
}

export function getSupabaseUrl(): string {
  if (!process.env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required.");
  }

  return process.env.SUPABASE_URL;
}

export function getSupabaseServerClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(getSupabaseUrl(), getServiceKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cachedClient;
}
