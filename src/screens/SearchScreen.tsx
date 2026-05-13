import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { User, Post, tsToMillis, parseMediaUrls } from '../lib/api';
import { Avatar, VerifiedBadge } from '../components/Avatar';

export default function SearchScreen({ route, navigation }: any) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [tab, setTab] = useState<'people' | 'posts'>('people');
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const insets = useSafeAreaInsets();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setUsers([]); setPosts([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const lower = q.toLowerCase();
      const [uSnap, pSnap] = await Promise.all([
        firestore().collection('users')
          .where('usernameLower', '>=', lower)
          .where('usernameLower', '<=', lower + '\uf8ff')
          .limit(10).get(),
        firestore().collection('posts')
          .orderBy('createdAt', 'desc')
          .limit(20).get(),
      ]);

      const foundUsers: User[] = uSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, email: data.email || '', username: data.username || '',
          displayName: data.displayName || '', bio: data.bio || '',
          profileImage: data.profileImage || null, coverImage: data.coverImage || null,
          role: data.role || '', badge: data.badge || '', subscription: data.subscription || '',
          isVerified: data.isVerified || false, createdAt: tsToMillis(data.createdAt),
        };
      });

      const foundPosts: Post[] = pSnap.docs
        .filter(d => d.data().caption?.toLowerCase().includes(lower))
        .slice(0, 10)
        .map(d => {
          const data = d.data();
          return {
            id: d.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
            authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
            caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
            likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
            repostCount: data.repostCount || 0, liked: false, bookmarked: false, reposted: false,
            createdAt: tsToMillis(data.createdAt),
          };
        });

      setUsers(foundUsers);
      setPosts(foundPosts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSearched(false);
      setUsers([]);
      setPosts([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // Pre-fill from explore navigation
  useEffect(() => {
    const q = route?.params?.q;
    if (q) {
      setQuery(q);
    }
  }, []);

  const renderUserItem = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.userRow}
      onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
    >
      <Avatar uri={item.profileImage} size={44} name={item.displayName} />
      <View style={styles.userTextWrap}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={styles.userName} numberOfLines={1}>{item.displayName}</Text>
          {(item.isVerified || !!item.badge) && <VerifiedBadge badge={item.badge} isVerified={item.isVerified} size={16} />}
        </View>
        <Text style={styles.userHandle} numberOfLines={1}>@{item.username}</Text>
        {item.bio ? <Text style={styles.userBio} numberOfLines={1}>{item.bio}</Text> : null}
      </View>
    </TouchableOpacity>
  );

  const renderPostItem = ({ item }: { item: Post }) => (
    <View style={styles.postRow}>
      <View style={styles.postTextWrap}>
        <Text style={styles.postCaption} numberOfLines={3}>{item.caption}</Text>
        <Text style={styles.postAuthor}>by @{item.authorUsername}</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Search</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* Search Bar */}
      <View style={[styles.searchBarWrap, focused && styles.searchBarFocused]}>
        <Ionicons name="search" size={20} color="#94a3b8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor="#64748b"
          value={query}
          onChangeText={q => setQuery(q)}
          returnKeyType="search"
          onSubmitEditing={() => doSearch(query)}
          autoFocus={true}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setUsers([]); setPosts([]); setSearched(false); }} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#64748b" />
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {searched ? (
        <View style={styles.resultsWrap}>
          {/* People / Posts tabs */}
          <View style={styles.searchTabs}>
            {(['people', 'posts'] as const).map(t => (
              <TouchableOpacity key={t} style={styles.searchTab} onPress={() => setTab(t)}>
                <Text style={[styles.searchTabText, tab === t && styles.searchTabTextActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
                {tab === t && <View style={styles.searchTabIndicator} />}
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : tab === 'people' ? (
            <FlatList
              data={users}
              keyExtractor={(item) => `user-${item.id}`}
              renderItem={renderUserItem}
              ListEmptyComponent={
                <View style={styles.emptyResults}>
                  <Text style={{ color: '#94a3b8', fontSize: 15 }}>No users found</Text>
                </View>
              }
              ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 16 }} />}
            />
          ) : (
            <FlatList
              data={posts}
              keyExtractor={(item) => `post-${item.id}`}
              renderItem={renderPostItem}
              ListEmptyComponent={
                <View style={styles.emptyResults}>
                  <Text style={{ color: '#94a3b8', fontSize: 15 }}>No posts found</Text>
                </View>
              }
              ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 16 }} />}
            />
          )}
        </View>
      ) : (
        /* Empty state */
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="search" size={32} color="#64748b" />
          </View>
          <Text style={styles.emptyTitle}>Search for people and posts</Text>
          <Text style={styles.emptySubtitle}>Find users, posts, and topics across Black94.</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  /* Search bar: bg-white/[0.06], border border-white/[0.08], focus: border-white/50 */
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 25,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: { flex: 1, color: '#e7e9ea', fontSize: 15, padding: 0 },
  searchBarFocused: {
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  /* Search tabs: same as profile tabs */
  searchTabs: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  searchTab: { flex: 1, alignItems: 'center', paddingVertical: 14, position: 'relative' as const },
  searchTabText: { color: '#94a3b8', fontWeight: '500', fontSize: 15 },
  searchTabTextActive: { color: '#e7e9ea', fontWeight: '700' },
  searchTabIndicator: {
    position: 'absolute' as const,
    bottom: 0,
    left: 24,
    right: 24,
    height: 1,
    borderRadius: 0.5,
    backgroundColor: '#FFFFFF',
  },
  /* Results */
  resultsWrap: { flex: 1 },
  emptyResults: { alignItems: 'center', paddingTop: 60 },
  /* User row: avatar 44, name bold 15px, handle 14px, bio 13px */
  userRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12, paddingHorizontal: 16,
  },
  userTextWrap: { marginLeft: 12, flex: 1 },
  userName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  userHandle: { color: '#94a3b8', fontSize: 14 },
  userBio: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  /* Post row: caption 15px, author handle 13px */
  postRow: { paddingHorizontal: 16, paddingVertical: 12 },
  postTextWrap: {},
  postCaption: { color: '#e7e9ea', fontSize: 15, lineHeight: 22 },
  postAuthor: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  /* Empty state: icon in 64x64 circle, bg white/4%, title, subtitle */
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingBottom: 100,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#e7e9ea', fontSize: 15, fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: '#94a3b8', fontSize: 14, textAlign: 'center',
  },
});
