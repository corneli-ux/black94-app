import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, firestore, getValidToken } from '../lib/firebase';
import { fetchUserProfile, User } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';

type Role = 'personal' | 'creator' | 'professional' | 'business';

const ROLE_OPTIONS: { key: Role; label: string; description: string }[] = [
  { key: 'personal', label: 'Personal', description: 'For personal use' },
  { key: 'creator', label: 'Creator', description: 'Content creators & influencers' },
  { key: 'professional', label: 'Professional', description: 'Professional accounts' },
  { key: 'business', label: 'Business', description: 'For businesses & brands' },
];

const BIO_MAX_LENGTH = 160;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

const STORAGE_BASE = 'https://firebasestorage.googleapis.com/v0/b/black94.appspot.com/o';

async function uploadImage(uri: string, storagePath: string): Promise<string> {
  const token = await getValidToken();
  // Convert URI to blob
  const response = await fetch(uri);
  const blob = await response.blob();

  // Upload to Firebase Storage via REST
  const uploadResp = await fetch(
    `${STORAGE_BASE}/${encodeURIComponent(storagePath)}?uploadType=media&name=${encodeURIComponent(storagePath)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'image/jpeg',
        'Authorization': `Bearer ${token}`,
      },
      body: blob,
    },
  );

  if (!uploadResp.ok) throw new Error('Image upload failed');

  // Return public URL
  return `https://firebasestorage.googleapis.com/v0/b/black94.appspot.com/o/${encodeURIComponent(storagePath)}?alt=media`;
}

// Lazy image picker (avoid crash if library not linked)
async function openImageLibrary() {
  try {
    const { launchImageLibrary } = require('expo-image-picker');
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1080,
      maxHeight: 1080,
    });
    return result;
  } catch (err) {
    console.warn('[EditProfileScreen] Image picker not available:', err);
    return null;
  }
}

export default function EditProfileScreen({ navigation }: any) {
  const currentUid = auth()?.currentUser?.uid ?? '';
  const { setUser: setGlobalUser } = useAppStore();

  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [profileImage, setProfileImage] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [role, setRole] = useState<Role>('personal');
  const [saving, setSaving] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={styles.saveButton}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      ),
    });
  }, [navigation, saving, displayName, username, bio, profileImage, coverImage, role]);

  useEffect(() => {
    const loadUser = async () => {
      if (!currentUid) return;
      const userData = await fetchUserProfile(currentUid);
      if (userData) {
        setUser(userData);
        setDisplayName(userData.displayName);
        setUsername(userData.username);
        setBio(userData.bio);
        setProfileImage(userData.profileImage || '');
        setCoverImage(userData.coverImage || '');
        setRole((userData.role as Role) || 'personal');
      }
    };
    loadUser();
  }, [currentUid]);

  const checkUsername = useCallback(
    async (value: string) => {
      setUsername(value);
      if (!value || value === user?.username) {
        setUsernameAvailable(null);
        return;
      }
      if (!USERNAME_REGEX.test(value)) {
        setUsernameAvailable(false);
        return;
      }
      setUsernameChecking(true);
      try {
        const snap = await firestore().collection('usernames').doc(value.toLowerCase()).get();
        const exists = snap.exists;
        // If the doc exists and belongs to someone else, it's taken
        setUsernameAvailable(!exists);
      } catch {
        setUsernameAvailable(false);
      }
      setUsernameChecking(false);
    },
    [user?.username],
  );

  const pickImage = useCallback(
    async (type: 'profile' | 'cover') => {
      try {
        const result = await openImageLibrary();
        if (!result) return;
        if (result.assets && result.assets.length > 0) {
          const uri = result.assets[0].uri ?? '';
          if (type === 'profile') {
            setProfileImage(uri);
          } else {
            setCoverImage(uri);
          }
        }
      } catch (e) {
        console.warn('[EditProfileScreen] image picker error:', e);
      }
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!currentUid) return;
    if (!displayName.trim()) {
      Alert.alert('Error', 'Display name is required');
      return;
    }
    if (username !== user?.username) {
      if (!USERNAME_REGEX.test(username)) {
        Alert.alert('Error', 'Username must be 3-20 characters (letters, numbers, underscores)');
        return;
      }
      if (!usernameAvailable) {
        Alert.alert('Error', 'This username is not available');
        return;
      }
    }
    if (role === 'business' && user?.role !== 'business') {
      Alert.alert(
        'Warning',
        'Once you switch to Business account, you cannot change back. Are you sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', style: 'destructive', onPress: () => performSave() },
        ],
      );
      return;
    }

    performSave();
  }, [currentUid, displayName, username, bio, profileImage, coverImage, role, user, usernameAvailable]);

  const performSave = useCallback(async () => {
    if (!currentUid) return;
    setSaving(true);
    try {
      let finalProfileImage = profileImage;
      let finalCoverImage = coverImage;

      // Upload images if they are local URIs
      if (profileImage && !profileImage.startsWith('http')) {
        finalProfileImage = await uploadImage(
          profileImage,
          `users/${currentUid}/profile/${Date.now()}.jpg`,
        );
      }
      if (coverImage && !coverImage.startsWith('http')) {
        finalCoverImage = await uploadImage(
          coverImage,
          `users/${currentUid}/cover/${Date.now()}.jpg`,
        );
      }

      // Update username if changed
      if (username !== user?.username) {
        const oldUsername = user?.username?.toLowerCase();
        if (oldUsername) {
          try { await firestore().collection('usernames').doc(oldUsername).delete(); } catch {}
        }
        try {
          await firestore().collection('usernames').doc(username.toLowerCase()).set({ uid: currentUid });
        } catch {}
      }

      // Update user profile
      await firestore().collection('users').doc(currentUid).update({
        displayName: displayName.trim(),
        username: username,
        usernameLower: username.toLowerCase(),
        bio: bio.trim(),
        profileImage: finalProfileImage,
        coverImage: finalCoverImage,
        role,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      Alert.alert('Success', 'Profile updated successfully', [
        { text: 'OK', onPress: () => {
          // Update Zustand store so sidebar/drawer shows the new profile info immediately
          setGlobalUser({
            id: currentUid,
            email: user?.email || '',
            username: username,
            displayName: displayName.trim(),
            bio: bio.trim(),
            profileImage: finalProfileImage,
            coverImage: finalCoverImage,
            role,
            badge: user?.badge || '',
            subscription: user?.subscription || 'free',
            isVerified: user?.isVerified || false,
            createdAt: user?.createdAt || Date.now(),
          });
          navigation.navigate('Profile');
        }},
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update profile');
    }
    setSaving(false);
  }, [currentUid, displayName, username, bio, profileImage, coverImage, role, user, navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Profile Image */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={() => pickImage('profile')} activeOpacity={0.8}>
              <Image
                source={
                  profileImage
                    ? { uri: profileImage }
                    : { uri: 'https://via.placeholder.com/200/333/ccc?text=A' }
                }
                style={styles.avatarImage}
              />
              <View style={styles.avatarEditOverlay}>
                <Text style={styles.avatarEditText}>📷</Text>
              </View>
            </TouchableOpacity>
            <Text style={styles.avatarLabel}>Profile Photo</Text>
          </View>

          {/* Cover Image */}
          <View style={styles.coverSection}>
            <TouchableOpacity
              style={styles.coverPicker}
              onPress={() => pickImage('cover')}
              activeOpacity={0.8}
            >
              {coverImage ? (
                <Image source={{ uri: coverImage }} style={styles.coverPreview} resizeMode="cover" />
              ) : (
                <View style={styles.coverPlaceholder}>
                  <Text style={styles.coverPlaceholderText}>+ Add Cover Image</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Display Name */}
          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>Display Name</Text>
            <TextInput
              style={styles.textInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Enter display name"
              placeholderTextColor={colors.textMuted}
              maxLength={50}
              autoCapitalize="words"
            />
          </View>

          {/* Username */}
          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>Username</Text>
            <View style={styles.usernameInputContainer}>
              <Text style={styles.usernamePrefix}>@</Text>
              <TextInput
                style={[styles.textInput, styles.usernameInput]}
                value={username}
                onChangeText={checkUsername}
                placeholder="username"
                placeholderTextColor={colors.textMuted}
                maxLength={20}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {usernameChecking && (
                <ActivityIndicator size="small" color={colors.textMuted} style={styles.usernameCheck} />
              )}
              {!usernameChecking && usernameAvailable === true && (
                <Text style={styles.availableText}>✓</Text>
              )}
              {!usernameChecking && usernameAvailable === false && (
                <Text style={styles.takenText}>✗</Text>
              )}
            </View>
            {usernameAvailable === false && (
              <Text style={styles.errorText}>This username is taken or invalid</Text>
            )}
          </View>

          {/* Bio */}
          <View style={styles.fieldSection}>
            <View style={styles.bioLabelRow}>
              <Text style={styles.fieldLabel}>Bio</Text>
              <Text style={styles.bioCount}>{bio.length}/{BIO_MAX_LENGTH}</Text>
            </View>
            <TextInput
              style={[styles.textInput, styles.bioInput]}
              value={bio}
              onChangeText={(text) => setBio(text.slice(0, BIO_MAX_LENGTH))}
              placeholder="Tell us about yourself"
              placeholderTextColor={colors.textMuted}
              maxLength={BIO_MAX_LENGTH}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Role Selector */}
          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>Account Type</Text>
            <Text style={styles.roleDescription}>Choose your account type</Text>
            <View style={styles.roleList}>
              {ROLE_OPTIONS.map((opt) => {
                const isSelected = role === opt.key;
                const isDisabled = user?.role === 'business' && opt.key !== 'business';

                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.roleItem,
                      isSelected && styles.roleItemSelected,
                      isDisabled && styles.roleItemDisabled,
                    ]}
                    onPress={() => !isDisabled && setRole(opt.key)}
                    activeOpacity={isDisabled ? 1 : 0.7}
                    disabled={isDisabled}
                  >
                    <View style={[styles.roleRadio, isSelected && styles.roleRadioSelected]}>
                      {isSelected && <View style={styles.roleRadioInner} />}
                    </View>
                    <View style={styles.roleTextContainer}>
                      <Text
                        style={[
                          styles.roleName,
                          isSelected && styles.roleNameSelected,
                          isDisabled && styles.roleNameDisabled,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text style={styles.roleDesc}>{opt.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {user?.role === 'business' && (
              <Text style={styles.businessWarning}>
                ⚠️ Business accounts cannot be changed to other types
              </Text>
            )}
          </View>

          {/* Badge Display */}
          {user?.badge && (
            <View style={styles.badgeSection}>
              <Text style={styles.fieldLabel}>Current Badge</Text>
              <View style={[styles.badgeDisplay, user.badge === 'gold' ? styles.badgeGold : styles.badgeBlue]}>
                <Text style={styles.badgeEmoji}>{user.badge === 'gold' ? '★' : '●'}</Text>
                <Text style={styles.badgeText}>
                  {user.badge === 'gold' ? 'Gold Verified' : 'Blue Verified'}
                </Text>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
  avatarSection: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 9999,
    backgroundColor: colors.surfaceLight,
  },
  avatarEditOverlay: {
    position: 'absolute',
    bottom: 0,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarEditText: {
    fontSize: 14,
  },
  avatarLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  coverSection: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  coverPicker: {
    borderRadius: 10,
    overflow: 'hidden',
    height: 120,
  },
  coverPreview: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  fieldSection: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  usernameInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  usernamePrefix: {
    fontSize: 15,
    color: colors.textMuted,
    marginRight: 4,
  },
  usernameInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 12,
  },
  usernameCheck: {
    marginRight: 8,
  },
  availableText: {
    fontSize: 16,
    color: colors.accentGreen,
    marginRight: 8,
  },
  takenText: {
    fontSize: 16,
    color: colors.error,
    marginRight: 8,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  bioLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bioCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  roleDescription: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  roleList: {
    gap: 8,
  },
  roleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleItemSelected: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}15`,
  },
  roleItemDisabled: {
    opacity: 0.5,
  },
  roleRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleRadioSelected: {
    borderColor: colors.accent,
  },
  roleRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  roleTextContainer: {
    flex: 1,
  },
  roleName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  roleNameSelected: {
    color: colors.accent,
  },
  roleNameDisabled: {
    color: colors.textMuted,
  },
  roleDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  businessWarning: {
    fontSize: 12,
    color: colors.accentGold,
    marginTop: 8,
  },
  badgeSection: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  badgeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
  },
  badgeGold: {
    borderWidth: 1,
    borderColor: colors.accentGold,
  },
  badgeBlue: {
    borderWidth: 1,
    borderColor: colors.verified,
  },
  badgeEmoji: {
    fontSize: 18,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
});
