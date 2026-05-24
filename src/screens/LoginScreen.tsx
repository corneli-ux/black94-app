import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, StatusBar, Alert, Linking, Platform, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { signInWithGoogle, initPostSignUp } from '../lib/api';
import { useAppStore } from '../stores/app';

export default function LoginScreen() {
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation();
  const [busy, setBusy] = React.useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({
        webClientId: '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
      });
      // BUG FIX: hasPlayServices() is Android-only — calling it on iOS
      // throws "hasPlayServices is not a function" and crashes the login screen.
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices();
      }
      await GoogleSignin.signIn();

      let idToken: string | null = null;
      try {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      } catch (e) {
        if (__DEV__) console.warn('[Login] getTokens failed:', e);
      }

      if (!idToken) {
        Alert.alert('Error', 'Failed to get authentication token.');
        return;
      }

      const user = await signInWithGoogle(idToken);
      if (user) {
        setUser(user);
        setToken(user.id);
        if (__DEV__) initPostSignUp(user.id).catch((e) => console.warn('[Login] initPostSignUp failed:', e));
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      if (error.code !== '12501') {
        const msg = error.message || 'Please try again';
        Alert.alert('Sign In Failed', msg.length > 100 ? 'Sign in failed. Please try again.' : msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.inner}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to continue to Black94.</Text>

        <TouchableOpacity style={styles.googleButton} onPress={handleSignIn} disabled={busy} activeOpacity={0.8}>
          <Text style={styles.buttonText}>
            {busy ? 'Signing in...' : 'Sign in with Google'}
          </Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Signup' as never)} style={styles.switchTextContainer}>
          <Text style={styles.switchText}>
            New to Black94? <Text style={styles.switchLink}>Create Account</Text>
          </Text>
        </TouchableOpacity>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
            <Text style={styles.legalText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
            <Text style={styles.legalText}>Terms of Service</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  logo: { width: 80, height: 80, marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 48 },
  googleButton: {
    width: '100%', maxWidth: 320, height: 52,
    backgroundColor: colors.white, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primaryForeground, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  dividerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 320, marginTop: 24, marginBottom: 16 },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: 12, marginHorizontal: 12 },
  switchTextContainer: { marginTop: 4 },
  switchText: { color: colors.textSecondary, fontSize: 14 },
  switchLink: { color: colors.accent, fontWeight: '600' },
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 32, gap: 12 },
  legalText: { color: colors.textMuted, fontSize: 12 },
  legalSeparator: { color: colors.textMuted, fontSize: 12 },
});
