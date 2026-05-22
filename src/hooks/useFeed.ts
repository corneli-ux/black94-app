import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FlatList, Alert } from 'react-native';
import { toggleLike, toggleBookmark, toggleRepost, Post, tsToMillis, parseMediaUrls } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';
import { useOptimisticAction } from './useOptimisticAction';

/* ── Types ────────────────────────────────────────────────────────────────── */

export type Tab = 'For You' | 'Black94' | 'Network';

export interface UseFeedParams {
  navigation: any;
}

export interface UseFeedReturn {
  // Feed data
  posts: Post[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  ads: any[];
  followedUserIds: Set<string>;

  // Actions
  handleRefresh: () => void;
  handleLike: (postId: string, currentlyLiked: boolean) => void;
  handleBookmark: (postId: string, currentlyBookmarked: boolean) => void;
  handleRepost: (postId: string, currentlyReposted: boolean) => void;
  handleDelete: (postId: string) => void;
  handleEdit: (post: any) => void;
  handleComment: (postId: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void;
  handleTabChange: (tab: Tab) => void;
  loadMore: () => void;

  // Edit modal state
  editingPost: { id: string; caption: string } | null;
  editCaption: string;
  setEditCaption: (caption: string) => void;
  setEditingPost: (post: { id: string; caption: string } | null) => void;
  handleSaveEdit: () => Promise<void>;

  // Refs
  flatListRef: React.RefObject<FlatList>;
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

export function useFeed({ navigation }: UseFeedParams): UseFeedReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Black94');
  const [ads, setAds] = useState<any[]>([]);
  const [followedUserIds, setFollowedUserIds] = useState<Set<string>>(new Set());
  const currentUser = auth()?.currentUser;
  const flatListRef = useRef<FlatList>(null);
  const lastDocRef = useRef<any>(null);
  // Holds the Firestore real-time unsubscribe fn for the top-of-feed listener
  const realtimeUnsubRef = useRef<(() => void) | null>(null);

  const PAGE_SIZE = 10;

  // ── Enrichment: author profiles ─────────────────────────────────────────
  const enrichAuthorProfiles = useCallback(async (postsToEnrich: Post[]) => {
    const uniqueAuthorIds = [...new Set(postsToEnrich.map(p => p.authorId).filter(Boolean))];
    const CHUNK_SIZE = 10;
    const authorProfileMap: Record<string, any> = {};
    for (let i = 0; i < uniqueAuthorIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueAuthorIds.slice(i, i + CHUNK_SIZE);
      try {
        const userDocs = await Promise.all(
          chunk.map(uid => firestore().collection('users').doc(uid).get().catch(() => null))
        );
        for (const docSnap of userDocs) {
          if (docSnap && docSnap.exists) {
            const d = docSnap.data()!;
            authorProfileMap[docSnap.id] = {
              profileImage: d.profileImage || null,
              badge: d.badge || '',
              isVerified: d.isVerified || false,
            };
          }
        }
      } catch (e) {
        console.warn('[Feed] Batch author profile fetch failed for chunk:', e);
      }
    }
    for (const post of postsToEnrich) {
      const fresh = authorProfileMap[post.authorId];
      if (!fresh) continue;
      if (fresh.profileImage) post.authorProfileImage = fresh.profileImage;
      if (fresh.badge) post.authorBadge = fresh.badge;
      post.authorIsVerified = fresh.isVerified;
    }
  }, []);

  // ── Enrichment: user interactions (likes, bookmarks, reposts, poll votes) ─
  const enrichInteractions = useCallback(async (postsToEnrich: Post[], userId: string) => {
    const postIds = postsToEnrich.map(p => p.repostOf || p.id);
    const likedIds = new Set<string>();
    const bookmarkedIds = new Set<string>();
    const repostedIds = new Set<string>();
    const CHUNK = 10;
    for (let i = 0; i < postIds.length; i += CHUNK) {
      const chunk = postIds.slice(i, i + CHUNK);
      try {
        await Promise.all(chunk.flatMap(postId => [
          firestore().collection('post_likes').doc(`${postId}_${userId}`).get().then(s => { if (s.exists) likedIds.add(postId); }).catch(() => {}),
          firestore().collection('post_bookmarks').doc(`${postId}_${userId}`).get().then(s => { if (s.exists) bookmarkedIds.add(postId); }).catch(() => {}),
          firestore().collection('post_reposts').doc(`${postId}_${userId}`).get().then(s => { if (s.exists) repostedIds.add(postId); }).catch(() => {}),
        ]));
      } catch (e) { console.warn('[Feed] Interaction fetch failed:', e); }
    }
    for (const post of postsToEnrich) {
      const iid = post.repostOf || post.id;
      post.liked = likedIds.has(iid);
      post.bookmarked = bookmarkedIds.has(iid);
      post.reposted = repostedIds.has(iid);
    }
    const pollPostIds = postsToEnrich.filter(p => p.pollData).map(p => p.id);
    if (pollPostIds.length > 0) {
      const pollVotedIds = new Set<string>();
      await Promise.all(pollPostIds.map(async (postId) => {
        try {
          const v = await firestore().collection('posts').doc(postId).collection('poll_votes').doc(userId).get();
          if (v.exists) pollVotedIds.add(postId);
        } catch {}
      }));
      for (const post of postsToEnrich) {
        if (post.pollData) post.pollVoted = pollVotedIds.has(post.repostOf || post.id);
      }
    }
  }, []);

  // ── Enrichment: combine author profiles + interactions, update state ────
  const enrichPostsInBackground = useCallback(async (postsToEnrich: Post[], userId: string | undefined) => {
    if (postsToEnrich.length === 0) return;
    await Promise.all([
      enrichAuthorProfiles(postsToEnrich),
      userId ? enrichInteractions(postsToEnrich, userId) : Promise.resolve(),
    ]);
    setPosts(prev => {
      const enrichedIds = new Set(postsToEnrich.map(p => p.id));
      return prev.map(p => {
        if (!enrichedIds.has(p.id)) return p;
        return postsToEnrich.find(ep => ep.id === p.id) || p;
      });
    });
  }, [enrichAuthorProfiles, enrichInteractions]);

  // ── Real-time listener: watches for NEW posts arriving at the top ──────
  // We attach a live onSnapshot query limited to posts newer than the newest
  // post we already have. When it fires with a new doc, we prepend it and
  // run enrichment in the background — no pull-to-refresh required.
  const attachRealtimeListener = useCallback((newestCreatedAt: number) => {
    // Tear down any existing listener first
    if (realtimeUnsubRef.current) {
      realtimeUnsubRef.current();
      realtimeUnsubRef.current = null;
    }

    const userId = auth()?.currentUser?.uid;

    // Import docToPost logic inline (tightly coupled to feed but needed here for realtime)
    const snapshotToPost = (docSnap: any): Post => {
      const data = docSnap.data();
      if (!data) return null as any;
      return {
        id: docSnap.id,
        authorId: data.authorId || '',
        authorUsername: data.authorUsername || '',
        authorDisplayName: data.authorDisplayName || '',
        authorProfileImage: data.authorProfileImage || null,
        authorBadge: data.authorBadge || '',
        authorIsVerified: data.authorIsVerified || false,
        factCheckVerified: data.factCheckVerified || 0,
        factCheckDebunked: data.factCheckDebunked || 0,
        caption: data.caption || '',
        mediaUrls: parseMediaUrls(data.mediaUrls),
        pollData: data.pollData || undefined,
        likeCount: data.likeCount || 0,
        commentCount: data.commentCount || 0,
        repostCount: data.repostCount || 0,
        viewCount: data.viewCount || 0,
        liked: false,
        bookmarked: false,
        reposted: false,
        createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        repostOf: data.repostOf || undefined,
        repostedByUid: data.repostedByUid || undefined,
        repostedByUsername: data.repostedByUsername || undefined,
        repostedByDisplayName: data.repostedByDisplayName || undefined,
        visibility: data.visibility || 'public',
      };
    };

    const unsub = firestore()
      .collection('posts')
      .orderBy('createdAt', 'desc')
      // Only listen for posts strictly newer than what we already have.
      // We use a Firestore Timestamp approximation from the millis value.
      .where('createdAt', '>', new Date(newestCreatedAt))
      .onSnapshot(
        snapshot => {
          if (snapshot.empty) return;
          // docChanges gives us only the delta (added/modified/removed)
          const added = snapshot.docChanges()
            .filter(ch => ch.type === 'added')
            .map(ch => snapshotToPost(ch.doc));

          if (added.length === 0) return;

          if (__DEV__) console.log(`[Feed] Real-time: ${added.length} new post(s) arrived`);

          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const fresh = added.filter(p => !existingIds.has(p.id));
            if (fresh.length === 0) return prev;
            return [...fresh, ...prev];
          });

          // Enrich in background (author profiles + interaction state)
          enrichPostsInBackground(added, userId);
        },
        err => {
          // Non-fatal — live listener failing just means no auto-refresh
          console.warn('[Feed] Real-time listener error:', err?.message);
        }
      );

    realtimeUnsubRef.current = unsub;
  }, [enrichPostsInBackground]);

  // BUG FIX: Use a ref guard to prevent double-fire from onEndReached.
  // React state updates are async — two rapid onEndReached calls both pass
  // the loadingMore check before the first setLoadingMore(true) commits.
  const fetchingRef = useRef(false);

  // ── Inline doc→Post mapper (shared across loadFeed and realtime listener) ─
  const docToPost = useCallback((docSnap: any): Post => {
    const data = docSnap.data();
    if (!data) return null as any;
    return {
      id: docSnap.id,
      authorId: data.authorId || '',
      authorUsername: data.authorUsername || '',
      authorDisplayName: data.authorDisplayName || '',
      authorProfileImage: data.authorProfileImage || null,
      authorBadge: data.authorBadge || '',
      authorIsVerified: data.authorIsVerified || false,
      factCheckVerified: data.factCheckVerified || 0,
      factCheckDebunked: data.factCheckDebunked || 0,
      caption: data.caption || '',
      mediaUrls: parseMediaUrls(data.mediaUrls),
      pollData: data.pollData || undefined,
      likeCount: data.likeCount || 0,
      commentCount: data.commentCount || 0,
      repostCount: data.repostCount || 0,
      viewCount: data.viewCount || 0,
      liked: false,
      bookmarked: false,
      reposted: false,
      createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
      repostOf: data.repostOf || undefined,
      repostedByUid: data.repostedByUid || undefined,
      repostedByUsername: data.repostedByUsername || undefined,
      repostedByDisplayName: data.repostedByDisplayName || undefined,
      visibility: data.visibility || 'public',
    };
  }, []);

  // ── Core feed loader ───────────────────────────────────────────────────
  const loadFeed = useCallback(async (append = false) => {
    try {
      if (append && (loadingMore || allLoaded || fetchingRef.current)) return;
      if (append) {
        fetchingRef.current = true;
        setLoadingMore(true);
      }

      // For "For You" tab: fetch recent posts and sort by engagement score
      if (activeTab === 'For You') {
        try {
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const snapshot = append
            ? await firestore()
                .collection('posts')
                .orderBy('createdAt', 'desc')
                .startAfter(lastDocRef.current)
                .limit(PAGE_SIZE)
                .get()
            : await firestore()
                .collection('posts')
                .where('createdAt', '>', twentyFourHoursAgo)
                .orderBy('createdAt', 'desc')
                .limit(PAGE_SIZE * 3) // Fetch more to sort from
                .get();

          const userId = currentUser?.uid;
          let scoredPosts: Post[] = snapshot.docs.map(docToPost);

          // Sort by engagement score: 3*likes + 2*reposts + comments
          scoredPosts.sort((a, b) => {
            const scoreA = (a.likeCount || 0) * 3 + (a.repostCount || 0) * 2 + (a.commentCount || 0);
            const scoreB = (b.likeCount || 0) * 3 + (b.repostCount || 0) * 2 + (b.commentCount || 0);
            return scoreB - scoreA;
          });

          // Take top PAGE_SIZE after sorting
          const newPosts = scoredPosts.slice(0, PAGE_SIZE);

          if (newPosts.length === 0) {
            setAllLoaded(true);
            if (append) { setLoadingMore(false); return; }
          }

          if (!append) {
            lastDocRef.current = snapshot.docs[Math.min(snapshot.docs.length - 1, PAGE_SIZE - 1)];
          }

          if (append) {
            setPosts(prev => [...prev, ...newPosts]);
          } else {
            setPosts(newPosts);
          }
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
          enrichPostsInBackground(newPosts, userId);
          return;
        } catch (e: any) {
          console.error('[FeedScreen] For You feed error:', e?.message);
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }

      const snapshot = lastDocRef.current
        ? await firestore()
            .collection('posts')
            .orderBy('createdAt', 'desc')
            .startAfter(lastDocRef.current)
            .limit(PAGE_SIZE)
            .get()
        : await firestore()
            .collection('posts')
            .orderBy('createdAt', 'desc')
            .limit(PAGE_SIZE)
            .get();

      if (snapshot.docs.length === 0) {
        setAllLoaded(true);
        if (append) { setLoadingMore(false); return; }
      }

      // Save cursor for next page
      lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];

      const userId = currentUser?.uid;
      const newPosts: Post[] = snapshot.docs.map(docToPost);

      if (newPosts.length === 0) {
        setAllLoaded(true);
        if (append) { setLoadingMore(false); return; }
      }

      if (__DEV__) {
        for (const p of newPosts) {
          if (p.mediaUrls.length > 0) {
            console.log(`[Feed] Post ${p.id} has ${p.mediaUrls.length} media URL(s): ${p.mediaUrls[0]?.slice(0, 120)}`);
          }
        }
      }

      // IMMEDIATELY show posts to the user — enrichment runs in background
      if (append) {
        setPosts(prev => [...prev, ...newPosts]);
      } else {
        setPosts(newPosts);
        // Attach the real-time listener anchored to the newest post's createdAt
        if (newPosts.length > 0) {
          attachRealtimeListener(newPosts[0].createdAt);
        }
      }
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      fetchingRef.current = false;
      enrichPostsInBackground(newPosts, userId);
    } catch (e: any) {
      console.error('[FeedScreen] Feed load error:', e?.message);
      if (!append) {
        Alert.alert('Feed', 'Unable to load feed right now. Pull down to retry.');
      }
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      fetchingRef.current = false;
    }
  }, [currentUser?.uid, loadingMore, allLoaded, attachRealtimeListener, activeTab, docToPost, enrichPostsInBackground]);

  // ── Fetch active ad campaigns (deferred 2s so feed loads first) ───────
  useEffect(() => {
    const timer = setTimeout(() => {
      (async () => {
        try {
          const adSnap = await firestore()
            .collection('adCampaigns')
            .where('status', '==', 'active')
            .limit(5)
            .get();
          const adList = adSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
          setAds(adList);
          if (__DEV__) console.log(`[Ads] Loaded ${adList.length} active campaigns`);
        } catch (e) {
          console.warn('[Ads] Failed to fetch ad campaigns:', e);
        }
      })();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // ── Load followed user IDs for Network tab ────────────────────────────
  useEffect(() => {
    if (!currentUser?.uid) return;
    (async () => {
      try {
        const snap = await firestore()
          .collection('user_following')
          .doc(currentUser.uid)
          .collection('following')
          .get();
        const ids = new Set(snap.docs.map(d => d.id));
        setFollowedUserIds(ids);
        if (__DEV__) console.log(`[Feed] Loaded ${ids.size} followed users for Network tab`);
      } catch (e) {
        console.warn('[Feed] Failed to load followed users:', e);
      }
    })();
  }, [currentUser?.uid]);

  // ── Load feed on mount ────────────────────────────────────────────────
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      loadFeed();
    }
  }, [loadFeed]);

  // ── Tear down real-time listener on unmount to prevent memory leaks ───
  useEffect(() => {
    return () => {
      if (realtimeUnsubRef.current) {
        realtimeUnsubRef.current();
        realtimeUnsubRef.current = null;
      }
    };
  }, []);

  // ── Reload feed when screen regains focus ONLY if explicitly requested ─
  // (e.g. after creating a post). Avoids unnecessary full re-fetch on every tab switch.
  const feedRefreshKey = useAppStore(s => s.feedRefreshKey);
  useEffect(() => {
    if (hasMountedRef.current && feedRefreshKey > 0 && !loading) {
      lastDocRef.current = null;
      setAllLoaded(false);
      loadFeed(false);
    }
  }, [feedRefreshKey]);

  // ── Pull-to-refresh ───────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setAllLoaded(false);
    lastDocRef.current = null;
    loadFeed(false);
  }, [loadFeed]);

  // ── Pagination (load more) ────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (loadingMore || allLoaded) return;
    loadFeed(true);
  }, [loadingMore, allLoaded, loadFeed]);

  // ── Tab switching ─────────────────────────────────────────────────────
  const handleTabChange = useCallback((tab: Tab) => {
    if (activeTab !== tab) {
      setActiveTab(tab);
      lastDocRef.current = null;
      setAllLoaded(false);
      setPosts([]);
      setLoading(true);
      loadFeed(false);
    }
  }, [activeTab, loadFeed]);

  // ── In-flight guards prevent double-tap race conditions ──────────────
  const { guard: inflight, release: releaseInflight } = useOptimisticAction();

  // ── Interaction: Like (optimistic + API call) ─────────────────────────
  const handleLike = async (postId: string, liked: boolean) => {
    const key = `like_${postId}`;
    if (!inflight(key)) return; // drop double-tap
    // Match both the repost wrapper (p.id) and original post (p.repostOf)
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
      ? { ...p, liked: !liked, likeCount: p.likeCount + (liked ? -1 : 1) }
      : p));
    try { await toggleLike(postId, liked); } catch (e) {
      // Revert optimistic update on failure — prevents ghost likes
      setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
        ? { ...p, liked, likeCount: p.likeCount + (liked ? 1 : -1) }
        : p));
    } finally {
      releaseInflight(key);
    }
  };

  // ── Interaction: Bookmark (optimistic + API call) ──────────────────────
  const handleBookmark = async (postId: string, bookmarked: boolean) => {
    const key = `bm_${postId}`;
    if (!inflight(key)) return; // drop double-tap
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId) ? { ...p, bookmarked: !bookmarked } : p));
    try { await toggleBookmark(postId, bookmarked); } catch (e) {
      setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId) ? { ...p, bookmarked } : p));
    } finally {
      releaseInflight(key);
    }
  };

  // ── Interaction: Repost (optimistic + API call, including undo logic) ──
  const handleRepost = async (postId: string, reposted: boolean) => {
    const key = `rp_${postId}`;
    if (!inflight(key)) return; // drop double-tap
    // Optimistic: update repost count on all posts matching this postId
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
      ? { ...p, reposted: !reposted, repostCount: p.repostCount + (reposted ? -1 : 1) }
      : p));

    try {
      const result = await toggleRepost(postId, reposted);

      if (!result.success) {
        // toggleRepost returned success:false — the write FAILED
        // Revert optimistic state
        setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
          ? { ...p, reposted, repostCount: p.repostCount + (reposted ? 1 : -1) }
          : p));
        if (__DEV__) console.warn('[Feed] Repost write failed (toggleRepost returned success:false)');
        return;
      }

      if (result.undone) {
        // ── Unrepost succeeded: remove the repost card from the feed ──
        const removedRepostId = `repost_${postId}_${currentUser?.uid}`;
        setPosts(prev => prev.filter(p => p.id !== removedRepostId));
      } else if (!reposted) {
        // ── New repost: use the doc data returned by toggleRepost directly ──
        if (result.repostDoc) {
          const rd = result.repostDoc;
          const newPost: Post = {
            id: rd.id,
            authorId: rd.authorId,
            authorUsername: rd.authorUsername,
            authorDisplayName: rd.authorDisplayName,
            authorProfileImage: rd.authorProfileImage,
            authorBadge: rd.authorBadge,
            authorIsVerified: rd.authorIsVerified,
            factCheckVerified: rd.factCheckVerified,
            factCheckDebunked: rd.factCheckDebunked,
            caption: rd.caption,
            mediaUrls: parseMediaUrls(rd.mediaUrls),
            pollData: rd.pollData || undefined,
            likeCount: rd.likeCount,
            commentCount: rd.commentCount,
            repostCount: rd.repostCount,
            viewCount: rd.viewCount,
            liked: false,
            bookmarked: false,
            reposted: true,
            createdAt: Date.now(),
            repostOf: rd.repostOf,
            repostedByUid: rd.repostedByUid,
            repostedByUsername: rd.repostedByUsername,
            repostedByDisplayName: rd.repostedByDisplayName,
            visibility: rd.visibility || 'public',
          };

          // Prepend only if not already present (guard against double-tap races)
          setPosts(prev =>
            prev.some(p => p.id === newPost.id) ? prev : [newPost, ...prev]
          );

          // Re-anchor the real-time listener to include the new repost
          attachRealtimeListener(Date.now());
        }
      }
    } catch (e) {
      // Revert optimistic update on failure
      setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
        ? { ...p, reposted, repostCount: p.repostCount + (reposted ? 1 : -1) }
        : p));
    } finally {
      releaseInflight(key);
    }
  };

  // ── Interaction: Delete post ─────────────────────────────────────────
  const handleDelete = async (postId: string) => {
    try {
      await firestore().collection('posts').doc(postId).delete();
      // Remove the original post AND any repost wrappers pointing to it
      setPosts(prev => prev.filter(p => p.id !== postId && p.repostOf !== postId));
    } catch {
      Alert.alert('Error', 'Failed to delete post');
    }
  };

  // ── Edit post ─────────────────────────────────────────────────────────
  const [editingPost, setEditingPost] = useState<{ id: string; caption: string } | null>(null);
  const [editCaption, setEditCaption] = useState('');

  const handleEdit = (post: any) => {
    setEditingPost({ id: post.id, caption: post.caption || '' });
    setEditCaption(post.caption || '');
  };

  const handleSaveEdit = async () => {
    if (!editingPost || editCaption.trim().length === 0) {
      Alert.alert('Error', 'Caption cannot be empty');
      return;
    }
    if (editCaption.length > 500) {
      Alert.alert('Error', 'Caption exceeds 500 character limit');
      return;
    }
    try {
      await firestore().collection('posts').doc(editingPost.id).update({
        caption: editCaption.trim(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setPosts(prev => prev.map(p =>
        p.id === editingPost.id ? { ...p, caption: editCaption.trim() } : p
      ));
      setEditingPost(null);
    } catch {
      Alert.alert('Error', 'Failed to update post');
    }
  };

  // ── Comment: navigate to PostComments ─────────────────────────────────
  const handleComment = (postId: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => {
    navigation.navigate('PostComments', { postId, postCaption: caption || '', postAuthorUsername: authorUsername || '', postAuthorDisplayName: authorDisplayName || '' });
  };

  return {
    // Feed data
    posts,
    loading,
    loadingMore,
    refreshing,
    activeTab,
    setActiveTab,
    ads,
    followedUserIds,

    // Actions
    handleRefresh,
    handleLike,
    handleBookmark,
    handleRepost,
    handleDelete,
    handleEdit,
    handleComment,
    handleTabChange,
    loadMore,

    // Edit modal state
    editingPost,
    editCaption,
    setEditCaption,
    setEditingPost,
    handleSaveEdit,

    // Refs
    flatListRef,
  };
}
