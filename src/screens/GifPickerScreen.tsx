import { colors } from '../theme/colors';
/**
 * GifPickerScreen.tsx — GIF picker using Tenor GIF API
 *
 * Search bar at top, 3-column grid of GIF thumbnails.
 * Shows trending GIFs by default. Tap to select and return URL via callback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

// ── Types ──────────────────────────────────────────────────────────────────

interface GifItem {
  id: string;
  thumbnailUrl: string;
  fullUrl: string;
}

// ── API ───────────────────────────────────────────────────────────────────

import Constants from 'expo-constants';

const TENOR_KEY = (Constants.expoConfig?.extra?.tenorApiKey as string) || '';
const PAGE_SIZE = 30;

async function fetchTrending(pos?: number): Promise<GifItem[]> {
  let url = `https://tenor.googleapis.com/v2/trending?key=${TENOR_KEY}&limit=${PAGE_SIZE}&media_filter=gif`;
  if (pos != null) url += `&pos=${pos}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tenor trending error: ${res.status}`);
  const json = await res.json();
  return (json.results ?? []).map((r: any) => ({
    id: r.id,
    thumbnailUrl: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url ?? '',
    fullUrl: r.media_formats?.gif?.url ?? '',
  }));
}

async function searchGifs(query: string, pos?: number): Promise<GifItem[]> {
  const encoded = encodeURIComponent(query);
  let url = `https://tenor.googleapis.com/v2/search?q=${encoded}&key=${TENOR_KEY}&limit=${PAGE_SIZE}&media_filter=gif`;
  if (pos != null) url += `&pos=${pos}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tenor search error: ${res.status}`);
  const json = await res.json();
  return (json.results ?? []).map((r: any) => ({
    id: r.id,
    thumbnailUrl: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url ?? '',
    fullUrl: r.media_formats?.gif?.url ?? '',
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const NUM_COLUMNS = 3;
const GAP = 2;
const GIF_SIZE = (SCREEN_WIDTH - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

// ── Component ─────────────────────────────────────────────────────────────

export default function GifPickerScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const onSelect = route.params?.onSelect as ((gifUrl: string) => void) | undefined;

  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPos, setNextPos] = useState<string | null>(null);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentQueryRef = useRef('');

  // Load trending on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchTrending()
      .then((items) => {
        if (!cancelled) {
          setGifs(items);
          setNextPos(null); // Tenor v2 doesn't always return simple pos for trending
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced search
  const handleSearch = useCallback((text: string) => {
    setQuery(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!text.trim()) {
      // Reset to trending
      searchTimeoutRef.current = setTimeout(async () => {
        setLoading(true);
        setError(null);
        currentQueryRef.current = '';
        try {
          const items = await fetchTrending();
          setGifs(items);
          setNextPos(null);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }, 300);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const q = text.trim();
      currentQueryRef.current = q;
      try {
        const items = await searchGifs(q);
        setGifs(items);
        setNextPos(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

  // Load more
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || loading) return;

    const q = currentQueryRef.current;
    if (!q && nextPos == null) return; // Trending pagination not supported without next pos

    setLoadingMore(true);
    try {
      const items = q ? await searchGifs(q, nextPos ? Number(nextPos) : undefined) : await fetchTrending(nextPos ? Number(nextPos) : undefined);
      setGifs((prev) => [...prev, ...items]);
    } catch {
      // Silently fail on load more
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, nextPos]);

  // Select a GIF
  const handleSelect = useCallback(
    (gifUrl: string) => {
      if (onSelect) {
        onSelect(gifUrl);
      } else {
        // Fallback: pass via route params so the previous screen can pick it up
        navigation.navigate('ChatRoom', { selectedGifUrl: gifUrl });
      }
    },
    [onSelect, navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: GifItem }) => (
      <TouchableOpacity
        activeOpacity={0.75}
        style={styles.gifCell}
        onPress={() => handleSelect(item.fullUrl)}>
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={styles.gifImage}
          resizeMode="cover"
        />
      </TouchableOpacity>
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback((item: GifItem) => item.id, []);

  const ListFooter = useCallback(() => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      );
    }
    return null;
  }, [loadingMore]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search GIFs..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleSearch}
            returnKeyType="search"
            autoCorrect={false}
            autoFocus={false}
          />
          {query.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => handleSearch('')}
              activeOpacity={0.6}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      ) : error ? (
        <View style={styles.centerLoader}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>Failed to load GIFs</Text>
          <Text style={styles.errorSubtext}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => handleSearch(query)}
            activeOpacity={0.7}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={gifs}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={NUM_COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="search" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {query.trim() ? `No GIFs found for "${query.trim()}"` : 'No trending GIFs available'}
              </Text>
            </View>
          }
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgInput,
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 38,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    padding: 0,
    height: 38,
  },
  clearBtn: {
    marginLeft: 6,
  },
  gridContent: {
    padding: GAP,
  },
  row: {
    gap: GAP,
  },
  gifCell: {
    width: GIF_SIZE,
    height: GIF_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
  },
  gifImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  errorSubtext: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 6,
    maxWidth: 260,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  retryBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
    maxWidth: 260,
  },
});
