import { colors } from '../theme/colors';
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

export default function PrivacyPolicyScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Logo */}
          <View style={styles.logoSection}>
            <Text style={styles.logoText}>Black94</Text>
            <Text style={styles.lastUpdated}>Last updated: May 14, 2025</Text>
          </View>

          {/* Sections */}
          <Section title="1. Introduction">
            Black94 (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) respects your privacy and is committed to protecting your personal data. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our platform black94.web.app, use our mobile application, or interact with any of our services (collectively, the &quot;Services&quot;). Please read this Privacy Policy carefully. By using our Services, you agree to the collection and use of information in accordance with this policy.
          </Section>

          <Section title="2. Information We Collect">
            <SubSection title="Personal Data">
              We may collect personally identifiable information that you voluntarily provide to us when you register on the platform, express an interest in obtaining information about us or our products and services, participate in activities on the platform, or otherwise contact us. Personal data may include: name, email address, phone number, postal address, profile photo, social media account identifiers, date of birth, gender, and payment information (processed securely through our payment gateway partners).
            </SubSection>
            <SubSection title="Usage Data">
              We automatically collect certain information when you access, visit, or use our Services, including but not limited to: IP address, browser type and version, operating system, referral URLs, pages visited, links clicked, time spent on pages, device identifiers, and other technical details about your device and browsing activity.
            </SubSection>
            <SubSection title="Content Data">
              When you create, post, share, or upload content on Black94 (such as posts, stories, messages, comments, images, videos, articles, and other media), we collect and store this content as part of providing our Services. This includes any metadata associated with your content such as timestamps and location tags.
            </SubSection>
          </Section>

          <Section title="3. How We Use Your Information">
            We use the information we collect for the following purposes: to provide, maintain, and improve our Services; to process your transactions and send related information including confirmations and invoices; to send you technical notices, updates, security alerts, and administrative messages; to respond to your comments, questions, and customer service requests; to communicate with you about products, services, offers, promotions, and events offered by Black94; to monitor and analyze trends, usage, and activities; to detect, investigate, and prevent fraudulent transactions and abuse; to personalize and improve your experience; and to facilitate business functions such as analytics, advertising, and payment processing.
          </Section>

          <Section title="4. Sharing Your Information">
            We may share your information with third parties in the following situations: with our payment gateway partners to process your transactions securely; with cloud service providers who assist us in operating our platform and storing your data; with analytics providers to help us understand usage and improve our Services; when required by law, regulation, or legal process; to enforce our terms of service and other agreements; and with your consent or at your direction. We do not sell your personal data to third parties.
          </Section>

          <Section title="5. Data Security">
            We implement industry-standard security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. These measures include encryption in transit (TLS/SSL) and at rest, secure authentication protocols, regular security audits, and access controls. However, no method of transmission over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
          </Section>

          <Section title="6. Data Retention">
            We retain your personal data only for as long as necessary to fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required or permitted by law. When your data is no longer needed, we will securely delete or anonymize it.
          </Section>

          <Section title="7. Your Rights">
            Depending on your jurisdiction, you may have the following rights regarding your personal data: the right to access your data; the right to rectify inaccurate data; the right to erasure (right to be forgotten); the right to restrict processing; the right to data portability; the right to object to processing; and the right to withdraw consent at any time. To exercise any of these rights, please contact us using the information provided below.
          </Section>

          <Section title="8. Cookies and Tracking">
            Our Services may use cookies, web beacons, and similar tracking technologies to enhance your experience, analyze usage patterns, and deliver personalized content. You can control cookies through your browser settings and other tools. Please note that disabling cookies may affect the functionality of our Services.
          </Section>

          <Section title="9. Children's Privacy">
            Black94 is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that a child under 13 has provided us with personal data, we take steps to delete such information immediately. If you believe we might have collected information from a child under 13, please contact us.
          </Section>

          <Section title="10. Third-Party Links">
            Our Services may contain links to third-party websites, applications, or services. We are not responsible for the privacy practices of these third parties. We encourage you to review the privacy policies of any third-party services you access through our platform.
          </Section>

          <Section title="11. Changes to This Policy">
            We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. We will notify you of any material changes by posting the updated policy on this page with a revised &quot;Last updated&quot; date. Your continued use of our Services after any changes constitutes your acceptance of the updated Privacy Policy.
          </Section>

          <Section title="12. Contact Us">
            If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us at: Email: privacy@black94.com, Website: black94.web.app. We will respond to your request within a reasonable timeframe and in accordance with applicable laws.
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
      {typeof children === 'string' ? (
        <Text style={styles.sectionBody}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.subSection}>
      <Text style={styles.subSectionTitle}>{title}</Text>
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
  subSection: {
    marginBottom: 14,
    paddingLeft: 8,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
  },
});
