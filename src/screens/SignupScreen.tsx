import React from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  StatusBar, Alert, Linking, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { signInWithGoogle } from '../lib/api';
import { useAppStore } from '../stores/app';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';

const WEB_CLIENT_ID = Constants.expoConfig?.extra?.googleWebClientId
  || '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

export default function SignupScreen() {
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation<any>();
  const [busy, setBusy] = React.useState(false);

  const handleSignUp = async () => {
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ['profile', 'email'] });
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();

      let idToken: string | null = null;
      try {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      } catch {}

      if (!idToken) { Alert.alert('Error', 'Failed to get authentication token.'); return; }

      const user = await signInWithGoogle(idToken);
      if (user) {
        setUser(user);
        setToken(user.id);
        // Empty username = new user, route to username setup
        if (!user.username || user.username.trim() === '') {
          navigation.replace('UsernameSetup');
        }
        // else: AppNavigator handles routing to main app via isReady
      }
    } catch (error: any) {
      if (error.code !== '12501') {
        Alert.alert('Sign Up Failed', 'Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={s.inner}>
        {/* Logo */}
        <View style={s.logoWrap}>
          <View style={s.logoMark}>
            <Text style={s.logoText}>94</Text>
          </View>
          <Text style={s.appName}>Black94</Text>
        </View>

        <Text style={s.title}>Create your account</Text>
        <Text style={s.subtitle}>Join Black94 and start connecting.</Text>

        {/* Google button */}
        <TouchableOpacity style={s.googleBtn} onPress={handleSignUp} disabled={busy} activeOpacity={0.85}>
          {busy
            ? <ActivityIndicator color={colors.bg} />
            : <>
                <View style={s.googleIconWrap}>
                  <Text style={s.googleG}>G</Text>
                </View>
                <Text style={s.googleBtnText}>Continue with Google</Text>
              </>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login' as never)} style={s.switchRow}>
          <Text style={s.switchText}>Already have an account? </Text>
          <Text style={s.switchLink}>Sign in</Text>
        </TouchableOpacity>

        <View style={s.legal}>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
            <Text style={s.legalText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={s.legalDot}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
            <Text style={s.legalText}>Terms of Service</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  logoWrap: { alignItems: 'center', marginBottom: 48 },
  logoMark: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  logoText: { color: colors.bg, fontSize: 26, fontWeight: '900', fontStyle: 'italic' },
  appName: { fontSize: 22, fontWeight: '800', color: colors.white, letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: '800', color: colors.white, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginBottom: 40 },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    width: '100%', maxWidth: 340, height: 54,
    backgroundColor: colors.white, borderRadius: 14,
    justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 6,
    marginBottom: 20,
  },
  googleIconWrap: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center',
  },
  googleG: { color: '#fff', fontSize: 14, fontWeight: '800' },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  switchRow: { flexDirection: 'row', marginTop: 8, marginBottom: 40 },
  switchText: { color: colors.textSecondary, fontSize: 14 },
  switchLink: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  legal: { flexDirection: 'row', alignItems: 'center', gap: 12, position: 'absolute', bottom: 24 },
  legalText: { color: colors.textMuted, fontSize: 12 },
  legalDot: { color: colors.textMuted, fontSize: 12 },
});
