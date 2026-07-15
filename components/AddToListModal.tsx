import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Ionicons } from "@expo/vector-icons";
import { BrandLoader } from "@/components/BrandLoader";
import type { NormalizedShow } from "@/lib/api/types";

interface AddToListModalProps {
  visible: boolean;
  onClose: () => void;
  show: NormalizedShow | null;
}

export function AddToListModal({ visible, onClose, show }: AddToListModalProps) {
  const [isAdding, setIsAdding] = useState<Id<"customLists"> | null>(null);
  const [isRemoving, setIsRemoving] = useState<Id<"customLists"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userLists = useQuery(api.lists.getUserLists);
  const showConvexId = useQuery(
    api.shows.getShowIdByExternal,
    show
      ? {
          tmdbId: show.tmdbId,
          anilistId: show.anilistId,
          malId: show.malId,
          tvmazeId: show.tvmazeId,
        }
      : "skip"
  );
  const showLists = useQuery(
    api.lists.getShowLists,
    showConvexId ? { showId: showConvexId } : "skip"
  );

  const upsertShow = useMutation(api.shows.upsertShow);
  const addToList = useMutation(api.lists.addShowToList);
  const removeFromList = useMutation(api.lists.removeShowFromList);

  const listsContainingShow = new Set<Id<"customLists">>(showLists?.map((l) => l.id) ?? []);

  const handleToggleList = async (listId: Id<"customLists">) => {
    if (!show) return;

    setError(null);
    const isInList = listsContainingShow.has(listId);

    try {
      if (isInList) {
        if (!showConvexId) {
          setError("Show is not in your lists yet.");
          return;
        }
        setIsRemoving(listId);
        await removeFromList({ listId, showId: showConvexId });
      } else {
        setIsAdding(listId);
        // First ensure show exists in database
        const showPayload = {
          tmdbId: show.tmdbId,
          anilistId: show.anilistId,
          malId: show.malId,
          tvmazeId: show.tvmazeId,
          imdbId: show.imdbId,
          mediaType: show.mediaType,
          title: show.title,
          overview: show.overview,
          posterUrl: show.posterUrl,
          backdropUrl: show.backdropUrl,
          genres: show.genres,
          status: show.status,
          totalEpisodes: show.totalEpisodes,
          totalSeasons: show.totalSeasons,
          episodeRuntime: show.episodeRuntime,
          rating: show.rating,
          firstAired: show.firstAired,
          anilistFormat: show.anilistFormat,
          animeSeason: show.animeSeason,
          animeSeasonYear: show.animeSeasonYear,
          rootAnilistId: show.rootAnilistId,
          relatedAnilistIds: show.relatedAnilistIds,
          lastRelationSyncAt: show.lastRelationSyncAt,
          lastUpdated: Date.now(),
        };
        const showId = await upsertShow(showPayload);
        await addToList({ listId, showId });
      }
    } catch (err) {
      console.error("Failed to toggle list membership:", err);
      setError(isInList ? "Failed to remove from list" : "Failed to add to list");
    } finally {
      setIsAdding(null);
      setIsRemoving(null);
    }
  };

  const isLoading = userLists === undefined || showConvexId === undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
        <Pressable className="absolute inset-0" onPress={onClose} />

        <View className="w-full max-w-md overflow-hidden rounded-3xl border border-border-bright bg-bg-surface">
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-border-default px-4 pb-3 pt-4">
            <View>
              <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Add to List
              </Text>
              <Text className="text-lg font-black text-text-primary" numberOfLines={1}>
                {show?.title || "Select a list"}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              className="h-8 w-8 items-center justify-center rounded-full bg-bg-elevated"
            >
              <Ionicons name="close" size={16} color="#a1a1aa" />
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView
            className="max-h-[60vh]"
            showsVerticalScrollIndicator={false}
          >
            <View className="gap-2 p-4">
              {isLoading ? (
                <View className="items-center py-8">
                  <BrandLoader compact />
                  <Text className="mt-2 text-sm text-text-secondary">Loading your lists...</Text>
                </View>
              ) : userLists?.length === 0 ? (
                <View className="items-center py-8">
                  <Text className="text-4xl mb-2">📋</Text>
                  <Text className="text-sm font-medium text-text-primary">No lists yet</Text>
                  <Text className="text-xs text-text-secondary mt-1 text-center">
                    Create a list first to add shows to it
                  </Text>
                </View>
              ) : (
                userLists?.map((list) => {
                  const isInList = listsContainingShow.has(list.id);
                  const isProcessing = isAdding === list.id || isRemoving === list.id;

                  return (
                    <Pressable
                      key={list.id}
                      onPress={() => handleToggleList(list.id)}
                      disabled={isProcessing}
                      className={`flex-row items-center justify-between rounded-xl border p-4 ${
                        isInList
                          ? "border-success/50 bg-success/10"
                          : "border-border-default bg-bg-base"
                      }`}
                      style={({ pressed }) => ({
                        opacity: pressed || isProcessing ? 0.7 : 1,
                      })}
                    >
                      <View className="flex-1">
                        <Text
                          className={`font-semibold ${
                            isInList ? "text-success" : "text-text-primary"
                          }`}
                        >
                          {list.name}
                        </Text>
                        <Text className="text-xs text-text-secondary mt-0.5">
                          {list.itemCount} {list.itemCount === 1 ? "show" : "shows"}
                        </Text>
                      </View>

                      {isProcessing ? (
                        <BrandLoader micro />
                      ) : isInList ? (
                        <View className="h-6 w-6 items-center justify-center rounded-full bg-success">
                          <Ionicons name="checkmark" size={14} color="#fff" />
                        </View>
                      ) : (
                        <Ionicons name="add-circle-outline" size={24} color="#a1a1aa" />
                      )}
                    </Pressable>
                  );
                })
              )}

              {error && (
                <View className="mt-2 rounded-xl bg-primary/10 p-3">
                  <Text className="text-sm text-primary">{error}</Text>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Footer */}
          <View className="border-t border-border-default p-4">
            <Pressable
              onPress={onClose}
              className="items-center justify-center rounded-xl bg-bg-elevated py-3"
            >
              <Text className="font-semibold text-text-primary">Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
