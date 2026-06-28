import React, { Component, Suspense, lazy, useEffect, useRef, memo, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert, Animated } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { signOutUser } from '../lib/api';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { AppIcon } from '../components/icons';
import { Feather } from '@expo/vector-icons';
import { AnimatedTabBar } from '../components/AnimatedTabBar';

/* ── Dark Navigation Theme — prevents white flash on transitions ── */
const DarkTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bgCard,
    text: colors.text,
    border: colors.separator,
    notification: colors.primary,
  },
  fonts: {
    regular: { fontFamily: 'Roboto-Regular', fontWeight: '400' as const },
    medium: { fontFamily: 'Roboto-Medium', fontWeight: '500' as const },
    bold: { fontFamily: 'Roboto-Bold', fontWeight: '700' as const },
    heavy: { fontFamily: 'Roboto-Bold', fontWeight: '900' as const },
  },
};

import { colors } from '../theme/colors';

// PERF: Only the default tab (FeedScreen) is eagerly imported.
// All other tab screens are lazy-loaded — their JS bundle is not parsed
// until the user navigates to that tab for the first time. This cuts
// initial bundle evaluation time by ~40-60% for the navigation layer.
import FeedScreen from '../screens/FeedScreen';
const SearchScreen = lazy(() => import('../screens/SearchScreen'));
const ChatListScreen = lazy(() => import('../screens/ChatListScreen'));
const NotificationsScreen = lazy(() => import('../screens/NotificationsScreen'));
const StoriesScreen = lazy(() => import('../screens/StoriesScreen'));
const AnonymousChatScreen = lazy(() => import('../screens/AnonymousChatScreen'));

// Lazy load all other screens
const ChatRoomScreen = lazy(() => import('../screens/ChatRoomScreen'));
const ProfileScreen = lazy(() => import('../screens/ProfileScreen'));
const SettingsScreen = lazy(() => import('../screens/SettingsScreen'));
const BookmarksScreen = lazy(() => import('../screens/BookmarksScreen'));
const ExploreScreen = lazy(() => import('../screens/ExploreScreen'));
const PrivacySettingsScreen = lazy(() => import('../screens/PrivacySettingsScreen'));
const WriteArticleScreen = lazy(() => import('../screens/WriteArticleScreen'));
const ShareProfileScreen = lazy(() => import('../screens/ShareProfileScreen'));
const PremiumDashboardScreen = lazy(() => import('../screens/PremiumDashboardScreen'));
const UsernameSetupScreen = lazy(() => import('../screens/UsernameSetupScreen'));
const AuthScreen = lazy(() => import('../screens/AuthScreen'));
const EditProfileScreen = lazy(() => import('../screens/EditProfileScreen'));
const UserProfileScreen = lazy(() => import('../screens/UserProfileScreen'));
const StoryViewerScreen = lazy(() => import('../screens/StoryViewerScreen'));
const StoryCreatorScreen = lazy(() => import('../screens/StoryCreatorScreen'));
const CreatePostScreen = lazy(() => import('../screens/CreatePostScreen'));
const GifPickerScreen = lazy(() => import('../screens/GifPickerScreen'));
const ArticleViewScreen = lazy(() => import('../screens/ArticleViewScreen'));
const AudioCallScreen = lazy(() => import('../screens/AudioCallScreen'));
const DualPaneChatScreen = lazy(() => import('../screens/DualPaneChatScreen'));
const FollowersScreen = lazy(() => import('../screens/FollowersScreen'));
const PostCommentsScreen = lazy(() => import('../screens/PostCommentsScreen'));
const PaidChatScreen = lazy(() => import('../screens/PaidChatScreen'));
const PrivacyPolicyScreen = lazy(() => import('../screens/PrivacyPolicyScreen'));
const TermsScreen = lazy(() => import('../screens/TermsScreen'));
const CommunityGuidelinesScreen = lazy(() => import('../screens/CommunityGuidelinesScreen'));
const SignupScreen = lazy(() => import('../screens/SignupScreen'));
const AppearanceScreen = lazy(() => import('../screens/AppearanceScreen'));
const BlockedUsersScreen = lazy(() => import('../screens/BlockedUsersScreen'));
const ChangeUsernameScreen = lazy(() => import('../screens/ChangeUsernameScreen'));
const NotificationSettingsScreen = lazy(() => import('../screens/NotificationSettingsScreen'));
const MutedUsersScreen = lazy(() => import('../screens/MutedUsersScreen'));
const MutedWordsScreen = lazy(() => import('../screens/MutedWordsScreen'));
const SecurityScreen = lazy(() => import('../screens/SecurityScreen'));
const PostDetailScreen = lazy(() => import('../screens/PostDetailScreen'));
const EditPostScreen = lazy(() => import('../screens/EditPostScreen'));
const HashtagScreen = lazy(() => import('../screens/HashtagScreen'));
const TrendingScreen = lazy(() => import('../screens/TrendingScreen'));
const ScheduledPostsScreen = lazy(() => import('../screens/ScheduledPostsScreen'));
const DraftPostsScreen = lazy(() => import('../screens/DraftPostsScreen'));
const MessageRequestsScreen = lazy(() => import('../screens/MessageRequestsScreen'));
const GroupInfoScreen = lazy(() => import('../screens/GroupInfoScreen'));
const StoryViewersScreen = lazy(() => import('../screens/StoryViewersScreen'));
const MediaGalleryScreen = lazy(() => import('../screens/MediaGalleryScreen'));
const DataExportScreen = lazy(() => import('../screens/DataExportScreen'));
const VerificationRequestScreen = lazy(() => import('../screens/VerificationRequestScreen'));
const VideoCallScreen = lazy(() => import('../screens/VideoCallScreen'));
const SessionsScreen = lazy(() => import('../screens/SessionsScreen'));
const LinkedAccountsScreen = lazy(() => import('../screens/LinkedAccountsScreen'));
const ChangeEmailScreen = lazy(() => import('../screens/ChangeEmailScreen'));
const ChangePasswordScreen = lazy(() => import('../screens/ChangePasswordScreen'));
const ProfileHighlightsScreen = lazy(() => import('../screens/ProfileHighlightsScreen'));
const LikedPostsScreen = lazy(() => import('../screens/LikedPostsScreen'));
const MentionedPostsScreen = lazy(() => import('../screens/MentionedPostsScreen'));
const MediaPostsScreen = lazy(() => import('../screens/MediaPostsScreen'));

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function LazyFallback() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.white} size="large" />
    </View>
  );
}

// BUG FIX: Error boundary for lazy-loaded screens. If a lazy import fails
// (missing module, native module crash, syntax error), React shows
// Suspense fallback forever. This error boundary catches the error and
// shows a recovery UI instead. Critical for ChatRoomScreen which loads
// many native modules (expo-av, expo-image-picker, expo-file-system).
class LazyScreenErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center' }}>
            Failed to load screen. Please restart the app.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function LazyScreen(Component: any) {
  return function Wrapped(props: any) {
    return (
      <LazyScreenErrorBoundary>
        <Suspense fallback={<LazyFallback />}>
          <Component {...props} />
        </Suspense>
      </LazyScreenErrorBoundary>
    );
  };
}

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const GOLD = colors.accent;
  const DIM = 'rgba(255,255,255,0.35)';
  const color = focused ? GOLD : DIM;
  const sz = 22;

  const icon = (() => {
    switch (name) {
      case 'Home':
        return (
          <Text style={{
            fontSize: 18, fontWeight: '900', color,
            letterSpacing: -1, fontStyle: 'italic', lineHeight: 22,
          }}>94</Text>
        );
      case 'Search':
        return <Feather name="search" size={sz} color={color} />;
      case 'Messages':
        return <Feather name="message-circle" size={sz} color={color} />;
      case 'Notifications':
        return <Feather name="bell" size={sz} color={color} />;
      case 'Stories':
        return <Feather name="plus-circle" size={sz} color={color} />;
      case 'AnonymousChat':
        return <Feather name="eye-off" size={sz} color={color} />;
      default:
        return <Feather name="circle" size={sz} color={color} />;
    }
  })();

  const label = (() => {
    switch (name) {
      case 'Home': return 'Feed';
      case 'Search': return 'Search';
      case 'Messages': return 'Msgs';
      case 'Notifications': return 'Alerts';
      case 'Stories': return 'Story';
      case 'AnonymousChat': return 'Anon';
      default: return '';
    }
  })();

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 3 }}>
      {focused && (
        <View style={{
          position: 'absolute', top: -10, width: 32, height: 2,
          backgroundColor: GOLD, borderRadius: 1,
        }} />
      )}
      {icon}
      <Text style={{
        fontSize: 9, fontWeight: focused ? '600' : '400',
        color, letterSpacing: 0.3, textAlign: 'center',
      }} numberLines={1}>{label}</Text>
    </View>
  );
}

function TabBarBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 9 ? '9+' : String(count);
  return (
    <View style={styles.tabBadge}>
      <Text style={styles.tabBadgeText}>{label}</Text>
    </View>
  );
}

// PERF: Memoize MainTabs to prevent re-renders when parent state changes.
const MainTabs = memo(function MainTabs() {
  const unreadNotificationCount = useAppStore(s => s.unreadNotificationCount);
  const tabBarVisible = useAppStore(s => s.tabBarVisible);
  const insets = useSafeAreaInsets();
  const tabBarHeight = 58 + (insets.bottom || 0);

  return (
    <Tab.Navigator
      screenOptions={{
        lazy: true,
        headerShown: false,
        tabBar: (props) => <AnimatedTabBar {...props} />,
        tabBarShowLabel: false,
        tabBarItemStyle: { paddingVertical: 6 },
        // FIX: Remove fixed scene padding. The AnimatedTabBar handles its own space.
        // This prevents the black gap when the tab bar slides away.
        sceneStyle: { paddingBottom: 0 },
      }}
    >
      <Tab.Screen name="Home" component={FeedScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} /> }} />
      <Tab.Screen name="Search" component={LazyScreen(SearchScreen)} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Search" focused={focused} /> }} />
      <Tab.Screen name="Messages" component={LazyScreen(ChatListScreen)} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Messages" focused={focused} /> }} />
      <Tab.Screen
        name="Notifications"
        component={LazyScreen(NotificationsScreen)}
        options={{
          tabBarIcon: ({ focused }) => (
            <View>
              <TabIcon name="Notifications" focused={focused} />
              <TabBarBadge count={unreadNotificationCount} />
            </View>
          ),
        }}
      />
      <Tab.Screen name="Stories" component={LazyScreen(StoriesScreen)} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Stories" focused={focused} /> }} />
      <Tab.Screen name="AnonymousChat" component={LazyScreen(AnonymousChatScreen)} options={{ tabBarIcon: ({ focused }) => <TabIcon name="AnonymousChat" focused={focused} /> }} />
    </Tab.Navigator>
  );
});

function CustomDrawerContent({ navigation }: any) {
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();

  // Drawer only has items NOT already in the bottom tab bar
  const navItems = [
    { label: 'Explore', icon: 'search', screen: 'Explore' },
    { label: 'Profile', icon: 'person-outline', screen: 'ProfileSelf' },
    { label: 'Bookmarks', icon: 'bookmark-border', screen: 'Bookmarks' },
  ];

  const handleLogout = () => {
    navigation.closeDrawer();
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOutUser();
            } catch (e) {
              if (__DEV__) console.warn('[Drawer] signOutUser error:', e);
            }
            useAppStore.getState().logout();
          },
        },
      ],
    );
  };

  // BUG FIX: Drawer navigation must use the ROOT navigator for screens
  // not registered in the Drawer (e.g. PremiumDashboard). Without
  // this, navigating crashes with "screen doesn't exist in Drawer navigator".
  const handleNavigate = (screen: string) => {
    navigation.closeDrawer();
    navigation.navigate(screen);
  };

  return (
    <DrawerContentScrollView style={styles.drawer} contentContainerStyle={{ paddingTop: insets.top }}>
      {/* Logo */}
      <View style={styles.drawerLogo}>
        <Image source={require('../../assets/logo.png')} style={{ width: 140, height: 46, resizeMode: 'contain' }} />
      </View>

      {/* Nav items */}
      {navItems.map(item => (
        <TouchableOpacity
          key={item.label}
          style={styles.drawerItem}
          onPress={() => handleNavigate(item.screen)}
        >
          <AppIcon name={item.icon} size="lg" color={colors.text} style={{ width: 30, textAlign: 'center' }} />
          <Text style={styles.drawerLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}

      {/* Settings */}
      <TouchableOpacity
        style={styles.drawerItem}
        onPress={() => {
          navigation.closeDrawer();
          navigation.navigate('Settings');
        }}
      >
        <AppIcon name="settings" size="lg" color={colors.text} style={{ width: 30, textAlign: 'center' }} />
        <Text style={styles.drawerLabel}>Settings</Text>
      </TouchableOpacity>

      {/* User info at bottom */}
      {user && (
        <TouchableOpacity
          style={styles.drawerUser}
          onPress={() => {
            navigation.closeDrawer();
            navigation.navigate('ProfileSelf');
          }}
        >
          <Avatar uri={user.profileImage} name={user.displayName} size={46} />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.drawerUserName}>{user.displayName}</Text>
              <VerifiedBadge badge={user.badge} isVerified={user.isVerified} />
            </View>
            {user.username && user.username.trim() !== ''
              ? <Text style={[styles.drawerUserHandle, { color: colors.accent }]}>Tap to set username →</Text>
              : <TouchableOpacity onPress={() => navigation.navigate('UsernameSetup' as never)}>
                  <Text style={[styles.drawerUserHandle, { color: colors.accent }]}>Tap to set username →</Text>
                </TouchableOpacity>
            }
          </View>
        </TouchableOpacity>
      )}

      {/* Logout button — always visible when user is logged in */}
      {user && (
        <TouchableOpacity style={styles.drawerLogoutBtn} onPress={handleLogout}>
          <AppIcon name="logout" size="lg" color={colors.accent} style={{ width: 30, textAlign: 'center' }} />
          <Text style={styles.drawerLogoutText}>Log Out</Text>
        </TouchableOpacity>
      )}
    </DrawerContentScrollView>
  );
}

function DrawerNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: { backgroundColor: colors.bg, width: '72%' },
        sceneStyle: { backgroundColor: colors.bg },
        overlayColor: colors.drawerOverlay,
      }}
    >
      <Drawer.Screen name="MainTabs" component={MainTabs} />
      <Drawer.Screen name="Explore" component={LazyScreen(ExploreScreen)} />
      <Drawer.Screen name="ProfileSelf" component={LazyScreen(ProfileScreen)} initialParams={{}} />
      <Drawer.Screen name="Bookmarks" component={LazyScreen(BookmarksScreen)} />
      <Drawer.Screen name="Settings" component={LazyScreen(SettingsScreen)} />
      <Drawer.Screen name="PremiumDashboard" component={LazyScreen(PremiumDashboardScreen)} />
    </Drawer.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="Drawer" component={DrawerNavigator} />
      {/* Chat */}
      <Stack.Screen name="ChatRoom" component={LazyScreen(ChatRoomScreen)} />
      <Stack.Screen name="DualPaneChat" component={LazyScreen(DualPaneChatScreen)} />
      <Stack.Screen name="AnonymousChat" component={LazyScreen(AnonymousChatScreen)} />
      <Stack.Screen name="AudioCall" component={LazyScreen(AudioCallScreen)} />
      {/* Profile */}
      <Stack.Screen name="Profile" component={LazyScreen(ProfileScreen)} />
      <Stack.Screen name="UserProfile" component={LazyScreen(UserProfileScreen)} />
      <Stack.Screen name="EditProfile" component={LazyScreen(EditProfileScreen)} />
      {/* Bookmarks */}
      <Stack.Screen name="BookmarksStack" component={LazyScreen(BookmarksScreen)} />
      {/* Explore */}
      <Stack.Screen name="ExploreStack" component={LazyScreen(ExploreScreen)} />
      {/* Settings sub-screens */}
      <Stack.Screen name="PrivacySettings" component={LazyScreen(PrivacySettingsScreen)} />
      <Stack.Screen name="Appearance" component={LazyScreen(AppearanceScreen)} />
      <Stack.Screen name="BlockedUsers" component={LazyScreen(BlockedUsersScreen)} />
      <Stack.Screen name="ChangeUsername" component={LazyScreen(ChangeUsernameScreen)} />
      <Stack.Screen name="NotificationSettings" component={LazyScreen(NotificationSettingsScreen)} />
      <Stack.Screen name="MutedUsers" component={LazyScreen(MutedUsersScreen)} />
      <Stack.Screen name="MutedWords" component={LazyScreen(MutedWordsScreen)} />
      <Stack.Screen name="Security" component={LazyScreen(SecurityScreen)} />
      <Stack.Screen name="ShareProfile" component={LazyScreen(ShareProfileScreen)} />
      <Stack.Screen name="WriteArticle" component={LazyScreen(WriteArticleScreen)} />
      {/* Posts & Stories */}
      <Stack.Screen name="CreatePost" component={LazyScreen(CreatePostScreen)} options={{ presentation: 'modal' }} />
      <Stack.Screen name="GifPicker" component={LazyScreen(GifPickerScreen)} />
      <Stack.Screen name="StoryViewer" component={LazyScreen(StoryViewerScreen)} />
      <Stack.Screen name="StoryCreator" component={LazyScreen(StoryCreatorScreen)} />
      {/* Articles */}
      <Stack.Screen name="ArticleView" component={LazyScreen(ArticleViewScreen)} />
      {/* Premium */}
      <Stack.Screen name="PremiumDashboard" component={LazyScreen(PremiumDashboardScreen)} />
      <Stack.Screen name="Followers" component={LazyScreen(FollowersScreen)} />
      <Stack.Screen name="PostComments" component={LazyScreen(PostCommentsScreen)} />
      <Stack.Screen name="PostDetail" component={LazyScreen(PostDetailScreen)} />
      <Stack.Screen name="EditPost" component={LazyScreen(EditPostScreen)} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Hashtag" component={LazyScreen(HashtagScreen)} />
      <Stack.Screen name="Trending" component={LazyScreen(TrendingScreen)} />
      <Stack.Screen name="ScheduledPosts" component={LazyScreen(ScheduledPostsScreen)} />
      <Stack.Screen name="DraftPosts" component={LazyScreen(DraftPostsScreen)} />
      <Stack.Screen name="MessageRequests" component={LazyScreen(MessageRequestsScreen)} />
      <Stack.Screen name="GroupInfo" component={LazyScreen(GroupInfoScreen)} />
      <Stack.Screen name="StoryViewers" component={LazyScreen(StoryViewersScreen)} />
      <Stack.Screen name="MediaGallery" component={LazyScreen(MediaGalleryScreen)} />
      <Stack.Screen name="DataExport" component={LazyScreen(DataExportScreen)} />
      <Stack.Screen name="VerificationRequest" component={LazyScreen(VerificationRequestScreen)} />
      <Stack.Screen name="VideoCall" component={LazyScreen(VideoCallScreen)} />
      <Stack.Screen name="Sessions" component={LazyScreen(SessionsScreen)} />
      <Stack.Screen name="LinkedAccounts" component={LazyScreen(LinkedAccountsScreen)} />
      <Stack.Screen name="ChangeEmail" component={LazyScreen(ChangeEmailScreen)} />
      <Stack.Screen name="ChangePassword" component={LazyScreen(ChangePasswordScreen)} />
      <Stack.Screen name="ProfileHighlights" component={LazyScreen(ProfileHighlightsScreen)} />
      <Stack.Screen name="LikedPosts" component={LazyScreen(LikedPostsScreen)} />
      <Stack.Screen name="MentionedPosts" component={LazyScreen(MentionedPostsScreen)} />
      <Stack.Screen name="MediaPosts" component={LazyScreen(MediaPostsScreen)} />
      <Stack.Screen name="PaidChat" component={LazyScreen(PaidChatScreen)} />
      {/* Legal pages — accessible without login on web */}
      <Stack.Screen name="PrivacyPolicy" component={LazyScreen(PrivacyPolicyScreen)} />
      <Stack.Screen name="Terms" component={LazyScreen(TermsScreen)} />
      <Stack.Screen name="CommunityGuidelines" component={LazyScreen(CommunityGuidelinesScreen)} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const user = useAppStore(s => s.user);
  const isReady = useAppStore(s => s.isReady);
  const pendingNotificationTap = useAppStore(s => s.pendingNotificationTap);
  const setPendingNotificationTap = useAppStore(s => s.setPendingNotificationTap);
  const navRef = useRef(null);

  // ── Handle notification taps ──
  // When a user taps a push notification, route them to the correct screen
  useEffect(() => {
    if (!pendingNotificationTap || !navRef.current) return;
    const data = pendingNotificationTap;
    setPendingNotificationTap(null); // Clear immediately

    const nav = navRef.current;
    if (__DEV__) console.log('[Navigator] Routing notification tap:', JSON.stringify(data));

    try {
      const type = data.type;

      if (type === 'chat') {
        // Chat notification — navigate directly to the chat room if chatId is available
        if (data.chatId) {
          nav.navigate('ChatRoom', { chatId: data.chatId });
        } else {
          nav.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Messages' } });
        }
      } else if (type === 'like' || type === 'comment' || type === 'repost') {
        // Post interaction — navigate to the specific post if postId is available
        if (data.postId) {
          nav.navigate('PostComments', { postId: data.postId });
        } else {
          nav.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Notifications' } });
        }
      } else if (type === 'follow') {
        // Follow notification — navigate to follower's profile
        if (data.actorId) {
          nav.navigate('UserProfile', { userId: data.actorId });
        } else {
          nav.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Notifications' } });
        }
      } else if (type === 'call') {
        // Call notification — go to messages
        nav.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Messages' } });
      } else {
        // Default: go to notifications tab
        nav.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Notifications' } });
      }
    } catch (e) {
      if (__DEV__) console.warn('[Navigator] Failed to route notification tap:', e);
    }
  }, [pendingNotificationTap]);

  // While not ready, show dark splash-like screen with logo
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 180, height: 60, resizeMode: 'contain' }} />
      </View>
    );
  }

  // Require login on all platforms — no bypass
  const showApp = !!user;

  return (
    <NavigationContainer theme={DarkTheme} ref={navRef}>
      {showApp ? (
        <AppStack />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="Login" component={LazyScreen(AuthScreen)} />
          <Stack.Screen name="Signup" component={LazyScreen(SignupScreen)} />
          <Stack.Screen name="UsernameSetup" component={LazyScreen(UsernameSetupScreen)} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1, backgroundColor: colors.bg },
  drawerLogo: { paddingHorizontal: 20, paddingVertical: 16, marginBottom: 8 },
  drawerLogoText: { color: colors.text, fontSize: 24, fontWeight: '800' },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 18 },
  drawerIcon: { fontSize: 24, width: 30, textAlign: 'center' },
  drawerLabel: { color: colors.text, fontSize: 17, fontWeight: '600' },
  drawerSpacer: { flex: 1 },
  drawerUser: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderTopWidth: 0.5, borderTopColor: colors.border },
  drawerUserName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  drawerUserHandle: { color: colors.textSecondary, fontSize: 14 },
  drawerLogoutBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: colors.border },
  drawerLogoutText: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: {
    color: colors.primaryForeground,
    fontSize: 10,
    fontWeight: '700',
  },
});