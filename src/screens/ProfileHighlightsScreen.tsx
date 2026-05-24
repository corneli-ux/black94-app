import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';

interface Highlight {
  id: string;
  title: string;
  coverUrl: string;
  stories: string[];
  createdAt: any;
}

export default function ProfileHighlightsScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { userId } = (route.params as { userId: string }) || {};
  const { user } = useAppStore();

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);

  const isOwnProfile = user?.id === userId;

  const loadHighlights = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const snap = await firestore()
        .collection('users')
        .doc(userId)
        .collection('highlights')
        .orderBy('createdAt', 'desc')
        .get();

      const items: Highlight[] = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title || '',
          coverUrl: data.coverUrl || '',
          stories: data.stories || [],
          createdAt: data.createdAt,
        };
      });

      setHighlights(items);
    } catch (e: any) {
      console.error('[ProfileHighlights] Failed to load:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadHighlights();
  }, [loadHighlights]);

  const handleHighlightPress = (highlight: Highlight) => {
    if (highlight.stories.length > 0) {
      navigation.navigate('StoryViewer', {
        storyIds: highlight.stories,
        initialIndex: 0,
      });
    }
  };

  const handleCreateHighlight = () => {
    Alert.alert(
      'Create Highlight',
      'Select stories from your archive to create a new highlight. Coming soon!',
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Highlights</Text>
          {isOwnProfile ? (
            <TouchableOpacity onPress={handleCreateHighlight} hitSlop={8}>
              <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 22 }} />
          )}
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : highlights.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="images-outline" size={32} color={colors.textSecondary} />
          </View>
          <Text style={styles.emptyTitle}>No highlights yet</Text>
          <Text style={styles.emptySubtitle}>
            {isOwnProfile
              ? 'Save your best stories into highlights so others can revisit them anytime.'
              : 'This user hasn\'t created any highlights yet.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.highlightsScroll}
        >
          {highlights.map((highlight) => (
            <TouchableOpacity
              key={highlight.id}
              style={styles.highlightItem}
              onPress={() => handleHighlightPress(highlight)}
              activeOpacity={0.7}
            >
              <View style={styles.coverContainer}>
                {highlight.coverUrl ? (
                  <Image
                    source={{ uri: highlight.coverUrl }}
                    style={styles.coverImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.coverPlaceholder}>
                    <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                  </View>
                )}
                {/* Circular ring effect */}
                <View style={styles.coverRing} />
              </View>
              <Text style={styles.highlightTitle} numberOfLines={1}>
                {highlight.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}



const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  highlightsScroll: {
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20,
    alignItems: 'flex-start',
  },
  highlightItem: {
    alignItems: 'center', marginRight: 20, width: 80,
  },
  coverContainer: {
    width: 68, height: 68, borderRadius: 34,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
  },
  coverRing: {
    position: 'absolute', width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: colors.accent, opacity: 0.6,
  },
  coverImage: {
    width: 64, height: 64, borderRadius: 32,
  },
  coverPlaceholder: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  highlightTitle: {
    color: colors.textSecondary, fontSize: 12, fontWeight: '500',
    textAlign: 'center', maxWidth: 80,
  },
  emptyState: { alignItems: 'center', paddingTop: 100, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: {
    color: colors.textSecondary, fontSize: 14, textAlign: 'center',
    lineHeight: 22,
  },
});
