import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { signOutUser } from '../lib/api';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

/* ── Dark Navigation Theme — prevents white flash on transitions ── */
const DarkTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: '#FFFFFF',
    background: '#000000',
    card: '#000000',
    text: '#e7e9ea',
    border: 'rgba(255,255,255,0.06)',
    notification: '#FFFFFF',
  },
  fonts: {
    regular: { fontFamily: 'Roboto-Regular', fontWeight: '400' as const },
    medium: { fontFamily: 'Roboto-Medium', fontWeight: '500' as const },
    bold: { fontFamily: 'Roboto-Bold', fontWeight: '700' as const },
    heavy: { fontFamily: 'Roboto-Bold', fontWeight: '900' as const },
  },
};

import { colors } from '../theme/colors';

// Keep tab screens as eager imports
import FeedScreen from '../screens/FeedScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatListScreen from '../screens/ChatListScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import StoriesScreen from '../screens/StoriesScreen';
import AnonymousChatScreen from '../screens/AnonymousChatScreen';

// Lazy load all other screens
const ChatRoomScreen = lazy(() => import('../screens/ChatRoomScreen'));
const ProfileScreen = lazy(() => import('../screens/ProfileScreen'));
const SettingsScreen = lazy(() => import('../screens/SettingsScreen'));
const BookmarksScreen = lazy(() => import('../screens/BookmarksScreen'));
const ExploreScreen = lazy(() => import('../screens/ExploreScreen'));
const PrivacySettingsScreen = lazy(() => import('../screens/PrivacySettingsScreen'));
const WriteArticleScreen = lazy(() => import('../screens/WriteArticleScreen'));
const ShareProfileScreen = lazy(() => import('../screens/ShareProfileScreen'));
const StorefrontScreen = lazy(() => import('../screens/StorefrontScreen'));
const ProductDetailScreen = lazy(() => import('../screens/ProductDetailScreen'));
const CartScreen = lazy(() => import('../screens/CartScreen'));
const CheckoutScreen = lazy(() => import('../screens/CheckoutScreen'));
const MyStoreScreen = lazy(() => import('../screens/MyStoreScreen'));
const AddProductScreen = lazy(() => import('../screens/AddProductScreen'));
const BusinessDashboardScreen = lazy(() => import('../screens/BusinessDashboardScreen'));
const AdsManagerScreen = lazy(() => import('../screens/AdsManagerScreen'));
const CreateAdScreen = lazy(() => import('../screens/CreateAdScreen'));
const SalaryScreen = lazy(() => import('../screens/SalaryScreen'));
const AffiliatesScreen = lazy(() => import('../screens/AffiliatesScreen'));
const PerformanceScreen = lazy(() => import('../screens/PerformanceScreen'));
const OrderTrackingScreen = lazy(() => import('../screens/OrderTrackingScreen'));
const StoreDashboardScreen = lazy(() => import('../screens/StoreDashboardScreen'));
const BusinessOrdersScreen = lazy(() => import('../screens/BusinessOrdersScreen'));
const PremiumDashboardScreen = lazy(() => import('../screens/PremiumDashboardScreen'));
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
const CrmLeadsScreen = lazy(() => import('../screens/CrmLeadsScreen'));
const CrmDealsScreen = lazy(() => import('../screens/CrmDealsScreen'));
const CrmOrdersScreen = lazy(() => import('../screens/CrmOrdersScreen'));
const CrmAnalyticsScreen = lazy(() => import('../screens/CrmAnalyticsScreen'));
const FollowersScreen = lazy(() => import('../screens/FollowersScreen'));
const PostCommentsScreen = lazy(() => import('../screens/PostCommentsScreen'));
const PaidChatScreen = lazy(() => import('../screens/PaidChatScreen'));
const AssignBadgeScreen = lazy(() => import('../screens/AssignBadgeScreen'));
const PrivacyPolicyScreen = lazy(() => import('../screens/PrivacyPolicyScreen'));
const TermsScreen = lazy(() => import('../screens/TermsScreen'));
const SignupScreen = lazy(() => import('../screens/SignupScreen'));

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function LazyFallback() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#FFFFFF" size="large" />
    </View>
  );
}

function LazyScreen(Component: any) {
  return function Wrapped(props: any) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const iconProps: { size: number; color: string } = {
    size: 24,
    color: '#ffffff',
  };

  // Match web's Lucide icons with Ionicons equivalents
  switch (name) {
    case 'Home':
      return (
        <Text style={{ fontSize: 20, fontWeight: '900', color: '#ffffff' }}>94</Text>
      );
    case 'Search':
      return (
        <Ionicons
          {...iconProps}
          name={focused ? 'search' : 'search-outline'}
        />
      );
    case 'Messages':
      return (
        <Ionicons
          {...iconProps}
          name={focused ? 'chatbubble' : 'chatbubble-outline'}
        />
      );
    case 'Notifications':
      return (
        <Ionicons
          {...iconProps}
          name={focused ? 'notifications' : 'notifications-outline'}
        />
      );
    case 'AnonymousChat':
      return (
        <MaterialCommunityIcons
          {...iconProps}
          name={focused ? 'incognito' : 'incognito'}
        />
      );
    case 'Stories':
      return (
        <Ionicons
          {...iconProps}
          name={focused ? 'add-circle' : 'add-circle-outline'}
        />
      );
    default:
      return <Ionicons {...iconProps} name="ellipse" />;
  }
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

function MainTabs() {
  const unreadNotificationCount = useAppStore(s => s.unreadNotificationCount);
  const insets = useSafeAreaInsets();
  const tabBarHeight = 50 + (insets.bottom || 0);
  return (
    <Tab.Navigator
      screenOptions={{
        lazy: true,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#000000',
          borderTopWidth: 0.5,
          borderTopColor: 'rgba(255,255,255,0.06)',
          height: tabBarHeight,
          paddingBottom: insets.bottom || 0,
          elevation: 8,
        },
        tabBarShowLabel: false,
        sceneStyle: { paddingBottom: tabBarHeight },
      }}
    >
      <Tab.Screen name="Home" component={FeedScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} /> }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Search" focused={focused} /> }} />
      <Tab.Screen name="Messages" component={ChatListScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Messages" focused={focused} /> }} />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <View>
              <TabIcon name="Notifications" focused={focused} />
              <TabBarBadge count={unreadNotificationCount} />
            </View>
          ),
        }}
      />
      <Tab.Screen name="Stories" component={StoriesScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Stories" focused={focused} /> }} />
      <Tab.Screen name="AnonymousChat" component={AnonymousChatScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="AnonymousChat" focused={focused} /> }} />
    </Tab.Navigator>
  );
}

function CustomDrawerContent({ navigation }: any) {
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();

  // Drawer only has items NOT already in the bottom tab bar
  const isBusiness = user?.role === 'business';
  const navItems = [
    { label: 'Explore', icon: 'search-outline', screen: 'Explore' },
    { label: 'Profile', icon: 'person-outline', screen: 'ProfileSelf' },
    { label: 'Bookmarks', icon: 'bookmark-outline', screen: 'Bookmarks' },
    ...(isBusiness ? [{ label: 'My Store', icon: 'storefront-outline', screen: 'MyStoreStack' }] : []),
    { label: 'Upgrade', icon: 'diamond-outline', screen: 'PremiumDashboard' },
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
              console.warn('[Drawer] signOutUser error:', e);
            }
            useAppStore.getState().logout();
          },
        },
      ],
    );
  };

  // BUG FIX: Drawer navigation must use the ROOT navigator for screens
  // not registered in the Drawer (MyStore, PremiumDashboard). Without
  // this, navigating crashes with "screen doesn't exist in Drawer navigator".
  const handleNavigate = (screen: string) => {
    navigation.closeDrawer();
    navigation.navigate(screen);
  };

  return (
    <DrawerContentScrollView style={styles.drawer} contentContainerStyle={{ paddingTop: insets.top }}>
      {/* Logo */}
      <View style={styles.drawerLogo}>
        <Image source={require('../../assets/logo.png')} style={{ width: 160, height: 52, resizeMode: 'contain' }} />
      </View>

      {/* Nav items */}
      {navItems.map(item => (
        <TouchableOpacity
          key={item.label}
          style={styles.drawerItem}
          onPress={() => handleNavigate(item.screen)}
        >
          <Ionicons name={item.icon as any} size={22} color={colors.text} style={{ width: 30, textAlign: 'center' }} />
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
        <Ionicons name="settings-outline" size={22} color={colors.text} style={{ width: 30, textAlign: 'center' }} />
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
            <Text style={styles.drawerUserHandle}>@{user.username}</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Logout button — always visible when user is logged in */}
      {user && (
        <TouchableOpacity style={styles.drawerLogoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#D4AF37" style={{ width: 30, textAlign: 'center' }} />
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
        sceneStyle: { backgroundColor: '#000000' },
        overlayColor: 'rgba(0,0,0,0.7)',
      }}
    >
      <Drawer.Screen name="MainTabs" component={MainTabs} />
      <Drawer.Screen name="Explore" component={LazyScreen(ExploreScreen)} />
      <Drawer.Screen name="ProfileSelf" component={LazyScreen(ProfileScreen)} initialParams={{}} />
      <Drawer.Screen name="Bookmarks" component={LazyScreen(BookmarksScreen)} />
      <Drawer.Screen name="Cart" component={LazyScreen(CartScreen)} />
      <Drawer.Screen name="Settings" component={LazyScreen(SettingsScreen)} />
      {/* BUG FIX: Register MyStoreStack and PremiumDashboard in Drawer.Navigator.
         Without these, business users tapping "My Store" or "Upgrade" from the
         drawer crash with "screen doesn't exist in Drawer navigator". */}
      <Drawer.Screen name="MyStoreStack" component={LazyScreen(MyStoreScreen)} />
      <Drawer.Screen name="PremiumDashboard" component={LazyScreen(PremiumDashboardScreen)} />
    </Drawer.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000000' } }}>
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
      <Stack.Screen name="ShareProfile" component={LazyScreen(ShareProfileScreen)} />
      <Stack.Screen name="WriteArticle" component={LazyScreen(WriteArticleScreen)} />
      {/* Posts & Stories */}
      <Stack.Screen name="CreatePost" component={LazyScreen(CreatePostScreen)} options={{ presentation: 'modal' }} />
      <Stack.Screen name="GifPicker" component={LazyScreen(GifPickerScreen)} />
      <Stack.Screen name="StoryViewer" component={LazyScreen(StoryViewerScreen)} />
      <Stack.Screen name="StoryCreator" component={LazyScreen(StoryCreatorScreen)} />
      {/* Articles */}
      <Stack.Screen name="ArticleView" component={LazyScreen(ArticleViewScreen)} />
      {/* Store / Shop */}
      <Stack.Screen name="Storefront" component={LazyScreen(StorefrontScreen)} />
      <Stack.Screen name="ProductDetail" component={LazyScreen(ProductDetailScreen)} />
      <Stack.Screen name="Checkout" component={LazyScreen(CheckoutScreen)} />
      <Stack.Screen name="MyStore" component={LazyScreen(MyStoreScreen)} />
      <Stack.Screen name="AddProduct" component={LazyScreen(AddProductScreen)} />
      {/* Business Tools */}
      <Stack.Screen name="BusinessDashboard" component={LazyScreen(BusinessDashboardScreen)} />
      <Stack.Screen name="AdsManager" component={LazyScreen(AdsManagerScreen)} />
      <Stack.Screen name="CreateAd" component={LazyScreen(CreateAdScreen)} />
      <Stack.Screen name="Salary" component={LazyScreen(SalaryScreen)} />
      <Stack.Screen name="Affiliates" component={LazyScreen(AffiliatesScreen)} />
      <Stack.Screen name="AssignBadge" component={LazyScreen(AssignBadgeScreen)} />
      <Stack.Screen name="Performance" component={LazyScreen(PerformanceScreen)} />
      {/* CRM */}
      <Stack.Screen name="CrmLeads" component={LazyScreen(CrmLeadsScreen)} />
      <Stack.Screen name="CrmDeals" component={LazyScreen(CrmDealsScreen)} />
      <Stack.Screen name="CrmOrders" component={LazyScreen(CrmOrdersScreen)} />
      <Stack.Screen name="CrmAnalytics" component={LazyScreen(CrmAnalyticsScreen)} />
      {/* Order Tracking & Store */}
      <Stack.Screen name="OrderTracking" component={LazyScreen(OrderTrackingScreen)} />
      <Stack.Screen name="StoreDashboard" component={LazyScreen(StoreDashboardScreen)} />
      <Stack.Screen name="BusinessOrders" component={LazyScreen(BusinessOrdersScreen)} />
      {/* Premium */}
      <Stack.Screen name="PremiumDashboard" component={LazyScreen(PremiumDashboardScreen)} />
      <Stack.Screen name="Followers" component={LazyScreen(FollowersScreen)} />
      <Stack.Screen name="PostComments" component={LazyScreen(PostCommentsScreen)} />
      <Stack.Screen name="PaidChat" component={LazyScreen(PaidChatScreen)} />
      {/* Legal pages — accessible without login on web */}
      <Stack.Screen name="PrivacyPolicy" component={LazyScreen(PrivacyPolicyScreen)} />
      <Stack.Screen name="Terms" component={LazyScreen(TermsScreen)} />
    </Stack.Navigator>
  );
}

export default React.forwardRef(function AppNavigator(_props, ref) {
  const user = useAppStore(s => s.user);
  const isReady = useAppStore(s => s.isReady);
  const pendingNotificationTap = useAppStore(s => s.pendingNotificationTap);
  const setPendingNotificationTap = useAppStore(s => s.setPendingNotificationTap);
  const navRef = useRef(null);

  // Expose navigation ref to parent (App.js)
  React.useImperativeHandle(ref, () => navRef.current, []);

  // ── Handle notification taps ──
  // When a user taps a push notification, route them to the correct screen
  useEffect(() => {
    if (!pendingNotificationTap || !navRef.current) return;
    const data = pendingNotificationTap;
    setPendingNotificationTap(null); // Clear immediately

    const nav = navRef.current;
    console.log('[Navigator] Routing notification tap:', JSON.stringify(data));

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
        // Post interaction — navigate to post (if postId available) or notifications tab
        if (data.postId) {
          // Navigate to notifications tab which shows the post context
          nav.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Notifications' } });
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
      console.warn('[Navigator] Failed to route notification tap:', e);
    }
  }, [pendingNotificationTap]);

  // While not ready, show dark splash-like screen
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#e7e9ea', fontSize: 28, fontWeight: '800' }}>Black94</Text>
      </View>
    );
  }

  // On web: always show AppStack (login is hidden for payment gateway review)
  const showApp = Platform.OS === 'web' || user;

  return (
    <NavigationContainer theme={DarkTheme} ref={navRef}>
      {showApp ? (
        <AppStack />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000000' } }}>
          <Stack.Screen name="Login" component={LazyScreen(AuthScreen)} />
          <Stack.Screen name="Signup" component={LazyScreen(SignupScreen)} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1, backgroundColor: colors.bg, paddingTop: 20 },
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
  drawerLogoutText: { color: '#D4AF37', fontSize: 17, fontWeight: '600' },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '700',
  },
});
