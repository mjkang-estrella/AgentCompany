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

export const getConvexUrl = () => {
  const value = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "";
  if (!value) {
    throw new Error("Missing required environment variable: CONVEX_URL");
  }

  return value;
};
