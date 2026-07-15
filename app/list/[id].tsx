import { useMemo, useState, useCallback } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, router } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton } from "@/components/AppBackButton";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { BrandLoader } from "@/components/BrandLoader";
import { SearchShowsModal } from "@/components/SearchShowsModal";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { toHttpsImageUrl } from "@/lib/image-url";
import type { MediaType, NormalizedShow } from "@/lib/api/types";

type ShowItem = {
  id: any;
  externalId: string;
  title: string;
  mediaType: MediaType;
  posterUrl?: string;
  backdropUrl?: string;
  overview?: string;
  rating?: number;
};

type ConfirmActionState =
  | { type: "delete-list" }
  | { type: "remove-show"; showId: string };

function ListShowCard({
  show,
  isEditing,
  onMoveUp,
  onMoveDown,
  onRemove,
  index,
  totalCount,
}: {
  show: ShowItem;
  isEditing: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  index: number;
  totalCount: number;
}) {
  if (isEditing) {
    return (
      <View className="flex-row items-center gap-3 rounded-xl border-2 border-border-default bg-bg-surface p-3">
        {/* Poster */}
        <View className="h-20 w-14 overflow-hidden rounded-lg bg-bg-elevated shrink-0">
          {show.posterUrl ? (
            <Image
              source={{ uri: toHttpsImageUrl(show.posterUrl) }}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-bg-elevated">
              <Ionicons name="tv-outline" size={24} color="#52525b" />
            </View>
          )}
        </View>

        {/* Info */}
        <View className="flex-1 min-w-0">
          <Text className="text-base font-semibold text-text-primary" numberOfLines={1}>
            {show.title}
          </Text>
          <Text className="text-sm text-text-secondary mt-0.5">
            {show.mediaType === "tv" ? "TV Show" : show.mediaType === "anime" ? "Anime" : "Movie"}
          </Text>
        </View>

        {/* Actions */}
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={onMoveUp}
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityLabel="Move show up"
            className={`rounded-lg p-2.5 ${index === 0 ? 'opacity-30' : 'bg-bg-elevated active:bg-bg-base'}`}
          >
            <Ionicons name="arrow-up" size={20} color="#a1a1aa" />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={index === totalCount - 1}
            accessibilityRole="button"
            accessibilityLabel="Move show down"
            className={`rounded-lg p-2.5 ${index === totalCount - 1 ? 'opacity-30' : 'bg-bg-elevated active:bg-bg-base'}`}
          >
            <Ionicons name="arrow-down" size={20} color="#a1a1aa" />
          </Pressable>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove show from list"
            className="rounded-lg bg-primary/10 p-2.5 active:bg-primary/20"
          >
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push(`/show/${encodeURIComponent(show.externalId)}`)}
      className="overflow-hidden rounded-xl bg-bg-surface"
    >
      <View style={{ width: 180 }}>
        <View
          className="relative overflow-hidden rounded-xl bg-bg-elevated"
          style={{ width: 180, height: 270 }}
        >
          {show.posterUrl ? (
            <Image
              source={{ uri: toHttpsImageUrl(show.posterUrl) }}
              style={{ width: 180, height: 270 }}
              resizeMode="cover"
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-bg-elevated">
              <Text className="text-xs text-text-secondary">No Image</Text>
            </View>
          )}

          {/* Rating badge */}
          {show.rating && (
            <View className="absolute right-2 top-2 rounded-full bg-bg-base/95 px-2 py-1">
              <Text className="text-xs font-bold text-primary">
                {show.rating.toFixed(1)}
              </Text>
            </View>
          )}
        </View>

        <View className="pt-2">
          <Text className="text-sm font-semibold text-text-primary" numberOfLines={2}>
            {show.title}
          </Text>
          <Text className="mt-1 text-xs text-text-secondary">
            {show.mediaType === "tv" ? "TV Show" : show.mediaType === "anime" ? "Anime" : "Movie"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// Edit mode header component
function EditModeHeader({
  editedName,
  setEditedName,
  editedDescription,
  setEditedDescription,
  isSaving,
  onSave,
  onCancel,
}: {
  editedName: string;
  setEditedName: (name: string) => void;
  editedDescription: string;
  setEditedDescription: (desc: string) => void;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View className="gap-4">
      <PageIntro
        title="Edit List"
        subtitle="Update your list details"
        eyebrow="Editing"
        icon="create-outline"
      />
      <View>
        <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
          List Name
        </Text>
        <TextInput
          value={editedName}
          onChangeText={setEditedName}
          className="text-lg font-semibold text-text-primary bg-bg-base border border-border-default rounded-xl px-4 py-3"
          placeholder="Enter list name"
          placeholderTextColor="#71717a"
        />
      </View>
      <View>
        <Text className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
          Description
        </Text>
        <TextInput
          value={editedDescription}
          onChangeText={setEditedDescription}
          className="text-sm text-text-primary bg-bg-base border border-border-default rounded-xl px-4 py-3 min-h-[80px]"
          placeholder="Add a description (optional)"
          placeholderTextColor="#71717a"
          multiline
          textAlignVertical="top"
        />
      </View>
      <View className="flex-row gap-3 pt-2">
        <Pressable
          onPress={onSave}
          disabled={isSaving}
          className="flex-1 items-center justify-center rounded-xl bg-primary py-3.5 active:bg-primary/90"
        >
          {isSaving ? (
            <BrandLoader compact onPrimary />
          ) : (
            <Text className="font-semibold text-white">Save Changes</Text>
          )}
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={isSaving}
          className="flex-1 items-center justify-center rounded-xl border border-border-default bg-bg-surface py-3.5 active:bg-bg-elevated"
        >
          <Text className="font-semibold text-text-primary">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listId = id ? (Array.isArray(id) ? id[0] : id) : undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localShows, setLocalShows] = useState<ShowItem[]>([]);
  const [gridWidth, setGridWidth] = useState(0);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);
  const [confirmActionState, setConfirmActionState] = useState<ConfirmActionState | null>(
    null
  );
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
  const { width: windowWidth } = useWindowDimensions();

  const list = useQuery(api.lists.getListDetail, listId ? { listId } : "skip");
  const updateList = useMutation(api.lists.updateList);
  const deleteList = useMutation(api.lists.deleteList);
  const reorderItems = useMutation(api.lists.reorderListItems);
  const removeShow = useMutation(api.lists.removeShowFromList);

  const goBackToPreviousPage = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/profile");
  }, []);

  // Grid calculations
  const isDesktop = windowWidth >= 768;
  const containerPadding = isDesktop ? 24 : 0;
  const GRID_GAP = 12;

  const columns = useMemo(() => {
    if (gridWidth === 0) return isDesktop ? 5 : 3;
    const minCardWidth = isDesktop ? 160 : 110;
    return Math.max(2, Math.floor(gridWidth / minCardWidth));
  }, [gridWidth, isDesktop]);

  const posterWidth = useMemo(() => {
    if (gridWidth === 0) return isDesktop ? 180 : 110;
    const availableWidth = gridWidth - (columns - 1) * GRID_GAP;
    return Math.floor(availableWidth / columns);
  }, [gridWidth, columns, isDesktop]);

  // Initialize local state when entering edit mode
  const startEditing = () => {
    if (list) {
      setEditedName(list.name);
      setEditedDescription(list.description || "");
      setLocalShows((list.shows.filter(Boolean) as unknown) as ShowItem[]);
      setIsEditing(true);
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setLocalShows([]);
  };

  const saveChanges = async () => {
    if (!list) return;
    
    setIsSaving(true);
    try {
      if (!listId) return;

      // Update name/description if changed
      if (editedName !== list.name || editedDescription !== (list.description || "")) {
        await updateList({
          listId,
          name: editedName,
          description: editedDescription || undefined,
        });
      }

      // Update order if changed
      const newOrderIds = localShows.map((s) => s.id);
      const originalOrderIds = list.shows.filter(Boolean).map((s) => s!.id);
      const orderChanged = JSON.stringify(newOrderIds) !== JSON.stringify(originalOrderIds);
      
      if (orderChanged) {
        await reorderItems({
          listId,
          showIds: newOrderIds as any,
        });
      }

      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save changes:", err);
      Alert.alert("Error", "Failed to save changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setLocalShows((prev) => {
      const newShows = [...prev];
      [newShows[index], newShows[index - 1]] = [newShows[index - 1], newShows[index]];
      return newShows;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setLocalShows((prev) => {
      if (index >= prev.length - 1) return prev;
      const newShows = [...prev];
      [newShows[index], newShows[index + 1]] = [newShows[index + 1], newShows[index]];
      return newShows;
    });
  }, []);

  const handleRemove = (showId: string) => {
    setConfirmActionState({ type: "remove-show", showId });
  };

  const handleDeleteList = () => {
    setConfirmActionState({ type: "delete-list" });
  };

  const handleConfirmAction = async () => {
    if (!confirmActionState || !listId || isConfirmingAction) {
      return;
    }

    setIsConfirmingAction(true);
    try {
      if (confirmActionState.type === "remove-show") {
        await removeShow({ listId, showId: confirmActionState.showId as any });
        setLocalShows((prev) => prev.filter((s) => s.id !== confirmActionState.showId));
      } else {
        await deleteList({ listId });
        goBackToPreviousPage();
      }

      setConfirmActionState(null);
    } catch (err) {
      if (confirmActionState.type === "remove-show") {
        console.error("Failed to remove show:", err);
        Alert.alert("Error", "Failed to remove show. Please try again.");
      } else {
        console.error("Failed to delete list:", err);
        Alert.alert("Error", "Failed to delete list. Please try again.");
      }
    } finally {
      setIsConfirmingAction(false);
    }
  };

  const confirmTitle =
    confirmActionState?.type === "delete-list" ? "Delete List?" : "Remove Show?";
  const confirmMessage =
    confirmActionState?.type === "delete-list"
      ? `Are you sure you want to delete "${list?.name}"? This action cannot be undone.`
      : "Are you sure you want to remove this show from the list?";
  const confirmButtonLabel =
    confirmActionState?.type === "delete-list" ? "Delete" : "Remove";

  const shows = list && list.shows ? (isEditing ? localShows : (list.shows.filter(Boolean) as ShowItem[])) : [];

  const renderHeader = () => {
    if (!list) return null;
    return (
      <View className="gap-3">
        {isEditing ? (
          // Edit Mode Header
          <EditModeHeader
            editedName={editedName}
            setEditedName={setEditedName}
            editedDescription={editedDescription}
            setEditedDescription={setEditedDescription}
            isSaving={isSaving}
            onSave={saveChanges}
            onCancel={cancelEditing}
          />
        ) : (
          // View Mode Header
          <>
            <PageIntro
              title={list.name}
              subtitle={list.description || "Custom list for your tracked titles"}
              eyebrow="Custom list"
              icon="bookmark-outline"
              rightLabel={`${list.shows.length} ${list.shows.length === 1 ? "show" : "shows"}`}
              leftSlot={<AppBackButton fallbackHref="/profile" />}
            />
            <View className="-mt-1 mb-1 flex-row justify-end gap-2">
              <Pressable
                onPress={() => setIsSearchModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Add shows to list"
                className="flex-row items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-3 py-2"
              >
                <Ionicons name="add" size={20} color="#a1a1aa" />
                <Text className="text-sm font-medium text-text-primary">Add Shows</Text>
              </Pressable>
              <Pressable
                onPress={startEditing}
                accessibilityRole="button"
                accessibilityLabel="Edit list"
                className="rounded-xl border border-border-default bg-bg-surface p-3"
              >
                <Ionicons name="create-outline" size={20} color="#a1a1aa" />
              </Pressable>
              <Pressable
                onPress={() => {
                  handleDeleteList();
                }}
                accessibilityRole="button"
                accessibilityLabel="Delete list"
                className="rounded-xl border border-border-default bg-bg-surface p-3"
              >
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </Pressable>
            </View>
            <Text className="text-sm text-text-secondary">
              Reorder from edit mode to curate this list.
            </Text>
          </>
        )}

        {/* Grid width measurement wrapper */}
        <View
          className="mt-6"
          onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
        />
      </View>
    );
  };

  const renderEmptyList = () => {
    return (
      <View className="items-center rounded-2xl border border-border-default bg-bg-surface px-6 py-12">
        <Text className="mb-2 text-4xl">📝</Text>
        <Text className="text-lg font-semibold text-text-primary">
          Empty list
        </Text>
        <Text className="mt-1 max-w-xs text-center text-sm text-text-secondary">
          This list is empty. Add shows from their detail pages.
        </Text>
      </View>
    );
  };

  if (list === undefined) {
    return (
      <ScreenWrapper>
        <View className="flex-1 items-center justify-center">
          <BrandLoader />
        </View>
      </ScreenWrapper>
    );
  }

  if (list === null) {
    return (
      <ScreenWrapper>
        <View className="flex-1 items-center justify-center">
          <Text className="text-lg text-text-secondary">List not found</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      {isEditing ? (
        // Edit Mode - List view with reorder controls
        <FlashList
          data={shows}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmptyList}
          renderItem={({ item, index }) => (
            <ListShowCard
              show={item as ShowItem}
              isEditing={true}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onRemove={() => handleRemove(item.id)}
              index={index}
              totalCount={shows.length}
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: containerPadding,
            paddingBottom: containerPadding,
          }}
        />
      ) : (
        // View Mode - Grid
        <FlashList
          data={shows}
          key={columns}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmptyList}
          renderItem={({ item }) => {
            const show: NormalizedShow = {
              id: item.externalId,
              tmdbId: item.externalId.startsWith("tmdb:")
                ? Number(item.externalId.split(":")[2])
                : undefined,
              anilistId: item.externalId.startsWith("anilist:")
                ? Number(item.externalId.split(":")[2])
                : undefined,
              title: item.title,
              mediaType: item.mediaType,
              posterUrl: item.posterUrl,
              backdropUrl: item.backdropUrl,
              overview: item.overview,
              rating: item.rating,
            };
            return (
              <View
                style={{
                  width: posterWidth,
                  marginRight: GRID_GAP,
                  marginBottom: GRID_GAP,
                }}
              >
                <MediaPosterCard
                  show={show}
                  href={{ pathname: "/show/[id]", params: { id: item.externalId } }}
                  className="w-full"
                  posterClassName={isDesktop ? "h-56" : "h-48"}
                />
              </View>
            );
          }}
          contentContainerStyle={{
            paddingHorizontal: containerPadding,
            paddingBottom: containerPadding,
          }}
        />
      )}

      <Modal
        visible={!!confirmActionState}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isConfirmingAction) {
            setConfirmActionState(null);
          }
        }}
      >
        <View className="flex-1 items-center justify-center bg-black/70 px-5">
          <Pressable
            className="absolute inset-0"
            disabled={isConfirmingAction}
            onPress={() => {
              if (!isConfirmingAction) {
                setConfirmActionState(null);
              }
            }}
          />

          <View
            className={`w-full overflow-hidden rounded-xl border-2 border-border-bright bg-bg-surface ${
              isDesktop ? "max-w-md" : ""
            }`}
          >
            <View className="items-center px-6 py-8">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Ionicons name="trash-outline" size={32} color="#ef4444" />
              </View>

              <Text className="text-xl font-black text-text-primary">{confirmTitle}</Text>
              <Text className="mt-2 text-center text-sm text-text-secondary">{confirmMessage}</Text>

              <View className="mt-6 w-full flex-row gap-3">
                <Pressable
                  onPress={() => setConfirmActionState(null)}
                  disabled={isConfirmingAction}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel destructive action"
                  className="flex-1 items-center justify-center rounded-lg border-2 border-border-default bg-bg-elevated py-3.5"
                >
                  <Text className="text-sm font-bold text-text-primary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void handleConfirmAction();
                  }}
                  disabled={isConfirmingAction}
                  accessibilityRole="button"
                  accessibilityLabel={
                    confirmActionState?.type === "delete-list"
                      ? "Confirm delete list"
                      : "Confirm remove show"
                  }
                  className={`flex-1 items-center justify-center rounded-lg border-2 border-primary bg-primary py-3.5 ${
                    isConfirmingAction ? "opacity-60" : "opacity-100"
                  }`}
                >
                  {isConfirmingAction ? (
                    <BrandLoader compact onPrimary />
                  ) : (
                    <Text className="text-sm font-black uppercase tracking-wide text-white">
                      {confirmButtonLabel}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Search Shows Modal */}
      {listId && (
        <SearchShowsModal
          visible={isSearchModalVisible}
          onClose={() => setIsSearchModalVisible(false)}
          listId={listId}
          existingShowIds={shows.map((s) => s.id)}
        />
      )}
    </ScreenWrapper>
  );
}

export default ListDetailScreen;
