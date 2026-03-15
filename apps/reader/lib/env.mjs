import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const parseLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    return null;
  }

  const [, key, rawValue] = match;
  let value = rawValue.trim();

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
};

export const loadEnvFiles = async (appDir) => {
  const rootDir = resolve(appDir, "..", "..");
  const envFiles = [
    resolve(rootDir, ".env"),
    resolve(rootDir, ".env.local"),
    resolve(appDir, ".env"),
    resolve(appDir, ".env.local")
  ];
  const originalKeys = new Set(Object.keys(process.env));

  for (const filePath of envFiles) {
    try {
      const source = await readFile(filePath, "utf8");
      for (const line of source.split(/\r?\n/u)) {
        const entry = parseLine(line);
        if (!entry) {
          continue;
        }

        const [key, value] = entry;
        if (!originalKeys.has(key)) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
};

export const requireEnv = (...keys) => {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
};

export const getConvexUrl = () => {
  const value = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "";
  if (!value) {
    throw new Error("Missing required environment variable: CONVEX_URL");
  }

  return value;
};

export const getSupabaseAdminKey = () => {
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    process.env.SUPABASE_SECRET_KEY || ""
  ].filter(Boolean);

  if (candidates.length === 0) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY"
    );
  }

  const usableKey = candidates.find((key) => !key.startsWith("sb_publishable_"));
  if (!usableKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is set to a publishable key. Use a service role or secret key for the Reader server."
    );
  }

  return usableKey;
};
