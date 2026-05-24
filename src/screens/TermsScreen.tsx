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
import { AppIcon } from '../components/icons';

export default function TermsScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <AppIcon name="arrow-back" size="xl" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Terms &amp; Conditions</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Logo */}
          <View style={styles.logoSection}>
            <Text style={styles.logoText}>Black94</Text>
            <Text style={styles.lastUpdated}>Last updated: May 14, 2025</Text>
          </View>

          <Section title="1. Acceptance of Terms">
            By accessing or using Black94 (&quot;the Platform&quot;), including our website at black94.web.app and our mobile application, you agree to be bound by these Terms and Conditions (&quot;Terms&quot;). If you do not agree to these Terms, please do not use our Services. These Terms apply to all visitors, users, and others who access or use our Platform.
          </Section>

          <Section title="2. Description of Services">
            Black94 provides a social media and e-commerce platform that allows users to create profiles, post content, interact with other users, send messages, share stories, discover content, purchase products, list items for sale, and access various business tools. We reserve the right to modify, suspend, or discontinue any part of our Services at any time, with or without notice.
          </Section>

          <Section title="3. User Accounts and Registration">
            To access certain features of the Platform, you must create an account. You agree to provide accurate, current, and complete information during registration and to update such information to keep it accurate, current, and complete. You are responsible for safeguarding your account password and for all activities that occur under your account. You must be at least 13 years of age to create an account. If you are under 18, you represent that your parent or legal guardian has reviewed and agreed to these Terms on your behalf.
          </Section>

          <Section title="4. User Conduct">
            When using our Services, you agree not to: post or share content that is unlawful, harmful, threatening, abusive, harassing, defamatory, vulgar, obscene, or otherwise objectionable; impersonate any person or entity or falsely represent your affiliation; upload or transmit viruses, malware, or any other malicious code; interfere with or disrupt the integrity or performance of our Services; attempt to gain unauthorized access to any portion of the Services, user accounts, or systems; use the Services for any unlawful purpose or to solicit the performance of any illegal activity; harvest or collect personal information of other users without consent; or engage in any activity that creates an unreasonable or disproportionately large load on our infrastructure.
          </Section>

          <Section title="5. User Content">
            You retain ownership of the content you post on Black94. By posting content, you grant us a worldwide, non-exclusive, royalty-free license to use, reproduce, modify, adapt, publish, translate, distribute, and display such content in connection with providing and improving our Services. You represent and warrant that you own or control all rights to the content you post and that such content does not infringe upon the rights of any third party.
          </Section>

          <Section title="6. Payments">
            Black94 offers premium subscription plans and in-app purchases that provide additional features and functionalities. Payments for subscriptions are processed through our authorized payment gateway partners. All applicable fees, including subscription charges and taxes, will be clearly displayed before you complete your purchase. By making a payment, you agree to the applicable pricing and terms. We do not store your payment card details on our servers; all payment information is handled securely by our payment partners.
          </Section>

          <Section title="7. Subscription and Premium Services">
            Black94 may offer premium subscription plans that provide additional features, functionalities, or content. By subscribing to a premium plan, you agree to pay the subscription fees as specified at the time of purchase. Subscriptions will automatically renew at the end of each billing period unless you cancel before the renewal date. We reserve the right to change subscription pricing with reasonable notice.
          </Section>

          <Section title="8. Intellectual Property">
            The Platform and its original content (excluding content provided by users) remain the exclusive property of Black94 and its licensors. The Platform is protected by copyright, trademark, and other laws of both India and foreign countries. Our trademarks, service marks, and trade dress may not be used in connection with any product or service without prior written consent from Black94.
          </Section>

          <Section title="9. Privacy">
            Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the Platform, to understand our practices regarding the collection and use of your personal information.
          </Section>

          <Section title="10. Limitation of Liability">
            In no event shall Black94, its directors, employees, partners, agents, suppliers, or affiliates be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation: loss of profits, data, use, goodwill, or other intangible losses resulting from your access to or use of (or inability to access or use) the Platform; any conduct or content of any third party on the Platform; any content obtained from the Platform; or unauthorized access, use, or alteration of your transmissions or content.
          </Section>

          <Section title="11. Indemnification">
            You agree to defend, indemnify, and hold harmless Black94 and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses arising out of or in any way connected with your access to or use of the Platform or your violation of these Terms.
          </Section>

          <Section title="12. Termination">
            We may terminate or suspend your account and access to the Platform immediately, without prior notice or liability, for any reason, including without limitation if you breach these Terms. Upon termination, your right to use the Platform will immediately cease. All provisions of these Terms which by their nature should survive termination shall survive, including without limitation ownership provisions, warranty disclaimers, indemnity, and limitations of liability.
          </Section>

          <Section title="13. Governing Law">
            These Terms shall be governed and construed in accordance with the laws of India, without regard to its conflict of law provisions. Our failure to enforce any right or provision of these Terms will not be considered a waiver of those rights.
          </Section>

          <Section title="14. Contact Information">
            If you have any questions about these Terms, please contact us at: Email: legal@black94.com, Website: black94.web.app
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
