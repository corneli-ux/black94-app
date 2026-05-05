import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Image, TouchableOpacity, StyleSheet, ActivityIndicator,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { User, Post, tsToMillis, parseMediaUrls } from '../lib/api';
import { Avatar } from '../components/Avatar';

export default function SearchScreen({ navigation }: any) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

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

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Search</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      {/* Search Bar */}
      <View style={styles.searchBarWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search users and posts"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={q => { setQuery(q); doSearch(q); }}
          returnKeyType="search"
          onSubmitEditing={() => doSearch(query)}
          autoFocus={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setUsers([]); setPosts([]); setSearched(false); }}>
            <Text style={{ color: colors.textSecondary, fontSize: 18, paddingHorizontal: 8 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {!searched && !loading && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Text style={{ fontSize: 28, color: colors.textSecondary }}>🔍</Text>
          </View>
          <Text style={styles.emptyTitle}>Search for people and posts</Text>
          <Text style={styles.emptySubtitle}>Find users, posts, and topics across Black94.</Text>
        </View>
      )}

      {searched && !loading && (
        <FlatList
          data={[...users.map(u => ({ type: 'user', data: u })), ...posts.map(p => ({ type: 'post', data: p }))]}
          keyExtractor={(item, i) => `${item.type}-${i}`}
          renderItem={({ item }) => {
            if (item.type === 'user') {
              const u = item.data as User;
              return (
                <TouchableOpacity
                  style={styles.userRow}
                  onPress={() => navigation.navigate('UserProfile', { userId: u.id })}
                >
                  <Avatar uri={u.profileImage} size={46} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={styles.displayName}>{u.displayName}</Text>
                    <Text style={styles.handle}>@{u.username}</Text>
                    {u.bio ? <Text style={styles.bio} numberOfLines={1}>{u.bio}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            }
            const p = item.data as Post;
            return (
              <View style={styles.postRow}>
                <Avatar uri={p.authorProfileImage} size={38} />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={styles.displayName}>{p.authorDisplayName}
                    <Text style={styles.handle}> @{p.authorUsername}</Text>
                  </Text>
                  <Text style={styles.caption} numberOfLines={2}>{p.caption}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ color: colors.textSecondary }}>No results for "{query}"</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: colors.border }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgInput, borderRadius: 25,
    marginHorizontal: 16, marginVertical: 12, paddingHorizontal: 14,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.bgInput,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', paddingHorizontal: 40 },
  userRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 16 },
  postRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 16 },
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  handle: { color: colors.textSecondary, fontSize: 14 },
  bio: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  caption: { color: colors.text, fontSize: 14, marginTop: 2, lineHeight: 20 },
});
