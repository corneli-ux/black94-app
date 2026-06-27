import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FlatList, Alert } from 'react-native';
import { toggleLike, toggleBookmark, toggleRepost, Post, tsToMillis, parseMediaUrls } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';
import { useOptimisticAction } from './useOptimisticAction';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';

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
  // Track posts the user has interacted with — never overwrite these from Firestore polls
  const interactedPostIds = React.useRef(new Set<string>());
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Black94');
  const [followedUserIds, setFollowedUserIds] = useState<Set<string>>(new Set());
  const currentUser = auth()?.currentUser;
  const flatListRef = useRef<FlatList>(null);
  const lastDocRef = useRef<any>(null);
  // Holds the Firestore real-time unsubscribe fn for the top-of-feed listener
  const realtimeUnsubRef = useRef<(() => void) | null>(null);

  const PAGE_SIZE = 10;

  // ── Enrichment: author profiles ─────────────────────────────────────────
  // Uses the shared enrichAuthorProfiles utility (backed by userCache with
  // 2-min TTL) to fetch latest user docs and apply displayName, username,
  // profileImage, badge, isVerified to posts.
  //
  // PERF: Removed redundant self-repair loop that duplicated ALL user doc
  // fetches already done by enrichAuthorProfiles. The old code fetched each
  // user doc TWICE per page load — once for enrichment, once for repair.
  // Self-repair is now handled lazily: only the CURRENT USER's doc is checked,
  // and only if enrichment shows it's corrupted (empty displayName/username).
  const enrichAuthorProfilesWithRepair = useCallback(async (postsToEnrich: Post[]) => {
    await enrichAuthorProfiles(postsToEnrich);

    // Lightweight self-repair: only check if the CURRENT USER's own doc is
    // corrupted (visible in their own posts). Skip other users' docs to
    // avoid redundant Firestore reads — enrichAuthorProfiles already fetched them.
    const myId = auth()?.currentUser?.uid;
    if (!myId) return;
    const myPosts = postsToEnrich.filter(p => p.authorId === myId);
    if (myPosts.length === 0) return;

    // If any of our own posts still have empty displayName after enrichment,
    // our user doc might be corrupted. Repair it from the Zustand store.
    const needsRepair = myPosts.some(p => !p.authorDisplayName || !p.authorUsername);
    if (!needsRepair) return;

    if (__DEV__) console.warn('[Feed] Current user doc appears corrupted — attempting self-repair');
    try {
      const { useAppStore } = await import('../stores/app');
      const storeUser = useAppStore.getState().user;
      if (storeUser && (storeUser.username || storeUser.displayName)) {
        await firestore().collection('users').doc(myId).update({
          username: storeUser.username || '',
          displayName: storeUser.displayName || 'User',
          profileImage: storeUser.profileImage || null,
        });
        // Re-enrich our own posts after repair
        for (const post of myPosts) {
          if (storeUser.displayName) post.authorDisplayName = storeUser.displayName;
          if (storeUser.username) post.authorUsername = storeUser.username;
          if (storeUser.profileImage) post.authorProfileImage = storeUser.profileImage;
        }
        // Invalidate cache so next enrichment picks up the repaired doc
        const { invalidateUserCache } = await import('../lib/userCache');
        invalidateUserCache(myId);
        if (__DEV__) console.log(`[Feed] Repaired user doc ${myId}: ${storeUser.displayName} @${storeUser.username}`);
      }
    } catch (repairErr) {
      if (__DEV__) console.warn('[Feed] Failed to repair user doc:', repairErr);
    }
  }, []);

  // ── Enrichment: user interactions (likes, bookmarks, reposts, poll votes) ─
  // PERF: Fetches all interaction docs in parallel batches of 10.
  // Each post needs 3 checks (like, bookmark, repost) = 30 individual reads
  // per page. This is the minimum possible with the REST API since Firestore
  // doesn't support "key-in" queries for subcollections.
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
    // PERF: Only fetch poll votes for posts that actually have polls
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
      enrichAuthorProfilesWithRepair(postsToEnrich),
      userId ? enrichInteractions(postsToEnrich, userId) : Promise.resolve(),
    ]);
    setPosts(prev => {
      const enrichedIds = new Set(postsToEnrich.map(p => p.id));
      return prev.map(p => {
        if (!enrichedIds.has(p.id)) return p;
        const enriched = postsToEnrich.find(ep => ep.id === p.id);
        if (!enriched) return p;
        // Preserve user's local interaction state — don't overwrite from stale poll data
        const interacted = interactedPostIds.current.has(p.id) || interactedPostIds.current.has(p.repostOf || '');
        if (interacted) {
          return { ...enriched, liked: p.liked, bookmarked: p.bookmarked, reposted: p.reposted,
            likeCount: p.likeCount, repostCount: p.repostCount };
        }
        return enriched;
      });
    });
  }, [enrichAuthorProfilesWithRepair, enrichInteractions]);

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
      .where('createdAt', '>', new Date(newestCreatedAt))
      .onSnapshot(
        snapshot => {
          if (snapshot.empty) return;
          // docChanges is an array in the REST compat layer (not a method)
          const added = (snapshot.docChanges || [])
            .filter((ch: any) => ch.type === 'added')
            .map((ch: any) => snapshotToPost(ch.doc));

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
        (err: any) => {
          // Non-fatal — live listener failing just means no auto-refresh
          if (__DEV__) console.warn('[Feed] Real-time listener error:', err?.message);
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
      // Quote repost fields
      quotePostId: data.quotePostId || undefined,
      quoteAuthorId: data.quoteAuthorId || undefined,
      quoteAuthorUsername: data.quoteAuthorUsername || undefined,
      quoteAuthorDisplayName: data.quoteAuthorDisplayName || undefined,
      quoteAuthorProfileImage: data.quoteAuthorProfileImage || undefined,
      quoteCaption: data.quoteCaption || undefined,
      quoteMediaUrls: data.quoteMediaUrls ? parseMediaUrls(data.quoteMediaUrls) : undefined,
      quoteLikeCount: data.quoteLikeCount || 0,
      quoteCommentCount: data.quoteCommentCount || 0,
      quoteRepostCount: data.quoteRepostCount || 0,
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
            const scoreB = (b.likeCount || 0) * 3 + (b.repostCount || 0) * 2 + (a.commentCount || 0);
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
        if (__DEV__) console.log(`[Feed] Loaded ${newPosts.length} posts, currentUser=${currentUser?.uid}`);
        for (const p of newPosts) {
          if (__DEV__) console.log(`[Feed] Post ${p.id.slice(0,8)}: authorId=${p.authorId}, displayName="${p.authorDisplayName}", username="@${p.authorUsername}", hasImage=${!!p.authorProfileImage}`);
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

  // ── Load followed user IDs for Network tab (deferred) ────────────────
  // PERF: Only load followed users when the Network tab is actually selected.
  // Previously this fired a Firestore collection scan on every mount, even if
  // the user never visits the Network tab. For users following 1000+ people,
  // this collection read could take 500ms+.
  const followedLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'Network' || !currentUser?.uid || followedLoadedRef.current) return;
    followedLoadedRef.current = true;
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
        if (__DEV__) console.warn('[Feed] Failed to load followed users:', e);
      }
    })();
  }, [activeTab, currentUser?.uid]);

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
    if (hasMountedRef.current && feedRefreshKey > 0) {
      lastDocRef.current = null;
      setAllLoaded(false);
      loadFeed(false);
    }
  }, [feedRefreshKey]);

  // ── Pull-to-refresh ───────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    interactedPostIds.current.clear(); // FIX: prevent unbounded memory growth
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
      interactedPostIds.current.clear(); // FIX: prevent unbounded memory growth on tab switch
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
  const handleLike = (postId: string, wasLiked: boolean) => {
    interactedPostIds.current.add(postId);
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
      ? { ...p, liked: !wasLiked, likeCount: Math.max(0, p.likeCount + (wasLiked ? -1 : 1)) }
      : p));
  };

  // ── Interaction: Bookmark (optimistic + API call) ──────────────────────
  const handleBookmark = (postId: string, wasBookmarked: boolean) => {
    interactedPostIds.current.add(postId);
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
      ? { ...p, bookmarked: !wasBookmarked }
      : p));
  };

  // ── Interaction: Repost (optimistic + API call, including undo logic) ──
  const handleRepost = async (postId: string, reposted: boolean) => {
    const key = `rp_${postId}`;
    console.log('[useFeed handleRepost] postId:', postId, 'reposted:', reposted, 'inflight:', inflight(key));
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
            authorBadge: rd.authorBadge || '',
            authorIsVerified: rd.authorIsVerified || false,
            factCheckVerified: rd.factCheckVerified || 0,
            factCheckDebunked: rd.factCheckDebunked || 0,
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
    } catch (e: any) {
      console.error('[Feed] Delete post error:', e?.message, e?.code, e?.status);
      Alert.alert('Error', `Failed to delete post: ${e?.message || 'Unknown error'}`);
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
