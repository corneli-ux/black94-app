import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView, ActivityIndicator, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';

const INTEREST_OPTIONS = [
  'Technology', 'Fashion', 'Sports', 'Food', 'Travel',
  'Music', 'Gaming', 'Health', 'Education', 'Business',
  'Entertainment', 'Fitness',
];

export default function CreateAdScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;

  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [duration, setDuration] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [location, setLocation] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleInterest = (interest: string) => {
    setSelectedInterests(prev =>
      prev.includes(interest)
        ? prev.filter(i => i !== interest)
        : [...prev, interest]
    );
  };

  const isFormValid = () => {
    return (
      name.trim().length > 0 &&
      headline.trim().length > 0 &&
      dailyBudget.trim().length > 0 &&
      Number(dailyBudget) > 0 &&
      duration.trim().length > 0 &&
      Number(duration) > 0
    );
  };

  const handleSave = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'You must be signed in to create an ad.');
      return;
    }
    if (!isFormValid()) {
      Alert.alert('Error', 'Please fill in all required fields (Campaign Name, Headline, Daily Budget, Duration).');
      return;
    }

    setSaving(true);
    try {
      await firestore().collection('adCampaigns').add({
        businessId: currentUser.uid,
        name: name.trim(),
        headline: headline.trim(),
        description: description.trim(),
        ctaText: ctaText.trim() || 'Learn More',
        dailyBudget: Number(dailyBudget),
        budget: Number(dailyBudget) * Number(duration),
        duration: Number(duration),
        targeting: {
          ageMin: Number(ageMin) || 18,
          ageMax: Number(ageMax) || 65,
          location: location.trim(),
          interests: selectedInterests,
        },
        status: 'active',
        impressions: 0,
        clicks: 0,
        conversions: 0,
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      Alert.alert('Success', 'Ad campaign created successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      console.error('[CreateAd] Failed:', e);
      Alert.alert('Error', 'Failed to create ad campaign. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <SafeAreaView edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Ad</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      <View style={styles.form}>
        {/* Campaign Name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Campaign Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Summer Sale 2024"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Headline */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Headline *</Text>
          <TextInput
            style={styles.input}
            value={headline}
            onChangeText={setHeadline}
            placeholder="Short catchy headline"
            placeholderTextColor={colors.textSecondary}
            maxLength={80}
          />
        </View>

        {/* Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe your ad in detail..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
            maxLength={300}
          />
        </View>

        {/* CTA Button Text */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>CTA Button Text</Text>
          <TextInput
            style={styles.input}
            value={ctaText}
            onChangeText={setCtaText}
            placeholder="e.g. Shop Now, Learn More"
            placeholderTextColor={colors.textSecondary}
            maxLength={30}
          />
        </View>

        {/* Budget & Duration */}
        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Daily Budget (₹) *</Text>
            <TextInput
              style={styles.input}
              value={dailyBudget}
              onChangeText={setDailyBudget}
              placeholder="500"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
            />
          </View>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Duration (days) *</Text>
            <TextInput
              style={styles.input}
              value={duration}
              onChangeText={setDuration}
              placeholder="7"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Budget preview */}
        {dailyBudget && duration && Number(dailyBudget) > 0 && Number(duration) > 0 && (
          <View style={styles.previewBox}>
            <Text style={styles.previewText}>
              Total Budget: ₹{Number(dailyBudget).toLocaleString('en-IN')} × {duration} days = {' '}
              <Text style={{ fontWeight: '700' }}>
                ₹{(Number(dailyBudget) * Number(duration)).toLocaleString('en-IN')}
              </Text>
            </Text>
          </View>
        )}

        {/* Targeting Section */}
        <Text style={styles.sectionTitle}>Targeting</Text>

        {/* Age Range */}
        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Min Age</Text>
            <TextInput
              style={styles.input}
              value={ageMin}
              onChangeText={setAgeMin}
              placeholder="18"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              maxLength={2}
            />
          </View>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Max Age</Text>
            <TextInput
              style={styles.input}
              value={ageMax}
              onChangeText={setAgeMax}
              placeholder="65"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              maxLength={2}
            />
          </View>
        </View>

        {/* Location */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Mumbai, Delhi, All India"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Interests */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Interests</Text>
          <View style={styles.tagsContainer}>
            {INTEREST_OPTIONS.map(interest => (
              <TouchableOpacity
                key={interest}
                style={[
                  styles.tag,
                  selectedInterests.includes(interest) && styles.tagSelected,
                ]}
                onPress={() => toggleInterest(interest)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.tagText,
                  selectedInterests.includes(interest) && styles.tagTextSelected,
                ]}>
                  {interest}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveBtn, (!isFormValid() || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!isFormValid() || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Create Campaign</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  backIcon: { color: colors.text, fontSize: 24 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  form: { paddingHorizontal: 16, paddingTop: 20 },
  fieldGroup: { marginBottom: 18 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: colors.surface, color: colors.text,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  previewBox: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.accent,
    padding: 12, marginBottom: 18,
  },
  previewText: { color: colors.text, fontSize: 14 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 14, marginTop: 4 },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    backgroundColor: colors.surface, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  tagSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  tagText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  tagTextSelected: { color: '#fff' },
  saveBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 10,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
