import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    PRISM_WRITE_SECRET: v.optional(v.string()),
  },
});
