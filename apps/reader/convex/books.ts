import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

import type { Doc, Id } from "./_generated/dataModel";
import { slugifySegment } from "../lib/reader-routes.mjs";
import { DEFAULT_BOOKS } from "../lib/book-defaults.mjs";

const createSectionId = (title: string, index = 0) => `${slugifySegment(title || "section")}-${index + 1}`;

const deriveSections = (book: Partial<Doc<"books">>) => {
  if (Array.isArray(book.sections) && book.sections.length > 0) {
    return book.sections.map((section) => ({
      id: section.id,
      notes: section.notes || "",
      status: section.status || "todo",
      title: section.title || "Untitled section"
    }));
  }

  return [
    {
      id: "overview-1",
      notes: book.notes || "",
      status: "todo",
      title: "Overview"
    }
  ];
};

const mapBook = (book: Doc<"books">) => ({
  accent: book.accent,
  author: book.author,
  coverImage: book.coverImage || "",
  coverTone: book.coverTone,
  description: book.description,
  id: book._id,
  sections: deriveSections(book),
  slug: book.slug,
  status: book.status,
  title: book.title,
  updatedAt: new Date(book.updatedAt).toISOString()
});

const makeUniqueSlug = async (ctx: any, title: string, currentBookId?: Id<"books">) => {
  const base = slugifySegment(title || "book");
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await ctx.db
      .query("books")
      .withIndex("by_slug", (q: any) => q.eq("slug", candidate))
      .unique();

    if (!existing || existing._id === currentBookId) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const books = await ctx.db
      .query("books")
      .withIndex("by_created_at")
      .order("asc")
      .collect();

    return books.map(mapBook);
  }
});

export const ensureDefaultShelf = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("books").collect();
    const existingSlugs = new Set(existing.map((book: Doc<"books">) => book.slug));
    let inserted = 0;

    for (const book of DEFAULT_BOOKS) {
      const slug = slugifySegment(book.title);
      if (existingSlugs.has(slug)) {
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("books", {
        accent: book.accent,
        author: book.author,
        coverImage: book.coverImage || undefined,
        coverTone: book.coverTone,
        createdAt: now,
        description: book.description,
        sections: [
          {
            id: "overview-1",
            notes: "",
            status: "todo",
            title: "Overview"
          }
        ],
        slug,
        status: book.status,
        title: book.title,
        updatedAt: now
      });
      inserted += 1;
    }

    return { inserted };
  }
});

export const upsert = mutation({
  args: {
    accent: v.string(),
    author: v.string(),
    bookId: v.optional(v.id("books")),
    coverImage: v.optional(v.string()),
    coverTone: v.string(),
    description: v.string(),
    status: v.string(),
    title: v.string()
  },
  handler: async (ctx, args) => {
    const title = args.title.trim();
    if (!title) {
      throw new Error("Book title is required");
    }

    const now = Date.now();

    if (args.bookId) {
      const existing = await ctx.db.get(args.bookId);
      if (!existing) {
        throw new Error("Book not found");
      }

      const slug = await makeUniqueSlug(ctx, title, existing._id);
      await ctx.db.patch(existing._id, {
        accent: args.accent,
        author: args.author,
        coverImage: args.coverImage || undefined,
        coverTone: args.coverTone,
        description: args.description,
        sections: deriveSections(existing),
        slug,
        status: args.status,
        title,
        updatedAt: now
      });

      return mapBook(await ctx.db.get(existing._id));
    }

    const slug = await makeUniqueSlug(ctx, title);
    const bookId = await ctx.db.insert("books", {
      accent: args.accent,
      author: args.author,
      coverImage: args.coverImage || undefined,
      coverTone: args.coverTone,
      createdAt: now,
      description: args.description,
      sections: [
        {
          id: "overview-1",
          notes: "",
          status: "todo",
          title: "Overview"
        }
      ],
      slug,
      status: args.status,
      title,
      updatedAt: now
    });

    return mapBook(await ctx.db.get(bookId));
  }
});

export const updateSections = mutation({
  args: {
    bookId: v.id("books"),
    sections: v.array(v.object({
      id: v.string(),
      notes: v.string(),
      status: v.string(),
      title: v.string()
    }))
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.bookId);
    if (!existing) {
      throw new Error("Book not found");
    }

    await ctx.db.patch(existing._id, {
      sections: args.sections,
      updatedAt: Date.now()
    });

    return mapBook(await ctx.db.get(existing._id));
  }
});

export const remove = mutation({
  args: {
    bookId: v.id("books")
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.bookId);
    if (!existing) {
      throw new Error("Book not found");
    }

    await ctx.db.delete(existing._id);
    return {
      bookId: args.bookId,
      title: existing.title
    };
  }
});

export const migrateLegacyShelf = mutation({
  args: {
    books: v.array(v.object({
      accent: v.optional(v.string()),
      author: v.optional(v.string()),
      coverImage: v.optional(v.string()),
      coverTone: v.optional(v.string()),
      description: v.optional(v.string()),
      id: v.string(),
      status: v.optional(v.string()),
      title: v.string()
    })),
    notesByBookId: v.record(v.string(), v.string())
  },
  handler: async (ctx, args) => {
    let migrated = 0;

    for (const legacyBook of args.books) {
      const title = legacyBook.title.trim();
      if (!title) {
        continue;
      }

      const canonicalSlug = slugifySegment(title);
      const existing = await ctx.db
        .query("books")
        .withIndex("by_slug", (q: any) => q.eq("slug", canonicalSlug))
        .unique();

      const now = Date.now();
      const payload = {
        accent: legacyBook.accent || DEFAULT_BOOKS[0]?.accent || "linear-gradient(160deg, #8A5A2B 0%, #40210F 100%)",
        author: legacyBook.author || "",
        coverImage: legacyBook.coverImage || undefined,
        coverTone: legacyBook.coverTone || DEFAULT_BOOKS[0]?.coverTone || "Timber Study",
        description: legacyBook.description || "",
        sections: [
          {
            id: createSectionId("Overview"),
            notes: args.notesByBookId[legacyBook.id] || "",
            status: "todo",
            title: "Overview"
          }
        ],
        status: legacyBook.status || "Reading",
        title,
        updatedAt: now
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("books", {
          ...payload,
          createdAt: now,
          slug: canonicalSlug
        });
      }

      migrated += 1;
    }

    return { migrated };
  }
});
