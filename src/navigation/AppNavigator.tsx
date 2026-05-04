import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import FeedScreen from '../screens/FeedScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatRoomScreen from '../screens/ChatRoomScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import StoriesScreen from '../screens/StoriesScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import BookmarksScreen from '../screens/BookmarksScreen';
import ExploreScreen from '../screens/ExploreScreen';
import PrivacySettingsScreen from '../screens/PrivacySettingsScreen';
import WriteArticleScreen from '../screens/WriteArticleScreen';
import ShareProfileScreen from '../screens/ShareProfileScreen';
import StorefrontScreen from '../screens/StorefrontScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import MyStoreScreen from '../screens/MyStoreScreen';
import AddProductScreen from '../screens/AddProductScreen';
import BusinessDashboardScreen from '../screens/BusinessDashboardScreen';
import AdsManagerScreen from '../screens/AdsManagerScreen';
import CreateAdScreen from '../screens/CreateAdScreen';
import SalaryScreen from '../screens/SalaryScreen';
import AffiliatesScreen from '../screens/AffiliatesScreen';
import PerformanceScreen from '../screens/PerformanceScreen';
import OrderTrackingScreen from '../screens/OrderTrackingScreen';
import StoreDashboardScreen from '../screens/StoreDashboardScreen';
import BusinessOrdersScreen from '../screens/BusinessOrdersScreen';
import PremiumDashboardScreen from '../screens/PremiumDashboardScreen';
import AuthScreen from '../screens/AuthScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import StoryViewerScreen from '../screens/StoryViewerScreen';
import StoryCreatorScreen from '../screens/StoryCreatorScreen';
import CreatePostScreen from '../screens/CreatePostScreen';
import ArticleViewScreen from '../screens/ArticleViewScreen';
import AudioCallScreen from '../screens/AudioCallScreen';
import AnonymousChatScreen from '../screens/AnonymousChatScreen';
import DualPaneChatScreen from '../screens/DualPaneChatScreen';
import CrmLeadsScreen from '../screens/CrmLeadsScreen';
import CrmDealsScreen from '../screens/CrmDealsScreen';
import CrmOrdersScreen from '../screens/CrmOrdersScreen';
import CrmAnalyticsScreen from '../screens/CrmAnalyticsScreen';

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const iconProps: { size: number; color: string } = {
    size: 24,
    color: '#ffffff',
  };

  // Match web's Lucide icons with Ionicons equivalents
  switch (name) {
    case 'Home':
      return (
        <Ionicons
          {...iconProps}
          name={focused ? 'home' : 'home-outline'}
          strokeWidth={focused ? 2.4 : 2.2}
        />
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
    case 'Stories':
      return (
        <Ionicons
          {...iconProps}
          name={focused ? 'radio' : 'radio-outline'}
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
  const { unreadNotificationCount, user } = useAppStore();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + (insets.bottom || 0);
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#000000',
          borderTopWidth: 0.5,
          borderTopColor: 'rgba(255,255,255,0.06)',
          paddingTop: 6,
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
    </Tab.Navigator>
  );
}

function CustomDrawerContent({ navigation }: any) {
  const { user } = useAppStore();

  const navItems = [
    { label: 'Home', icon: 'home-outline', screen: 'Home' },
    { label: 'Explore', icon: 'search-outline', screen: 'Explore' },
    { label: 'Notifications', icon: 'notifications-outline', screen: 'NotificationsTab' },
    { label: 'Messages', icon: 'chatbubble-outline', screen: 'MessagesTab' },
    { label: 'Stories', icon: 'radio-outline', screen: 'StoriesTab' },
    { label: 'Profile', icon: 'person-outline', screen: 'ProfileSelf' },
    { label: 'Bookmarks', icon: 'bookmark-outline', screen: 'Bookmarks' },
    { label: 'Cart', icon: 'cart-outline', screen: 'Cart' },
    { label: 'Settings', icon: 'settings-outline', screen: 'Settings' },
  ];

  return (
    <DrawerContentScrollView style={styles.drawer} contentContainerStyle={{ paddingTop: 0 }}>
      {/* Logo */}
      <View style={styles.drawerLogo}>
        <Text style={styles.drawerLogoText}>Black94</Text>
      </View>

      {/* Nav items */}
      {navItems.map(item => (
        <TouchableOpacity
          key={item.label}
          style={styles.drawerItem}
          onPress={() => {
            navigation.closeDrawer();
            navigation.navigate(item.screen);
          }}
        >
          <Ionicons name={item.icon as any} size={22} color={colors.text} style={{ width: 30, textAlign: 'center' }} />
          <Text style={styles.drawerLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}

      <View style={styles.drawerSpacer} />

      {/* User info at bottom */}
      {user && (
        <TouchableOpacity
          style={styles.drawerUser}
          onPress={() => {
            navigation.closeDrawer();
            navigation.navigate('ProfileSelf');
          }}
        >
          <Avatar uri={user.profileImage} size={46} />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.drawerUserName}>{user.displayName}</Text>
              {user.isVerified && (
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.verifiedGold, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#000', fontSize: 9, fontWeight: '900' }}>✓</Text>
                </View>
              )}
            </View>
            <Text style={styles.drawerUserHandle}>@{user.username}</Text>
          </View>
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
        overlayColor: 'rgba(0,0,0,0.7)',
      }}
    >
      <Drawer.Screen name="MainTabs" component={MainTabs} />
      <Drawer.Screen name="Explore" component={ExploreScreen} />
      <Drawer.Screen name="NotificationsTab" component={NotificationsScreen} />
      <Drawer.Screen name="MessagesTab" component={ChatListScreen} />
      <Drawer.Screen name="StoriesTab" component={StoriesScreen} />
      <Drawer.Screen name="ProfileSelf" component={ProfileScreen} initialParams={{}} />
      <Drawer.Screen name="Bookmarks" component={BookmarksScreen} />
      <Drawer.Screen name="Cart" component={CartScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Drawer" component={DrawerNavigator} />
      {/* Chat */}
      <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
      <Stack.Screen name="DualPaneChat" component={DualPaneChatScreen} />
      <Stack.Screen name="AnonymousChat" component={AnonymousChatScreen} />
      <Stack.Screen name="AudioCall" component={AudioCallScreen} />
      {/* Profile */}
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      {/* Bookmarks */}
      <Stack.Screen name="BookmarksStack" component={BookmarksScreen} />
      {/* Explore */}
      <Stack.Screen name="ExploreStack" component={ExploreScreen} />
      {/* Settings sub-screens */}
      <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} />
      <Stack.Screen name="ShareProfile" component={ShareProfileScreen} />
      <Stack.Screen name="WriteArticle" component={WriteArticleScreen} />
      {/* Posts & Stories */}
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="StoryViewer" component={StoryViewerScreen} />
      <Stack.Screen name="StoryCreator" component={StoryCreatorScreen} />
      {/* Articles */}
      <Stack.Screen name="ArticleView" component={ArticleViewScreen} />
      {/* Store / Shop */}
      <Stack.Screen name="Storefront" component={StorefrontScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="MyStore" component={MyStoreScreen} />
      <Stack.Screen name="AddProduct" component={AddProductScreen} />
      {/* Business Tools */}
      <Stack.Screen name="BusinessDashboard" component={BusinessDashboardScreen} />
      <Stack.Screen name="AdsManager" component={AdsManagerScreen} />
      <Stack.Screen name="CreateAd" component={CreateAdScreen} />
      <Stack.Screen name="Salary" component={SalaryScreen} />
      <Stack.Screen name="Affiliates" component={AffiliatesScreen} />
      <Stack.Screen name="Performance" component={PerformanceScreen} />
      {/* CRM */}
      <Stack.Screen name="CrmLeads" component={CrmLeadsScreen} />
      <Stack.Screen name="CrmDeals" component={CrmDealsScreen} />
      <Stack.Screen name="CrmOrders" component={CrmOrdersScreen} />
      <Stack.Screen name="CrmAnalytics" component={CrmAnalyticsScreen} />
      {/* Order Tracking & Store */}
      <Stack.Screen name="OrderTracking" component={OrderTrackingScreen} />
      <Stack.Screen name="StoreDashboard" component={StoreDashboardScreen} />
      <Stack.Screen name="BusinessOrders" component={BusinessOrdersScreen} />
      {/* Premium */}
      <Stack.Screen name="PremiumDashboard" component={PremiumDashboardScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { user, isReady } = useAppStore();

  // While not ready, show dark splash-like screen
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#e7e9ea', fontSize: 28, fontWeight: '800' }}>Black94</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? (
        <AppStack />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={AuthScreen} />
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
  drawerSpacer: { flex: 1, minHeight: 40 },
  drawerUser: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderTopWidth: 0.5, borderTopColor: colors.border },
  drawerUserName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  drawerUserHandle: { color: colors.textSecondary, fontSize: 14 },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
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
