import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, StatusBar,
  TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import { AppIcon } from '../components/icons';

const STORAGE_KEY = '@black94/muted_words';

export default function MutedWordsScreen() {
  const navigation = useNavigation<any>();
  const [words, setWords] = useState<string[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => { if (v) setWords(JSON.parse(v)); }).catch(() => {});
  }, []);

  const save = async (updated: string[]) => {
    setWords(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
  };

  const addWord = () => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return;
    if (words.includes(trimmed)) { Alert.alert('Already added'); return; }
    save([trimmed, ...words]);
    setInput('');
  };

  const removeWord = (w: string) => save(words.filter(x => x !== w));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Muted Words</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Add word or phrase..."
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            onSubmitEditing={addWord}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.addBtn} onPress={addWord}>
            <AppIcon name="add" size="lg" color={colors.bg} />
          </TouchableOpacity>
        </View>
        <View style={styles.infoBox}>
          <AppIcon name="visibility-off" size="sm" color={colors.textMuted} />
          <Text style={styles.infoText}>Posts containing these words will be hidden from your feed.</Text>
        </View>
        <FlatList
          data={words}
          keyExtractor={w => w}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptySub}>No muted words yet. Add words above to filter your feed.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.wordRow}>
              <Text style={styles.word}>{item}</Text>
              <TouchableOpacity onPress={() => removeWord(item)} hitSlop={8}>
                <AppIcon name="cancel" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  inputRow: { flexDirection: 'row', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.border,
  },
  addBtn: { backgroundColor: colors.accent, borderRadius: 12, width: 46, alignItems: 'center', justifyContent: 'center' },
  infoBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 10 },
  infoText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  wordRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  word: { fontSize: 15, color: colors.text },
  empty: { padding: 40, alignItems: 'center' },
  emptySub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
