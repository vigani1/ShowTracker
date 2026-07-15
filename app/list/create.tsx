import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppBackButton } from "@/components/AppBackButton";
import { PageIntro } from "@/components/PageIntro";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { BrandLoader } from "@/components/BrandLoader";

export default function CreateListScreen() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createList = useMutation(api.lists.createList);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("List name is required");
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      const result = await createList({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      
      // Navigate to the new list
      router.replace(`/list/${result.listId}`);
    } catch (err) {
      console.error("Failed to create list:", err);
      setError("Failed to create list. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <ScreenWrapper>
      <ScrollView className="flex-1">
        <View className="gap-3">
          <PageIntro
            title="Create List"
            subtitle="Organize your shows into a custom collection"
            eyebrow="Collection"
            icon="list-outline"
            className="mb-3"
            leftSlot={<AppBackButton fallbackHref="/profile" />}
          />

          <View className="rounded-2xl border border-border-default bg-bg-surface p-4">

            {/* Name Input */}
            <View className="mb-4">
              <Text className="mb-2 text-sm font-semibold text-text-primary">
                List name *
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g., Favorite Anime"
                placeholderTextColor="#71717a"
                className="rounded-xl border border-border-default bg-bg-base px-4 py-3 text-text-primary"
                maxLength={100}
                autoFocus
              />
            </View>

            {/* Description Input */}
            <View className="mb-6">
              <Text className="mb-2 text-sm font-semibold text-text-primary">
                Description (optional)
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Add a description..."
                placeholderTextColor="#71717a"
                className="min-h-[100px] rounded-xl border border-border-default bg-bg-base px-4 py-3 text-text-primary"
                multiline
                numberOfLines={4}
                maxLength={500}
                textAlignVertical="top"
              />
            </View>

            {/* Error */}
            {error && (
              <Text className="mb-4 text-sm text-primary">{error}</Text>
            )}

            {/* Create Button */}
            <Pressable
              onPress={handleCreate}
              disabled={isCreating || !name.trim()}
              className={`w-full items-center justify-center rounded-xl bg-primary px-5 py-3 ${isCreating || !name.trim() ? "opacity-50" : ""}`}
            >
              {isCreating ? (
                <BrandLoader compact onPrimary />
              ) : (
                <Text className="font-semibold text-white">Create list</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}
