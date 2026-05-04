import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppStore } from '../stores/app';
import { Avatar } from '../components/Avatar';

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

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: focused ? '🏠' : '🏠',
    Search: focused ? '🔍' : '🔍',
    Messages: focused ? '💬' : '💬',
    Notifications: focused ? '🔔' : '🔔',
    Stories: focused ? '📡' : '📡',
  };
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>
      {icons[name] || '●'}
    </Text>
  );
}

function MainTabs() {
  const { unreadNotificationCount } = useAppStore();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopWidth: 0.5,
          borderTopColor: colors.tabBarBorder,
          paddingTop: 6,
          height: 60,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen name="Home" component={FeedScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} /> }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Search" focused={focused} /> }} />
      <Tab.Screen name="Messages" component={ChatListScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Messages" focused={focused} /> }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{
        tabBarIcon: ({ focused }) => <TabIcon name="Notifications" focused={focused} />,
        tabBarBadge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
      }} />
      <Tab.Screen name="Stories" component={StoriesScreen} options={{ tabBarIcon: ({ focused }) => <TabIcon name="Stories" focused={focused} /> }} />
    </Tab.Navigator>
  );
}

function CustomDrawerContent({ navigation }: any) {
  const { user } = useAppStore();

  const navItems = [
    { label: 'Home', icon: '🏠', screen: 'Home' },
    { label: 'Explore', icon: '🔍', screen: 'Explore' },
    { label: 'Notifications', icon: '🔔', screen: 'NotificationsTab' },
    { label: 'Messages', icon: '💬', screen: 'MessagesTab' },
    { label: 'Stories', icon: '📡', screen: 'StoriesTab' },
    { label: 'Profile', icon: '👤', screen: 'ProfileSelf' },
    { label: 'Bookmarks', icon: '🏷️', screen: 'Bookmarks' },
    { label: 'Cart', icon: '🛒', screen: 'Cart' },
    { label: 'Settings', icon: '⚙️', screen: 'Settings' },
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
          <Text style={styles.drawerIcon}>{item.icon}</Text>
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
      {/* Profile (other users) */}
      <Stack.Screen name="Profile" component={ProfileScreen} />
      {/* Bookmarks */}
      <Stack.Screen name="BookmarksStack" component={BookmarksScreen} />
      {/* Explore */}
      <Stack.Screen name="ExploreStack" component={ExploreScreen} />
      {/* Settings sub-screens */}
      <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} />
      <Stack.Screen name="ShareProfile" component={ShareProfileScreen} />
      <Stack.Screen name="WriteArticle" component={WriteArticleScreen} />
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
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { user, isReady } = useAppStore();

  // While not ready, show dark splash-like screen
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#07060b', alignItems: 'center', justifyContent: 'center' }}>
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
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
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
});
