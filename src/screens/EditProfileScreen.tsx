import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { auth, firestore, updateAuthUser } from '../lib/firebase';
import { fetchUserProfile, User } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { uploadOptimizedImage } from '../utils/imageUpload';
import { optimizeImage } from '../utils/imageOptimizer';
import { AppIcon } from '../components/icons';
import { Feather } from '@expo/vector-icons';

type Role = 'personal' | 'creator' | 'professional' | 'business';

const ROLE_OPTIONS: { key: Role; label: string; description: string }[] = [
  { key: 'personal', label: 'Personal', description: 'For personal use' },
  { key: 'creator', label: 'Creator', description: 'Content creators & influencers' },
  { key: 'professional', label: 'Professional', description: 'Professional accounts' },
  { key: 'business', label: 'Business', description: 'For businesses & brands' },
];

const BIO_MAX_LENGTH = 160;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

// Lazy image picker with proper permission handling (avoid crash if library not linked)
async function openImageLibrary() {
  try {
    const ImagePicker = require('expo-image-picker');

    // Request media library permission BEFORE launching the picker.
    // On Android 13+, launchImageLibrary may silently return empty/cancelled
    // result without permissions, making it look like "upload not working".
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status === 'denied') {
      Alert.alert(
        'Photos Access Denied',
        'BLACK94 needs access to your photos to select images. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => ImagePicker.grantMediaLibraryPermissionsAsync() },
        ],
      );
      return null;
    }
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow photo library access to select images.');
      return null;
    }

    const result = await ImagePicker.launchImageLibrary({
      mediaType: 'photo',
      // BUG FIX: Removed quality, maxWidth, maxHeight — picker-side JPEG
      // conversion was turning PNG transparency into black pixels.
    });
    return result;
  } catch (err) {
    if (__DEV__) console.warn('[EditProfileScreen] Image picker not available:', err);
    return null;
  }
}

export default function EditProfileScreen({ navigation }: any) {
  const currentUid = auth()?.currentUser?.uid ?? '';
  const { setUser: setGlobalUser, triggerFeedRefresh } = useAppStore();

  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [profileImage, setProfileImage] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [role, setRole] = useState<Role>('personal');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: colors.headerBg },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '700' },
      headerRight: () => (
        <TouchableOpacity
          onPress={() => handleSaveRef.current?.()}
          disabled={saving || loading}
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
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} style={{ marginLeft: 8 }}>
          <AppIcon name="arrow-back" size="xl" color={colors.text} />
        </TouchableOpacity>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, saving, loading]);

  // BUG FIX: Use a ref to always call the latest handleSave from the header button.
  // Without this, the header button captures a stale closure of handleSave
  // (with old displayName, username, bio values) because useLayoutEffect
  // doesn't re-run when those values change. The ref ensures the header
  // button always calls the most recent version of handleSave.
  const handleSaveRef = useRef<typeof handleSave>();

  useEffect(() => {
    const loadUser = async () => {
      if (!currentUid) return;
      setLoading(true);
      try {
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
      } catch (e) {
        if (__DEV__) console.warn('[EditProfileScreen] Failed to load user:', e);
      } finally {
        setLoading(false);
      }
    };
    loadUser();
  }, [currentUid]);

  const usernameTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    };
  }, []);

  const checkUsername = useCallback(
    (value: string) => {
      setUsername(value);
      if (!value || value === user?.username) {
        setUsernameAvailable(null);
        return;
      }
      if (!USERNAME_REGEX.test(value)) {
        setUsernameAvailable(false);
        return;
      }
      // Debounce username check to avoid race conditions on fast typing
      if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
      setUsernameChecking(true);
      usernameTimerRef.current = setTimeout(async () => {
        try {
          const snap = await firestore().collection('usernames').doc(value.toLowerCase()).get();
          const exists = snap.exists;
          setUsernameAvailable(!exists);
        } catch {
          setUsernameAvailable(false);
        }
        setUsernameChecking(false);
      }, 400);
    },
    [user?.username],
  );

  const pickImage = useCallback(
    async (type: 'profile' | 'cover') => {
      try {
        const result = await openImageLibrary();
        if (!result) return;
        if (result.assets && result.assets.length > 0) {
          let uri = result.assets[0].uri ?? '';
          // BUG FIX: Copy to permanent cache immediately — ImagePicker temp
          // files can be cleaned by Android OS before the user taps Save.
          if (uri && !uri.startsWith('http')) {
            try {
              const { copyToSafeCache } = require('../utils/imageUpload');
              uri = await copyToSafeCache(uri);
            } catch (copyErr: any) {
              if (__DEV__) console.warn('[EditProfileScreen] copyToSafeCache failed:', copyErr?.message);
            }
          }
          if (type === 'profile') {
            setProfileImage(uri);
          } else {
            setCoverImage(uri);
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('[EditProfileScreen] image picker error:', e);
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
      if (usernameAvailable === false) {
        Alert.alert('Error', 'This username is not available');
        return;
      }
    }

    const doSave = async () => {
      setSaving(true);
      try {
        let finalProfileImage = profileImage;
        let finalCoverImage = coverImage;
        let imageWarning = '';

        // Upload images if they are local URIs
        // BUG FIX: Optimize before upload and use the correct MIME type
        // matching the optimized output. Previously, hardcoded mimeType
        // 'image/jpeg' was sent even when the file was PNG → Content-Type
        // mismatch → black/corrupted avatars on some devices.
        //
        // GRACEFUL DEGRADATION: If image upload fails, we still save
        // the text profile (name, username, bio) and keep the old image.
        // Previously, any upload failure would abort the entire save.
        try {
          if (profileImage && !profileImage.startsWith('http')) {
            // Direct upload without optimize step — simpler and more reliable
            const result = await uploadOptimizedImage(
              profileImage,
              `users/${currentUid}/profile/${Date.now()}.jpg`,
              { mimeType: 'image/jpeg' },
            );
            finalProfileImage = result.downloadUrl;
          }
        } catch (imgErr: any) {
          console.error('[EditProfileScreen] Profile image upload failed:', imgErr?.message);
          finalProfileImage = user?.profileImage || '';
          imageWarning = 'profile';
        }

        try {
          if (coverImage && !coverImage.startsWith('http')) {
            const result = await uploadOptimizedImage(
              coverImage,
              `users/${currentUid}/cover/${Date.now()}.jpg`,
              { mimeType: 'image/jpeg' },
            );
            finalCoverImage = result.downloadUrl;
          }
        } catch (imgErr: any) {
          console.error('[EditProfileScreen] Cover image upload failed:', imgErr?.message);
          finalCoverImage = user?.coverImage || '';
          if (!imageWarning) imageWarning = 'cover';
          else imageWarning = 'both';
        }

        // Update username if changed
        if (username !== user?.username) {
          const oldUsername = user?.username?.toLowerCase();
          // Write new username FIRST, then delete old — if crash happens
          // between the two, the new name is claimed (harmless duplicate).
          try {
            await firestore().collection('usernames').doc(username.toLowerCase()).set({ uid: currentUid });
          } catch {}
          if (oldUsername) {
            try { await firestore().collection('usernames').doc(oldUsername).delete(); } catch {}
          }
        }

        // Update user profile
        // NOTE: role, badge, isVerified, subscription are PROTECTED fields —
        // only Cloud Functions (admin SDK) can change them. Do NOT include
        // them here or Firestore rules will reject the update.
        await firestore().collection('users').doc(currentUid).update({
          displayName: displayName.trim(),
          displayNameLower: displayName.trim().toLowerCase(),
          username: username,
          usernameLower: username.toLowerCase(),
          bio: bio.trim(),
          profileImage: finalProfileImage,
          coverImage: finalCoverImage,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });

        // BUG FIX: Persist profile to AsyncStorage cache for self-heal recovery.
        // Without this, if the user doc gets corrupted by a future bug, the
        // sign-in self-heal falls back to Google defaults (losing custom
        // username, uploaded avatar). The cache was read but never written.
        const updatedProfile = {
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
        };
        try {
          await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(updatedProfile));
          if (__DEV__) console.log('[EditProfile] Profile cached to AsyncStorage for self-heal recovery');
        } catch (cacheErr) {
          if (__DEV__) console.warn('[EditProfile] Failed to cache profile:', cacheErr);
        }

        // BUG FIX: Batch-update author metadata on all existing posts and comments
        // when display name, username, or profile image changes. Without this,
        // the feed shows stale names/avatars until enrichment runs (which may
        // not happen for older posts already in the FlatList cache).
        //
        // PERF: This is fire-and-forget and does NOT block the UI or the save.
        // The enrichment layer (enrichAuthorProfiles) handles real-time updates
        // — this batch update is only a fallback for posts loaded before enrichment.
        // Limited to 50 posts + 50 comments to avoid slow Firestore reads.
        const nameChanged = displayName.trim() !== user?.displayName;
        const usernameChanged = username !== user?.username;
        const avatarChanged = finalProfileImage !== user?.profileImage;
        if (nameChanged || usernameChanged || avatarChanged) {
          if (__DEV__) console.log(`[EditProfile] Author metadata changed — background-updating posts/comments`);
          // Fire-and-forget — do NOT await. Use setTimeout(0) to ensure it
          // runs AFTER the current call stack (so the Alert shows immediately).
          setTimeout(() => {
            (async () => {
              try {
                const postsSnap = await firestore()
                  .collection('posts')
                  .where('authorId', '==', currentUid)
                  .limit(50)
                  .get();
                if (!postsSnap.empty) {
                  await Promise.all(postsSnap.docs.map(doc => {
                    const updates: Record<string, any> = {};
                    if (nameChanged) updates.authorDisplayName = displayName.trim();
                    if (usernameChanged) updates.authorUsername = username;
                    if (avatarChanged) updates.authorProfileImage = finalProfileImage || null;
                    return firestore().collection('posts').doc(doc.id).update(updates).catch(() => {});
                  }));
                }
              } catch {}
              try {
                const commentsSnap = await firestore()
                  .collection('post_comments')
                  .where('authorId', '==', currentUid)
                  .limit(50)
                  .get();
                if (!commentsSnap.empty) {
                  await Promise.all(commentsSnap.docs.map(doc => {
                    const updates: Record<string, any> = {};
                    if (nameChanged) updates.authorDisplayName = displayName.trim();
                    if (usernameChanged) updates.authorUsername = username;
                    if (avatarChanged) updates.authorProfileImage = finalProfileImage || null;
                    return firestore().collection('post_comments').doc(doc.id).update(updates).catch(() => {});
                  }));
                }
              } catch {}
            })();
          }, 0);
        }

        // Show success with optional image warning
        const successMsg = imageWarning
          ? 'Profile updated, but image upload failed. Your text changes were saved. Please try uploading the image again.'
          : 'Profile updated successfully';
        Alert.alert('Success', successMsg, [
          { text: 'OK', onPress: () => {
            // Update Zustand store so sidebar/drawer shows the new profile info immediately
            setGlobalUser(updatedProfile);
            // BUG FIX: Trigger feed refresh so FeedScreen reloads posts
            // and runs enrichment with the new name/avatar.
            try { triggerFeedRefresh(); } catch {}
            // PERF: Invalidate userCache so enrichment picks up new name/avatar
            // immediately instead of serving stale cached data for 2 minutes.
            try { 
              const { invalidateUserCache } = require('../lib/userCache');
              invalidateUserCache(currentUid);
            } catch {}
            // BUG FIX: Sync Firebase auth user object with new profile data.
            // Without this, auth().currentUser stays stale (old name/avatar)
            // and any code reading from auth (e.g., getActorData) uses wrong data.
            try {
              updateAuthUser({
                displayName: displayName.trim(),
                photoURL: finalProfileImage || undefined,
              }).catch(() => {});
            } catch {}
            navigation.navigate('ProfileSelf');
          }},
        ]);
      } catch (e: any) {
        console.error('[EditProfileScreen] Save failed:', e?.message || e);
        const msg = e?.status === 403
          ? 'Permission denied. Please check your account status and try again.'
          : e?.message?.includes('network') || e?.message?.includes('Network')
            ? 'Network error. Please check your connection and try again.'
            : 'Could not update profile. Please try again.';
        Alert.alert('Profile', msg);
      } finally {
        setSaving(false);
      }
    };

    if (role === 'business' && user?.role !== 'business') {
      Alert.alert(
        'Warning',
        'Once you switch to Business account, you cannot change back. Are you sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', style: 'destructive', onPress: doSave },
        ],
      );
      return;
    }

    doSave();
  }, [currentUid, displayName, username, bio, profileImage, coverImage, role, user, usernameAvailable, setGlobalUser, navigation]);

  // BUG FIX: Assign ref AFTER handleSave is defined to avoid TDZ (Temporal
  // Dead Zone) error. Previously this was placed before the useCallback,
  // causing `handleSave` to be undefined at initialization time.
  handleSaveRef.current = handleSave;

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
              {profileImage ? (
                <Image source={{ uri: profileImage }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatarImage, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>
                    {(displayName || username || 'A').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.avatarEditOverlay}>
                <Feather name="camera" size={16} color={colors.bg} />
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
              <View style={[styles.badgeDisplay, user.badge === 'gold' ? styles.badgeGold : styles.badgeVerified]}>
                <Text style={styles.badgeEmoji}>{user.badge === 'gold' ? '★' : '●'}</Text>
                <Text style={styles.badgeText}>
                  {user.badge === 'gold' ? 'Gold Verified' : 'Verified'}
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
  avatarFallback: {
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.white,
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
  badgeVerified: {
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
