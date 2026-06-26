import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Alert, Linking, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { signInWithGoogle } from '../lib/api';
import { useAppStore } from '../stores/app';
import Constants from 'expo-constants';

const WEB_CLIENT_ID = Constants.expoConfig?.extra?.googleWebClientId
  || '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

export default function LoginScreen() {
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation<any>();
  const [busy, setBusy] = React.useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ['profile', 'email'] });
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();

      let idToken: string | null = null;
      try { const t = await GoogleSignin.getTokens(); idToken = t.idToken; } catch {}
      if (!idToken) { Alert.alert('Error', 'Failed to get authentication token.'); return; }

      const user = await signInWithGoogle(idToken);
      if (user) {
        setUser(user);
        setToken(user.id);
        // New user with no real username → pick one
        if (!user.username || user.username === user.id?.slice(0, 8)) {
          navigation.replace('UsernameSetup');
        }
      }
    } catch (error: any) {
      if (error.code !== '12501') Alert.alert('Sign In Failed', 'Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={s.inner}>
        {/* Logo */}
        <View style={s.logoSection}>
          <View style={s.logoBox}>
            <Text style={s.logoNum}>94</Text>
          </View>
          <Text style={s.appName}>Black94</Text>
          <Text style={s.tagline}>The next-gen social platform</Text>
        </View>

        {/* Sign in */}
        <View style={s.authSection}>
          <TouchableOpacity style={s.googleBtn} onPress={handleSignIn} disabled={busy} activeOpacity={0.9}>
            {busy
              ? <ActivityIndicator color="#000" size="small" />
              : <>
                  <View style={s.gIcon}>
                    <Text style={[s.gLetter, { color: '#4285F4' }]}>G</Text>
                    <Text style={[s.gLetter, { color: '#EA4335', fontSize: 6, position: 'absolute', bottom: 0, right: 0 }]}>•</Text>
                  </View>
                  <Text style={s.googleBtnText}>Continue with Google</Text>
                </>
            }
          </TouchableOpacity>

          <View style={s.dividerRow}>
            <View style={s.divider} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.divider} />
          </View>

          <TouchableOpacity onPress={() => navigation.navigate('Signup' as never)} style={s.createBtn} activeOpacity={0.8}>
            <Text style={s.createBtnText}>Create new account</Text>
          </TouchableOpacity>
        </View>

        <View style={s.legal}>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
            <Text style={s.legalText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={s.legalDot}> · </Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
            <Text style={s.legalText}>Terms of Service</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between', paddingTop: 60, paddingBottom: 32 },

  logoSection: { alignItems: 'center', paddingTop: 20 },
  logoBox: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  logoNum: { color: '#000', fontSize: 30, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1 },
  appName: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -1, marginBottom: 8 },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5 },

  authSection: { gap: 12 },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 56, backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  gIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  gLetter: { fontSize: 16, fontWeight: '800' },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: '#111', letterSpacing: -0.2 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.1)' },
  dividerText: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },

  createBtn: {
    height: 56, borderRadius: 16, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  createBtnText: { fontSize: 15, fontWeight: '600', color: '#fff', letterSpacing: -0.2 },

  legal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 2 },
  legalText: { color: 'rgba(255,255,255,0.25)', fontSize: 11 },
  legalDot: { color: 'rgba(255,255,255,0.25)', fontSize: 11 },
});
