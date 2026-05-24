import { colors } from '../theme/colors';
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

export default function CommunityGuidelinesScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Community Guidelines</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Logo */}
          <View style={styles.logoSection}>
            <Text style={styles.logoText}>Black94</Text>
            <Text style={styles.lastUpdated}>Last updated: July 1, 2025</Text>
          </View>

          <Section title="1. Our Commitment">
            Black94 is a platform built for connection, creativity, and community. To maintain a safe and welcoming environment for everyone, we have established these Community Guidelines. By using Black94, you agree to follow these guidelines. We are committed to fostering respectful discourse and will take action against behavior that violates these standards.
          </Section>

          <Section title="2. Respectful Behavior">
            Treat every member of the Black94 community with respect. We expect all users to engage in good faith and contribute constructively to conversations. Disagreements are natural, but personal attacks, insults, and condescending language are not. Remember that behind every username is a real person.
          </Section>

          <Section title="3. No Hate Speech">
            Hate speech of any kind is strictly prohibited. This includes content that promotes violence, discrimination, or hostility against individuals or groups based on race, ethnicity, nationality, religion, caste, gender, sexual orientation, disability, age, or any other protected characteristic. Slurs, stereotypes, and dehumanizing language will not be tolerated.
          </Section>

          <Section title="4. No Harassment or Bullying">
            Harassment, bullying, and intimidation are not allowed on Black94. This includes but is not limited to: targeted personal attacks, repeated unwanted contact, doxxing (sharing someone&apos;s private information without consent), threats of violence, stalking behavior, and coordinated harassment campaigns. If someone asks you to stop contacting them, you must respect their request.
          </Section>

          <Section title="5. No Spam or Misleading Content">
            Spam and misleading content degrade the experience for everyone. Prohibited activities include: posting repetitive or unsolicited messages, promoting products or services in deceptive ways, clickbait, spreading misinformation, impersonating others, creating multiple accounts for abusive purposes, and using automated tools to artificially inflate engagement. Pyramid schemes and fraudulent offers are also prohibited.
          </Section>

          <Section title="6. Content Standards">
            All content shared on Black94 must comply with these guidelines. Do not post content that is illegal, sexually explicit (without appropriate warnings), violent or gory, self-harm promoting, or that infringes on intellectual property rights. Content involving minors in any inappropriate context will result in immediate account termination and may be reported to authorities.
          </Section>

          <Section title="7. Content Moderation">
            Black94 employs a combination of automated systems and human review to moderate content. We may remove, restrict, or label content that violates these guidelines. Our moderation team reviews reported content and takes appropriate action. We continuously improve our moderation systems to better serve our community while respecting freedom of expression.
          </Section>

          <Section title="8. Reporting Violations">
            If you encounter content or behavior that violates these Community Guidelines, please report it immediately using the in-app reporting feature. You can report posts, comments, messages, stories, and user profiles. When filing a report, please provide a clear description of the violation. Reports are reviewed by our moderation team, and appropriate action is taken. False or malicious reporting is itself a violation of these guidelines.
          </Section>

          <Section title="9. Consequences of Violations">
            Violations of these Community Guidelines will result in enforcement action. The severity of the action depends on the nature and frequency of the violation:
            {"\n"}{"\n"}First-time minor violations: Warning and content removal.
            {"\n"}{"\n"}Repeated violations: Temporary restrictions on features (posting, messaging, commenting).
            {"\n"}{"\n"}Serious violations (hate speech, harassment, illegal content): Immediate account suspension.
            {"\n"}{"\n"}Severe or repeated serious violations: Permanent account ban.
            {"\n"}{"\n"}We reserve the right to take any action we deem appropriate to protect the community, including legal action in extreme cases.
          </Section>

          <Section title="10. Appeal Process">
            If you believe your content was removed in error or your account was unfairly restricted, you have the right to appeal. To submit an appeal:
            {"\n"}{"\n"}1. Navigate to Settings and select the relevant restriction notification, or email appeals@black94.com.
            {"\n"}{"\n"}2. Provide your username, a description of the action taken, and why you believe it was an error.
            {"\n"}{"\n"}3. Appeals are reviewed within 5 business days.
            {"\n"}{"\n"}4. You will receive a response via email with the outcome of your appeal.
            {"\n"}{"\n"}5. If your appeal is denied and you believe the decision is unjust, you may escalate the matter by contacting grievance@black94.com.
          </Section>

          <Section title="11. Changes to These Guidelines">
            We may update these Community Guidelines from time to time. When we make material changes, we will notify users through in-app notifications and update the &quot;Last updated&quot; date above. Your continued use of Black94 after any changes constitutes acceptance of the updated guidelines.
          </Section>

          <Section title="12. Contact Us">
            If you have questions about these Community Guidelines or need to report a concern, please contact us at: Email: community@black94.com, Appeals: appeals@black94.com, Grievance Officer: grievance@black94.com, Website: black94.web.app
          </Section>

          {/* Footer spacer */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  logoSection: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 8,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
  },
});
