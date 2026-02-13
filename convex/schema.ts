import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  userProfiles: defineTable({
    userId: v.id("users"),
    avatarUrl: v.optional(v.string()),
    bannerUrl: v.optional(v.string()),
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
    tokenIdentifier: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_tokenIdentifier", ["tokenIdentifier"]),
  userFavorites: defineTable({
    userId: v.id("users"),
    showId: v.id("shows"),
    mediaType: v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_show", ["userId", "showId"])
    .index("by_user_mediaType", ["userId", "mediaType"]),
  userSocial: defineTable({
    userId: v.id("users"),
    followingCount: v.optional(v.number()),
    followersCount: v.optional(v.number()),
    commentsCount: v.optional(v.number()),
  }).index("by_user", ["userId"]),
  shows: defineTable({
    tmdbId: v.optional(v.number()),
    anilistId: v.optional(v.number()),
    malId: v.optional(v.number()),
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
    anilistFormat: v.optional(v.string()),
    animeSeason: v.optional(v.string()),
    animeSeasonYear: v.optional(v.number()),
    rootAnilistId: v.optional(v.number()),
    relatedAnilistIds: v.optional(v.array(v.number())),
    lastRelationSyncAt: v.optional(v.number()),
    lastUpdated: v.number(),
  })
    .index("by_tmdbId", ["tmdbId"])
    .index("by_anilistId", ["anilistId"])
    .index("by_malId", ["malId"])
    .index("by_rootAnilistId", ["rootAnilistId"])
    .index("by_tvmazeId", ["tvmazeId"])
    .index("by_mediaType", ["mediaType"]),
  userShows: defineTable({
    userId: v.id("users"),
    showId: v.id("shows"),
    status: v.union(
      v.literal("watching"),
      v.literal("paused"),
      v.literal("dropped"),
      v.literal("completed"),
      v.literal("plan_to_watch")
    ),
    isAutoTracked: v.optional(v.boolean()),
    relationRootAnilistId: v.optional(v.number()),
    lastRelationSyncAt: v.optional(v.number()),
    addedAt: v.number(),
    lastWatchedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_relation_root", ["userId", "relationRootAnilistId"])
    .index("by_user_show", ["userId", "showId"]),
  watchedEpisodes: defineTable({
    userId: v.id("users"),
    showId: v.id("shows"),
    season: v.number(),
    episode: v.number(),
    watchedAt: v.number(),
    runtime: v.optional(v.number()),
    watchCount: v.optional(v.number()),
    watchHistory: v.optional(v.array(v.number())),
  })
    .index("by_user_show", ["userId", "showId"])
    .index("by_user", ["userId"])
    .index("by_watchedAt", ["userId", "watchedAt"])
    .index("by_user_show_season_episode", ["userId", "showId", "season", "episode"]),
  customLists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    showIds: v.array(v.id("shows")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
  scheduleCache: defineTable({
    date: v.string(),
    mediaType: v.string(),
    episodes: v.string(),
    lastUpdated: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_type", ["date", "mediaType"])
    .index("by_type_date", ["mediaType", "date"]),
});
