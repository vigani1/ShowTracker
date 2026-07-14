import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import Papa from "papaparse";
import {
  TV_TIME_GDPR_FILES,
  parseTvTimeGdprArchive,
  parseTvTimeGdprFiles,
} from "./tv-time-gdpr";

const trackingV2 = Papa.unparse([
  {
    gsi: "",
    created_at: "2024-01-02 03:04:05",
    s_id: "81189",
    runtime: "47",
    ep_no: "",
    key: "",
    s_no: "",
    user_id: "user",
    ep_id: "1001",
    bulk_type: "",
    ep_watch_count: "",
    series_follow_count: "",
    updated_at: "2024-01-02 03:04:05",
    total_series_runtime: "",
    movie_watch_count: "",
    total_movies_runtime: "",
    is_archived: "",
    is_for_later: "",
    most_recent_ep_watched: "",
    uuid: "",
    is_followed: "",
    followed_at: "",
    is_unitary: "false",
    rewatch_count: "0",
    is_special: "",
    movie_name: "",
    series_name: "Example Show",
    season_number: "1",
    episode_number: "1",
  },
  {
    created_at: "2024-03-04 05:06:07",
    s_id: "81189",
    user_id: "user",
    ep_id: "1002",
    updated_at: "2024-03-04 05:06:07",
    is_unitary: "false",
    rewatch_count: "0",
    series_name: "Example Show",
    season_number: "0",
    episode_number: "1",
  },
  {
    created_at: "2024-02-03 04:05:06",
    s_id: "81189",
    user_id: "user",
    ep_id: "1001",
    updated_at: "2024-02-03 04:05:06",
    is_unitary: "false",
    rewatch_count: "1",
    series_name: "Example Show",
    season_number: "1",
    episode_number: "1",
  },
  {
    created_at: "2024-02-03 04:05:06",
    s_id: "81189",
    user_id: "user",
    ep_watch_count: "1",
    updated_at: "2024-02-03 04:05:06",
    is_archived: "false",
    is_for_later: "true",
    is_followed: "true",
    followed_at: "1700000000000000",
    series_name: "Example Show",
  },
]);

const trackingLegacy = Papa.unparse([
  {
    type: "watch",
    series_id: "",
    uuid: "movie-1",
    "type-uuid-n": "",
    created_at: "2023-06-01 12:00:00",
    updated_at: "2023-06-01 12:00:00",
    user_id: "user",
    watch_count: "",
    watches: "",
    alpha_range_key: "",
    release_date: "2020-01-01 00:00:00",
    runtime: "120",
    release_date_range_key: "",
    entity_type: "movie",
    follow_date_range_key: "",
    rewatch_count: "",
    episode_number: "",
    season_number: "",
    series_uuid: "",
    episode_id: "",
    watch_date: "",
    watched_episode_range_key: "",
    total_series_runtime: "",
    total_movies_runtime: "",
    country: "",
    unitarian: "true",
    watch_date_range_key: "",
    bulk_type: "",
    movie_name: "Example Movie",
    series_name: "",
  },
]);

const followedShows = `folder_id,archived,user_id,tv_show_id,updated_at,diffusion,tv_show_name,created_at,active,notification_type,notification_offset
,false,user,81189,2024-01-01 00:00:00,,Example Show,2020-01-01 00:00:00,true,,
`;

const userShowData = `nb_episodes_seen,tv_show_name,user_id,tv_show_id,is_followed,is_favorited
1,Example Show,user,81189,true,true
`;

const rewatches = `episode_id,cpt,created_at,updated_at,tv_show_name,episode_season_number,episode_number,user_id
1001,1,2024-02-03 04:05:06,2024-02-03 04:05:06,Example Show,1,1,user
`;

const statuses = `tv_show_id,status,created_at,updated_at,tv_show_name,user_id
81189,favorite,2024-01-01 00:00:00,2024-01-01 00:00:00,Example Show,user
`;

function fixtureFiles() {
  return {
    [TV_TIME_GDPR_FILES.trackingV2]: trackingV2,
    [TV_TIME_GDPR_FILES.trackingLegacy]: trackingLegacy,
    [TV_TIME_GDPR_FILES.followedShows]: followedShows,
    [TV_TIME_GDPR_FILES.userShowData]: userShowData,
    [TV_TIME_GDPR_FILES.rewatches]: rewatches,
    [TV_TIME_GDPR_FILES.specialStatuses]: statuses,
  };
}

test("converts official tracking rows into ShowTracker history", () => {
  const result = parseTvTimeGdprFiles(fixtureFiles());
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.tv, 1);
  assert.equal(result.summary.movie, 1);
  assert.equal(result.summary.episodes, 3);
  assert.equal(result.summary.rewatches, 1);
  assert.equal(result.summary.favorites, 1);

  const show = result.items.find((item) => item.mediaType === "tv");
  assert.ok(show);
  assert.equal(show.tvdbId, 81189);
  assert.equal(show.status, "watching");
  assert.equal(show.favorite, true);
  const regularEpisode = show.watchedEpisodes.find(
    (episode) => episode.season === 1 && episode.episode === 1
  );
  assert.ok(regularEpisode);
  assert.equal(regularEpisode.watchCount, 2);
  assert.deepEqual(regularEpisode.watchHistory, [
    Date.parse("2024-01-02T03:04:05Z"),
    Date.parse("2024-02-03T04:05:06Z"),
  ]);
  assert.equal(show.watchedEpisodes[0].season, 0);

  const movie = result.items.find((item) => item.mediaType === "movie");
  assert.ok(movie);
  assert.equal(movie.status, "completed");
  assert.equal(movie.firstAiredYear, 2020);
  assert.equal(movie.watchedEpisodes[0].watchedAt, Date.parse("2023-06-01T12:00:00Z"));
});

test("opens a ZIP locally and ignores sensitive files", async () => {
  const zip = new JSZip();
  for (const [name, source] of Object.entries(fixtureFiles())) {
    zip.file(`gdpr-data/${name}`, source);
  }
  zip.file("gdpr-data/access_token.csv", "token\nsecret-value\n");
  zip.file("gdpr-data/ip_address.csv", "ip\n127.0.0.1\n");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });

  const result = await parseTvTimeGdprArchive(bytes);
  assert.equal(result.summary.ignoredFileCount, 2);
  assert.equal(result.summary.filesRead.length, 6);
  assert.equal(result.summary.total, 2);
});

test("rejects archives without the official v2 tracking file", async () => {
  const zip = new JSZip();
  zip.file("gdpr-data/access_token.csv", "token\nsecret-value\n");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });

  await assert.rejects(
    () => parseTvTimeGdprArchive(bytes),
    /tracking-prod-records-v2\.csv/
  );
});

test("rejects changed required CSV headers before importing", () => {
  assert.throws(
    () =>
      parseTvTimeGdprFiles({
        [TV_TIME_GDPR_FILES.trackingV2]: "series_name,season_number\nExample,1\n",
      }),
    /missing required columns/
  );
});
