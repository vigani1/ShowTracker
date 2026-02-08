import { mutation } from "./_generated/server";
import { v } from "convex/values";

const showInput = {
  tmdbId: v.optional(v.number()),
  anilistId: v.optional(v.number()),
  tvmazeId: v.optional(v.number()),
  imdbId: v.optional(v.string()),
  mediaType: v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
  title: v.string(),
  overview: v.optional(v.string()),
  posterUrl: v.optional(v.string()),
  backdropUrl: v.optional(v.string()),
  genres: v.optional(v.array(v.string())),
  status: v.optional(v.string()),
  totalEpisodes: v.optional(v.number()),
  totalSeasons: v.optional(v.number()),
  episodeRuntime: v.optional(v.number()),
  rating: v.optional(v.number()),
  firstAired: v.optional(v.string()),
  lastUpdated: v.number(),
};

export const upsertShow = mutation({
  args: showInput,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const existing =
      (args.tmdbId
        ? await ctx.db
            .query("shows")
            .withIndex("by_tmdbId", (q) => q.eq("tmdbId", args.tmdbId))
            .unique()
        : null) ??
      (args.anilistId
        ? await ctx.db
            .query("shows")
            .withIndex("by_anilistId", (q) => q.eq("anilistId", args.anilistId))
            .unique()
        : null) ??
      (args.tvmazeId
        ? await ctx.db
            .query("shows")
            .withIndex("by_tvmazeId", (q) => q.eq("tvmazeId", args.tvmazeId))
            .unique()
        : null);

    if (existing) {
      await ctx.db.patch(existing._id, { ...args });
      return existing._id;
    }

    return ctx.db.insert("shows", { ...args });
  },
});
