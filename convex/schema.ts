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
  userStats: defineTable({
    userId: v.id("users"),
    uniqueEpisodesWatched: v.number(),
    totalRewatches: v.number(),
    totalEpisodesWatched: v.number(),
    tvEpisodes: v.number(),
    animeEpisodes: v.number(),
    movieCount: v.number(),
    totalWatchTimeMinutes: v.number(),
    tvWatchTimeMinutes: v.number(),
    animeWatchTimeMinutes: v.number(),
    movieWatchTimeMinutes: v.number(),
    currentStreak: v.number(),
    longestStreak: v.number(),
    completedShows: v.number(),
    totalTrackedShows: v.number(),
    topRewatchedShows: v.array(
      v.object({
        title: v.string(),
        watchCount: v.number(),
      })
    ),
    rebuiltAt: v.number(),
  }).index("by_user", ["userId"]),
  userAnimeHomeSettings: defineTable({
    userId: v.id("users"),
    relationMode: v.union(v.literal("core_only"), v.literal("all_relations")),
    completionBehavior: v.union(
      v.literal("ask_every_time"),
      v.literal("auto_open_next"),
      v.literal("auto_pause_others_keep_next")
    ),
    pausedSectionMode: v.optional(
      v.union(v.literal("auto_paused_only"), v.literal("all_paused"))
    ),
    watchlistAirtimeMode: v.optional(
      v.union(v.literal("same_day"), v.literal("after_airtime"))
    ),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
  userAnimeFranchiseSettings: defineTable({
    userId: v.id("users"),
    relationRootAnilistId: v.number(),
    relationMode: v.union(v.literal("core_only"), v.literal("all_relations")),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_root", ["userId", "relationRootAnilistId"]),
  shows: defineTable({
    tmdbId: v.optional(v.number()),
    tvdbId: v.optional(v.number()),
    anilistId: v.optional(v.number()),
    malId: v.optional(v.number()),
    tvmazeId: v.optional(v.number()),
    imdbId: v.optional(v.string()),
    mediaType: v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
    title: v.string(),
    titleLower: v.optional(v.string()),
    overview: v.optional(v.string()),
    posterUrl: v.optional(v.string()),
    backdropUrl: v.optional(v.string()),
    genres: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    totalEpisodes: v.optional(v.number()),
    releasedEpisodes: v.optional(v.number()),
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
    .index("by_tvdbId", ["tvdbId"])
    .index("by_anilistId", ["anilistId"])
    .index("by_malId", ["malId"])
    .index("by_title", ["titleLower"])
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
    mediaType: v.optional(
      v.union(v.literal("tv"), v.literal("anime"), v.literal("movie"))
    ),
    isAutoTracked: v.optional(v.boolean()),
    relationRootAnilistId: v.optional(v.number()),
    lastRelationSyncAt: v.optional(v.number()),
    addedAt: v.number(),
    lastWatchedAt: v.optional(v.number()),
    watchedEpisodesCount: v.optional(v.number()),
    watchedTotalCount: v.optional(v.number()),
    watchedRuntimeMinutes: v.optional(v.number()),
    statusChangedAt: v.optional(v.number()),
    droppedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    autoPausedAt: v.optional(v.number()),
    newEpisodeSignalAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_status_mediaType", ["userId", "status", "mediaType"])
    .index("by_user_mediaType", ["userId", "mediaType"])
    .index("by_user_relation_root", ["userId", "relationRootAnilistId"])
    .index("by_user_show", ["userId", "showId"])
    .index("by_showId", ["showId"])
    .index("by_user_status_changed", ["userId", "statusChangedAt"])
    .index("by_status_last_watched", ["status", "lastWatchedAt"]),
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
    mediaType: v.union(v.literal("tv"), v.literal("anime")),
    episodes: v.string(),
    lastUpdated: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_type", ["date", "mediaType"])
    .index("by_type_date", ["mediaType", "date"]),
  // Pre-computed per-user per-show projections for Home/Upcoming feeds.
  // Eliminates the N+1 join of userShows → shows on every page load.
  // Updated incrementally by mutations and scheduled refresh jobs.
  feedProjections: defineTable({
    userId: v.id("users"),
    showId: v.id("shows"),
    userShowId: v.id("userShows"),

    // Denormalized show metadata
    title: v.string(),
    mediaType: v.union(v.literal("tv"), v.literal("anime"), v.literal("movie")),
    posterUrl: v.optional(v.string()),
    backdropUrl: v.optional(v.string()),
    tmdbId: v.optional(v.number()),
    anilistId: v.optional(v.number()),
    malId: v.optional(v.number()),
    tvmazeId: v.optional(v.number()),
    imdbId: v.optional(v.string()),
    firstAired: v.optional(v.string()),
    anilistFormat: v.optional(v.string()),
    animeSeason: v.optional(v.string()),
    animeSeasonYear: v.optional(v.number()),
    totalEpisodes: v.optional(v.number()),

    // Denormalized user tracking state
    status: v.union(
      v.literal("watching"),
      v.literal("paused"),
      v.literal("dropped"),
      v.literal("completed"),
      v.literal("plan_to_watch")
    ),
    isAutoTracked: v.optional(v.boolean()),
    relationRootAnilistId: v.optional(v.number()),
    watchedEpisodesCount: v.number(),
    remainingEpisodes: v.optional(v.number()),
    lastWatchedAt: v.number(),
    newEpisodeSignalAt: v.optional(v.number()),
    homeSortAt: v.optional(v.number()),
    autoPausedAt: v.optional(v.number()),
    scheduleProjectionKey: v.optional(v.string()),
    scheduleProjectionUpdatedAt: v.optional(v.number()),

    // Timestamps
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_media", ["userId", "mediaType"])
    .index("by_user_media_updatedAt", ["userId", "mediaType", "updatedAt"])
    .index("by_user_media_scheduleProjectionUpdatedAt", [
      "userId",
      "mediaType",
      "scheduleProjectionUpdatedAt",
    ])
    .index("by_user_media_status_lastWatched", ["userId", "mediaType", "status", "lastWatchedAt"])
    .index("by_user_media_status_homeSortAt", ["userId", "mediaType", "status", "homeSortAt"])
    .index("by_user_media_status_autoPausedAt", ["userId", "mediaType", "status", "autoPausedAt"])
    .index("by_user_show", ["userId", "showId"])
    .index("by_userShow", ["userShowId"]),

  userScheduleEvents: defineTable({
    userId: v.id("users"),
    showId: v.id("shows"),
    userShowId: v.id("userShows"),
    feedProjectionId: v.id("feedProjections"),
    date: v.string(),
    routeId: v.string(),
    mediaType: v.union(v.literal("tv"), v.literal("anime")),
    sourceMediaType: v.union(v.literal("tv"), v.literal("anime")),
    sourceProvider: v.optional(v.string()),
    showTitle: v.string(),
    posterUrl: v.optional(v.string()),
    tmdbId: v.optional(v.number()),
    anilistId: v.optional(v.number()),
    malId: v.optional(v.number()),
    tvmazeId: v.optional(v.number()),
    imdbId: v.optional(v.string()),
    seasonNumber: v.number(),
    episodeNumber: v.number(),
    episodeName: v.optional(v.string()),
    airDate: v.optional(v.string()),
    airtimeMs: v.number(),
    seriesDedupeKey: v.string(),
    episodeDedupeKey: v.string(),
    sameTrackedShowDayKey: v.string(),
    sourceMatchesTracked: v.boolean(),
    matchConfidence: v.union(
      v.literal("direct_id"),
      v.literal("bridged_id"),
      v.literal("verified_title"),
      v.literal("title_fallback")
    ),
    projectionUpdatedAt: v.number(),
    reconciledAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "date"])
    .index("by_user_media_date", ["userId", "mediaType", "date"])
    .index("by_user_route_date", ["userId", "routeId", "date"])
    .index("by_user_projection_date", ["userId", "feedProjectionId", "date"]),

  watchlistFutureCountProjections: defineTable({
    userId: v.id("users"),
    windowStartDate: v.string(),
    windowEndDate: v.string(),
    mediaFilter: v.union(v.literal("all"), v.literal("tv"), v.literal("anime")),
    routeId: v.string(),
    availableCount: v.number(),
    futureCount: v.number(),
    unavailableCount: v.number(),
    projectionUpdatedAt: v.number(),
    reconciledAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_window", ["userId", "windowStartDate", "windowEndDate"])
    .index("by_user_window_filter", [
      "userId",
      "windowStartDate",
      "windowEndDate",
      "mediaFilter",
    ])
    .index("by_user_window_filter_route", [
      "userId",
      "windowStartDate",
      "windowEndDate",
      "mediaFilter",
      "routeId",
    ]),

  userScheduleProjectionWindows: defineTable({
    userId: v.id("users"),
    scheduleStartDate: v.string(),
    scheduleEndDate: v.string(),
    countWindowStartDate: v.string(),
    countWindowEndDate: v.string(),
    runId: v.string(),
    generatedAt: v.number(),
    projectionUpdatedAt: v.number(),
    eventCount: v.number(),
    countRowCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_schedule_window", ["userId", "scheduleStartDate", "scheduleEndDate"])
    .index("by_user_count_window", ["userId", "countWindowStartDate", "countWindowEndDate"]),

  rateLimits: defineTable({
    key: v.string(),
    lastAttemptTime: v.number(),
    nextRetryTime: v.number(),
    retryCount: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  maintenanceState: defineTable({
    key: v.string(),
    cursor: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
