import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { firestore } from '../lib/firebase';
import { colors } from '../theme/colors';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const { width: SCREEN_W } = Dimensions.get('window');
const GAP = 2;
const NUM_COLUMNS = 3;
const THUMB_SIZE = (SCREEN_W - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

interface MediaItem {
  id: string;
  mediaUrl: string;
  isVideo: boolean;
  senderId: string;
  createdAt: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function detectIsVideo(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('.mp4') ||
    lower.includes('.mov') ||
    lower.includes('.avi') ||
    lower.includes('.webm') ||
    lower.includes('.mkv')
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FULLSCREEN IMAGE VIEWER
   ═══════════════════════════════════════════════════════════════════════════ */

function FullScreenViewer({
  uri,
  onClose,
}: {
  uri: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fullscreenBg}>
        {/* Close button */}
        <TouchableOpacity
          style={styles.fullscreenClose}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={28} color={colors.white} />
        </TouchableOpacity>

        <Image
          source={{ uri }}
          style={styles.fullscreenImage}
          resizeMode="contain"
        />
      </View>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */

export default function MediaGalleryScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { chatId } = (route.params as { chatId: string }) || {};

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    if (!chatId) {
      setLoading(false);
      return;
    }

    try {
      // Fetch messages from the chat subcollection, ordered by createdAt desc
      // so newest media appears first in the gallery.
      const snap = await firestore()
        .collection('chats')
        .doc(chatId)
        .collection('messages')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();

      // Client-side filter: only messages with a mediaUrl field.
      // Also check mediaUrls (array) for posts shared in chat.
      const items: MediaItem[] = [];

      for (const doc of snap.docs) {
        const data = doc.data();

        // Single mediaUrl field
        if (data.mediaUrl && typeof data.mediaUrl === 'string') {
          items.push({
            id: doc.id,
            mediaUrl: data.mediaUrl,
            isVideo: detectIsVideo(data.mediaUrl),
            senderId: data.senderId || '',
            createdAt: (() => {
              try {
                if (typeof data.createdAt === 'number') return data.createdAt;
                if (typeof data.createdAt === 'string')
                  return new Date(data.createdAt).getTime();
                if (data.createdAt?.__fs_type === 'timestamp' && typeof data.createdAt.value === 'string')
                  return new Date(data.createdAt.value).getTime();
                if (data.createdAt?.seconds)
                  return data.createdAt.seconds * 1000;
                if (data.createdAt?.toMillis)
                  return data.createdAt.toMillis();
                return Date.now();
              } catch {
                return Date.now();
              }
            })(),
          });
        }

        // Array of mediaUrls (e.g., shared posts)
        if (Array.isArray(data.mediaUrls)) {
          for (const url of data.mediaUrls) {
            if (typeof url === 'string' && url.trim()) {
              items.push({
                id: `${doc.id}_${items.length}`,
                mediaUrl: url,
                isVideo: detectIsVideo(url),
                senderId: data.senderId || '',
                createdAt: (() => {
                  try {
                    if (typeof data.createdAt === 'number') return data.createdAt;
                    if (typeof data.createdAt === 'string')
                      return new Date(data.createdAt).getTime();
                    if (data.createdAt?.__fs_type === 'timestamp' && typeof data.createdAt.value === 'string')
                      return new Date(data.createdAt.value).getTime();
                    if (data.createdAt?.seconds)
                      return data.createdAt.seconds * 1000;
                    if (data.createdAt?.toMillis)
                      return data.createdAt.toMillis();
                    return Date.now();
                  } catch {
                    return Date.now();
                  }
                })(),
              });
            }
          }
        }
      }

      setMedia(items);
    } catch (e: any) {
      console.error('[MediaGalleryScreen] Load error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  /* ── Render helpers ─────────────────────────────────────────────────────── */

  const renderItem = ({ item }: { item: MediaItem }) => (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => {
        // Only open fullscreen for images (videos would need a player)
        if (!item.isVideo) {
          setSelectedMedia(item.mediaUrl);
        }
      }}
    >
      <View style={styles.thumbContainer}>
        <Image
          source={{ uri: item.mediaUrl }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
        {/* Video play icon overlay */}
        {item.isVideo && (
          <View style={styles.playOverlay}>
            <View style={styles.playCircle}>
              <Ionicons name="play" size={22} color={colors.white} />
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  /* ── Screen layout ──────────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shared Media</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Media count */}
      {!loading && media.length > 0 && (
        <View style={styles.countBar}>
          <Ionicons name="images-outline" size={16} color={colors.textMuted} />
          <Text style={styles.countText}>
            {media.length} item{media.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : media.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="images-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>No shared media</Text>
          <Text style={styles.emptySubtext}>
            Photos and videos shared in this chat will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={media}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={NUM_COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Fullscreen image viewer */}
      {selectedMedia !== null && (
        <FullScreenViewer
          uri={selectedMedia}
          onClose={() => setSelectedMedia(null)}
        />
      )}
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  countBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  list: {
    paddingBottom: 20,
  },
  row: {
    paddingHorizontal: 2,
    gap: GAP,
  },
  thumbContainer: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumbnail: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3, // Visual centering for play triangle
  },

  /* Fullscreen viewer */
  fullscreenBg: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenClose: {
    position: 'absolute',
    top: 50,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: {
    width: SCREEN_W,
    height: '100%',
  },
});
