import { useMemo, useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toHttpsImageUrl } from "@/lib/image-url";

interface SearchShowsModalProps {
  visible: boolean;
  onClose: () => void;
  listId: string;
  existingShowIds: string[];
}

interface WatchlistShow {
  id: string;
  title: string;
  mediaType: "tv" | "anime" | "movie";
  posterUrl: string | null;
  status: string;
}

const ITEMS_PER_PAGE = 20;

function ShowItemRow({
  show,
  isAlreadyInList,
  isAdding,
  onPress,
}: {
  show: WatchlistShow;
  isAlreadyInList: boolean;
  isAdding: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={isAlreadyInList || isAdding}
      accessibilityRole="button"
      accessibilityLabel={
        isAlreadyInList
          ? `${show.title} already in list`
          : `Add ${show.title} to list`
      }
      className={`flex-row items-center gap-3 rounded-xl border p-3 mb-2 ${
        isAlreadyInList
          ? "border-success/30 bg-success/5"
          : "border-border-default bg-bg-base"
      }`}
      style={({ pressed }) => ({
        opacity: pressed || isAlreadyInList ? 0.7 : 1,
      })}
    >
      {/* Poster */}
      <View className="h-16 w-12 overflow-hidden rounded-lg bg-bg-elevated shrink-0">
        {show.posterUrl ? (
          <Image
            source={{ uri: toHttpsImageUrl(show.posterUrl) }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <View className="h-full w-full items-center justify-center">
            <Ionicons name="tv-outline" size={20} color="#52525b" />
          </View>
        )}
      </View>

      {/* Info */}
      <View className="flex-1 min-w-0">
        <Text
          className={`font-semibold ${
            isAlreadyInList ? "text-success" : "text-text-primary"
          }`}
          numberOfLines={1}
        >
          {show.title}
        </Text>
        <Text className="mt-0.5 text-xs text-text-secondary">
          {show.mediaType === "tv" ? "TV Show" : show.mediaType === "anime" ? "Anime" : "Movie"}
          {" · "}
          {show.status.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
        </Text>
      </View>

      {/* Status */}
      {isAdding ? (
        <ActivityIndicator size="small" color="#ef4444" />
      ) : isAlreadyInList ? (
        <View className="h-6 w-6 items-center justify-center rounded-full bg-success">
          <Ionicons name="checkmark" size={14} color="#fff" />
        </View>
      ) : (
        <Ionicons name="add-circle-outline" size={24} color="#a1a1aa" />
      )}
    </Pressable>
  );
}

export function SearchShowsModal({ visible, onClose, listId, existingShowIds }: SearchShowsModalProps) {
  const [query, setQuery] = useState("");
  const [addingShowId, setAddingShowId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const debouncedQuery = useDebouncedValue(query, 350);

  const watchlist = useQuery(api.shows.getUserWatchlistShows);
  const addToList = useMutation(api.lists.addShowToList);

  const existingShowIdsSet = useMemo(() => new Set(existingShowIds), [existingShowIds]);

  // Sort watchlist alphabetically and filter by search query
  const filteredShows = useMemo(() => {
    if (!watchlist) return [];
    
    // Sort alphabetically by title
    const sorted = [...watchlist].sort((a, b) => 
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );
    
    if (!debouncedQuery.trim()) return sorted;
    
    const normalizedQuery = debouncedQuery.toLowerCase().trim();
    return sorted.filter((show) =>
      show.title.toLowerCase().includes(normalizedQuery)
    );
  }, [watchlist, debouncedQuery]);

  // Paginated shows
  const paginatedShows = useMemo(() => {
    return filteredShows.slice(0, visibleCount);
  }, [filteredShows, visibleCount]);

  const hasMore = paginatedShows.length < filteredShows.length;

  const handleAddShow = useCallback(async (show: WatchlistShow) => {
    setAddError(null);
    setAddingShowId(show.id);

    try {
      await addToList({ listId: listId as any, showId: show.id as any });
    } catch (err) {
      console.error("Failed to add show to list:", err);
      setAddError("Failed to add show to list");
    } finally {
      setAddingShowId(null);
    }
  }, [listId, addToList]);

  const handleLoadMore = useCallback(() => {
    if (hasMore) {
      setVisibleCount((prev) => prev + ITEMS_PER_PAGE);
    }
  }, [hasMore]);

  const handleClose = () => {
    setQuery("");
    setVisibleCount(ITEMS_PER_PAGE);
    setAddError(null);
    onClose();
  };

  const isLoading = watchlist === undefined;

  const renderItem = useCallback(({ item }: { item: WatchlistShow }) => {
    const isAlreadyInList = existingShowIdsSet.has(item.id);
    const isAdding = addingShowId === item.id;

    return (
      <ShowItemRow
        show={item}
        isAlreadyInList={isAlreadyInList}
        isAdding={isAdding}
        onPress={() => handleAddShow(item)}
      />
    );
  }, [existingShowIdsSet, addingShowId, handleAddShow]);

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <Pressable
        onPress={handleLoadMore}
        className="items-center justify-center py-4"
      >
        <Text className="text-sm text-primary font-medium">
          Load more ({filteredShows.length - paginatedShows.length} remaining)
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View className="flex-1 items-center justify-center bg-black/70 px-5 py-8">
        <Pressable className="absolute inset-0" onPress={handleClose} />

        <View className="h-[80vh] w-full max-w-lg overflow-hidden rounded-3xl border border-border-bright bg-bg-surface">
          {/* Header */}
          <View className="border-b border-border-default px-4 pb-3 pt-4">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Add Shows
                </Text>
                <Text className="text-lg font-black text-text-primary">
                  From your watchlist
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                className="h-8 w-8 items-center justify-center rounded-full bg-bg-elevated"
              >
                <Ionicons name="close" size={16} color="#a1a1aa" />
              </Pressable>
            </View>

            {/* Search Input */}
            <View className="mt-4 flex-row items-center gap-2">
              <View className="flex-1 flex-row items-center rounded-xl border border-border-default bg-bg-base px-3">
                <Ionicons name="search" size={18} color="#71717a" />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search your watchlist..."
                  placeholderTextColor="#52525b"
                  className="flex-1 px-3 py-2.5 text-text-primary"
                  autoFocus
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery("")}>
                    <Ionicons name="close-circle" size={18} color="#71717a" />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Status label */}
            {!isLoading && (
              <View className="mt-2">
                <Text className="text-sm text-text-secondary">
                  {debouncedQuery.trim() 
                    ? `${filteredShows.length} result${filteredShows.length === 1 ? "" : "s"}`
                    : `${filteredShows.length} shows in watchlist (A-Z)`}
                </Text>
              </View>
            )}

            {addError && (
              <View className="mt-2 rounded-xl bg-primary/10 p-3">
                <Text className="text-sm text-primary">{addError}</Text>
              </View>
            )}
          </View>

          {/* Results */}
          <View className="flex-1">
            {isLoading ? (
              <View className="flex-1 items-center justify-center px-6">
                <ActivityIndicator size="large" color="#ef4444" />
                <Text className="mt-3 text-sm text-text-secondary">Loading your watchlist...</Text>
              </View>
            ) : watchlist?.length === 0 ? (
              <View className="flex-1 items-center justify-center px-6">
                <Text className="text-4xl mb-3">📺</Text>
                <Text className="text-base font-semibold text-text-primary">Your watchlist is empty</Text>
                <Text className="mt-1 text-sm text-text-secondary text-center">
                  Add shows to your watchlist first, then you can add them to lists
                </Text>
              </View>
            ) : filteredShows.length === 0 ? (
              <View className="flex-1 items-center justify-center px-6">
                <Text className="text-4xl mb-3">😕</Text>
                <Text className="text-base font-semibold text-text-primary">No matches found</Text>
                <Text className="mt-1 text-sm text-text-secondary text-center">
                  Try different keywords
                </Text>
              </View>
            ) : (
              <FlatList
                data={paginatedShows}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                ListFooterComponent={renderFooter}
                contentContainerStyle={{ padding: 16 }}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>

          {/* Footer */}
          <View className="border-t border-border-default p-4">
            <Pressable
              onPress={handleClose}
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
