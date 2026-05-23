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
            <Ionicons name="arrow-back" size={24} color="#e7e9ea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Logo */}
          <View style={styles.logoSection}>
            <Text style={styles.logoText}>Black94</Text>
            <Text style={styles.lastUpdated}>Last updated: May 24, 2026</Text>
          </View>

          {/* Sections */}
          <Section title="1. Introduction">
            Black94 (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) respects your privacy and is committed to protecting your personal data in compliance with the Digital Personal Data Protection Act, 2023 (DPDP Act) of India and applicable regulations. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our platform black94.web.app, use our mobile application, or interact with any of our services (collectively, the &quot;Services&quot;). Please read this Privacy Policy carefully. By using our Services, you agree to the collection and use of information in accordance with this policy. This policy is applicable to all users, including users accessing our Services through the Indus App Store.
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
            <SubSection title="Engagement Data">
              We collect behavioral data and interaction patterns to analyze how you engage with our Services. This includes feature usage analytics such as which features you use most frequently, how often you interact with content, your scrolling and navigation patterns, notification response rates, and time spent on specific sections of the application. This data is used in aggregate to improve user experience and does not include the content of your communications.
            </SubSection>
            <SubSection title="Anonymous Chat Data">
              Our Services include an anonymous chat feature. Messages exchanged in anonymous chat rooms are end-to-end encrypted (E2EE). We do not decrypt, read, or store the content of your anonymous chat messages. However, we collect the following metadata: anonymous display names (user-chosen, not real names), chat room identifiers, timestamps of message delivery, and session activity logs. No personally identifiable information is linked to anonymous chat metadata. We cannot associate anonymous chat activity with your registered account.
            </SubSection>
            <SubSection title="Voice &amp; Video Call Metadata">
              When you use voice or video calling features on our platform, we collect call-related metadata for service quality and operational purposes. This includes: call duration, timestamps (start and end time), participant identifiers (anonymous or usernames, not real names), call type (voice or video), and connection quality metrics. We do not record, store, or have access to the audio or video content of your calls.
            </SubSection>
            <SubSection title="Device Session Data">
              We collect device and session information to manage your account security and provide a seamless experience across devices. This includes: active session identifiers, unique device identifiers (such as device model and OS version), login and logout timestamps, IP addresses at the time of login, and the number of concurrent active sessions. You can view and terminate active sessions from your account settings.
            </SubSection>
          </Section>

          <Section title="3. How We Use Your Information">
            We use the information we collect for the following purposes: to provide, maintain, and improve our Services; to process your transactions and send related information including confirmations and invoices; to send you technical notices, updates, security alerts, and administrative messages; to respond to your comments, questions, and customer service requests; to communicate with you about products, services, offers, promotions, and events offered by Black94; to monitor and analyze trends, usage, and activities including engagement patterns and feature usage analytics; to detect, investigate, and prevent fraudulent transactions and abuse; to personalize and improve your experience; to facilitate business functions such as analytics, advertising, and payment processing; to manage device sessions and ensure account security; to optimize voice and video call quality using call metadata; and to maintain the operational integrity of anonymous chat rooms using non-content metadata.
          </Section>

          <Section title="4. Sharing Your Information">
            We may share your information with third parties in the following situations: with our payment gateway partners to process your transactions securely; with cloud service providers who assist us in operating our platform and storing your data; with analytics providers to help us understand usage and improve our Services; when required by law, regulation, or legal process; to enforce our terms of service and other agreements; and with your consent or at your direction. We do not sell your personal data to third parties. Anonymous chat message content, being end-to-end encrypted, is never shared with any third party including ourselves.
          </Section>

          <Section title="5. Data Security">
            We implement industry-standard security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. These measures include encryption in transit (TLS/SSL) and at rest, secure authentication protocols, regular security audits, and access controls. All anonymous chat messages are protected with end-to-end encryption (E2EE), meaning only the participants in a conversation can read the messages. Voice and video call content is not stored or accessible to us. Device session data is encrypted and monitored for unauthorized access. However, no method of transmission over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
          </Section>

          <Section title="6. Data Retention">
            We retain your personal data only for as long as necessary to fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required or permitted by law. Engagement data and call metadata are retained for a period of 12 months for analytical purposes and then automatically deleted. Device session data is retained only for the duration of the active session and for 30 days thereafter. Anonymous chat metadata is retained for 90 days and then purged. When your data is no longer needed, we will securely delete or anonymize it.
          </Section>

          <Section title="7. Your Rights">
            In accordance with the Digital Personal Data Protection Act, 2023 (DPDP Act) and applicable laws, you have the following rights regarding your personal data:
            {"\n"}{"\n"}Right to Access: You have the right to obtain confirmation of whether your personal data is being processed by us and to access a copy of such data.
            {"\n"}{"\n"}Right to Rectification: You have the right to request correction of any inaccurate or incomplete personal data held about you.
            {"\n"}{"\n"}Right to Erasure (Right to be Forgotten): You have the right to request deletion of your personal data. Please refer to Section 8 (Data Deletion Policy) for detailed information on how to exercise this right.
            {"\n"}{"\n"}Right to Data Portability: You have the right to receive your personal data in a structured, commonly used, and machine-readable format, and to transmit that data to another data fiduciary.
            {"\n"}{"\n"}Right to Grievance Redressal: You have the right to lodge a grievance with our Grievance Officer if you are dissatisfied with how your personal data has been processed. Please refer to Section 9 (Grievance Officer) for contact details.
            {"\n"}{"\n"}Right to Withdraw Consent: You have the right to withdraw your consent at any time where the processing of your personal data is based on consent. Withdrawal of consent will not affect the lawfulness of processing carried out prior to such withdrawal.
            {"\n"}{"\n"}To exercise any of these rights, please contact us using the information provided in Section 14.
          </Section>

          <Section title="8. Data Deletion Policy">
            You may request the deletion of your personal data and account at any time. We provide the following methods for data deletion:
            {"\n"}{"\n"}In-App Account Deletion: You can delete your account directly from within the application by navigating to Settings &gt; Account &gt; Delete Account. Upon confirmation, your account will be marked for deletion and the process will begin immediately.
            {"\n"}{"\n"}Email Request: You may also send a data deletion request to privacy@black94.com with the subject line &quot;Data Deletion Request&quot; from the email address registered with your account.
            {"\n"}{"\n"}Upon receiving a valid deletion request, the following data will be permanently deleted: your user profile and all associated personal information; all posts, comments, and stories created by you; all direct messages (DMs) sent and received; all media files (images, videos, documents) stored in Firebase Storage associated with your account; all engagement and usage data linked to your account; and all active device sessions.
            {"\n"}{"\n"}Data that will NOT be deleted: anonymized or aggregated analytics data that cannot be traced back to you; anonymous chat metadata that is not linked to your identity; and data retained where required by applicable law.
            {"\n"}{"\n"}Timeframe: The complete deletion process will be carried out within 30 days from the date of receiving your valid request. During this period, your account will be deactivated and inaccessible. Once deletion is complete, the action is irreversible.
          </Section>

          <Section title="9. Grievance Officer">
            In compliance with the Digital Personal Data Protection Act, 2023, we have designated a Grievance Officer to address any complaints, concerns, or grievances you may have regarding the processing of your personal data.
            {"\n"}{"\n"}Grievance Officer
            {"\n"}Black94
            {"\n"}Email: grievance@black94.com
            {"\n"}{"\n"}You may submit your grievance by sending an email to the above address. Your grievance must include your name, contact details, and a clear description of your concern. We acknowledge receipt of all grievances within 3 business days and will endeavor to resolve your grievance within 30 days from the date of receipt. If you are dissatisfied with the resolution provided, you may escalate the matter to the Data Protection Board of India as established under the DPDP Act, 2023.
          </Section>

          <Section title="10. Cookies and Tracking">
            Our Services may use cookies, web beacons, and similar tracking technologies to enhance your experience, analyze usage patterns, and deliver personalized content. You can control cookies through your browser settings and other tools. Please note that disabling cookies may affect the functionality of our Services. For users accessing through the Indus App Store, additional tracking identifiers may be used for attribution and analytics purposes in accordance with the platform's policies.
          </Section>

          <Section title="11. Children's Privacy">
            Black94 is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that a child under 13 has provided us with personal data, we take steps to delete such information immediately. Additionally, the anonymous chat and voice/video calling features on our platform are restricted to users aged 18 and above. Users under the age of 18 are prohibited from accessing these features. If you believe we might have collected information from a child under 13, please contact us.
          </Section>

          <Section title="12. Third-Party Links">
            Our Services may contain links to third-party websites, applications, or services. We are not responsible for the privacy practices of these third parties. We encourage you to review the privacy policies of any third-party services you access through our platform. The inclusion of any link does not imply our endorsement of the linked website or service.
          </Section>

          <Section title="13. Changes to This Policy">
            We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. We will notify you of any material changes by posting the updated policy on this page with a revised &quot;Last updated&quot; date. For significant changes that affect your rights, we will provide additional notice such as an in-app notification or email. Your continued use of our Services after any changes constitutes your acceptance of the updated Privacy Policy.
          </Section>

          <Section title="14. Contact Us">
            If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us at: Email: privacy@black94.com, Grievance Officer: grievance@black94.com, Website: black94.web.app. We will respond to your request within 30 days and in accordance with applicable laws, including the DPDP Act, 2023.
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
    backgroundColor: '#000000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
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
    color: '#e7e9ea',
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
    color: '#e7e9ea',
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 13,
    color: '#64748b',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e7e9ea',
    marginBottom: 10,
  },
  subSection: {
    marginBottom: 14,
    paddingLeft: 8,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d1d5db',
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#94a3b8',
  },
});
