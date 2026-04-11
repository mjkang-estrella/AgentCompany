/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as articles from "../articles.js";
import type * as books from "../books.js";
import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as digestNode from "../digestNode.js";
import type * as feeds from "../feeds.js";
import type * as migration from "../migration.js";
import type * as newsletters from "../newsletters.js";
import type * as newslettersNode from "../newslettersNode.js";
import type * as reader from "../reader.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  articles: typeof articles;
  books: typeof books;
  crons: typeof crons;
  digest: typeof digest;
  digestNode: typeof digestNode;
  feeds: typeof feeds;
  migration: typeof migration;
  newsletters: typeof newsletters;
  newslettersNode: typeof newslettersNode;
  reader: typeof reader;
  sync: typeof sync;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
