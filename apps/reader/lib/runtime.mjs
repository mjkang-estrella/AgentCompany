import { fileURLToPath } from "node:url";

import { createReaderService } from "./reader-service.mjs";
import { getSupabaseAdminKey, loadEnvFiles, requireEnv } from "./env.mjs";

const appDir = fileURLToPath(new URL("../", import.meta.url));

let readerServicePromise = null;

export const getReaderService = async () => {
  if (!readerServicePromise) {
    readerServicePromise = (async () => {
      await loadEnvFiles(appDir);
      const env = requireEnv("SUPABASE_URL");

      return createReaderService({
        serviceRoleKey: getSupabaseAdminKey(),
        url: env.SUPABASE_URL
      });
    })();
  }

  return readerServicePromise;
};
