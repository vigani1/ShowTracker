import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "@/convex/_generated/server";
import type { QueryCtx, MutationCtx } from "@/convex/_generated/server";
import type { Id } from "@/convex/_generated/dataModel";
import { v } from "convex/values";

async function getCurrentUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }

  return userId as Id<"users">;
}

export const createList = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const now = Date.now();

    const listId = await ctx.db.insert("customLists", {
      userId,
      name: args.name,
      description: args.description,
      showIds: [],
      createdAt: now,
      updatedAt: now,
    });

    return { listId };
  },
});

export const updateList = mutation({
  args: {
    listId: v.id("customLists"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }
    if (list.userId !== userId) {
      throw new Error("Unauthorized");
    }

    const updates: Record<string, any> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(args.listId, updates);

    return { success: true };
  },
});

export const deleteList = mutation({
  args: {
    listId: v.id("customLists"),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }
    if (list.userId !== userId) {
      throw new Error("Unauthorized");
    }

    await ctx.db.delete(args.listId);

    return { success: true };
  },
});

export const addShowToList = mutation({
  args: {
    listId: v.id("customLists"),
    showId: v.id("shows"),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }
    if (list.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Check if show already in list
    if (list.showIds.includes(args.showId)) {
      return { success: true, alreadyExists: true };
    }

    await ctx.db.patch(args.listId, {
      showIds: [...list.showIds, args.showId],
      updatedAt: Date.now(),
    });

    return { success: true, alreadyExists: false };
  },
});

export const removeShowFromList = mutation({
  args: {
    listId: v.id("customLists"),
    showId: v.id("shows"),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }
    if (list.userId !== userId) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.listId, {
      showIds: list.showIds.filter((id) => id !== args.showId),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const reorderListItems = mutation({
  args: {
    listId: v.id("customLists"),
    showIds: v.array(v.id("shows")),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }
    if (list.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Validate that all shows in new order exist in original list
    const originalSet = new Set(list.showIds);
    const newSet = new Set(args.showIds);
    
    if (originalSet.size !== newSet.size) {
      throw new Error("Invalid reorder: item count mismatch");
    }
    
    for (const id of args.showIds) {
      if (!originalSet.has(id)) {
        throw new Error("Invalid reorder: unknown item");
      }
    }

    await ctx.db.patch(args.listId, {
      showIds: args.showIds,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const getUserLists = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);

    const lists = await ctx.db
      .query("customLists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return lists.map((list) => ({
      id: list._id,
      name: list.name,
      description: list.description,
      itemCount: list.showIds.length,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));
  },
});

export const getListDetail = query({
  args: {
    listId: v.id("customLists"),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      return null;
    }
    if (list.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Hydrate shows
    const shows = await Promise.all(
      list.showIds.map(async (showId) => {
        const show = await ctx.db.get(showId);
        if (!show) return null;
        return {
          id: show._id,
          externalId: show.tmdbId
            ? `tmdb:${show.mediaType}:${show.tmdbId}`
            : show.anilistId
            ? `anilist:anime:${show.anilistId}`
            : show.malId
            ? `jikan:anime:${show.malId}`
            : show.tvmazeId
            ? `tvmaze:tv:${show.tvmazeId}`
            : show.imdbId
            ? `imdb:${show.mediaType}:${show.imdbId}`
            : String(show._id),
          title: show.title,
          mediaType: show.mediaType,
          posterUrl: show.posterUrl,
          backdropUrl: show.backdropUrl,
          overview: show.overview,
          rating: show.rating,
        };
      })
    );

    return {
      id: list._id,
      name: list.name,
      description: list.description,
      shows: shows.filter(Boolean),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  },
});

export const getShowLists = query({
  args: {
    showId: v.id("shows"),
  },
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);

    const lists = await ctx.db
      .query("customLists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return lists
      .filter((list) => list.showIds.includes(args.showId))
      .map((list) => ({
        id: list._id,
        name: list.name,
      }));
  },
});
