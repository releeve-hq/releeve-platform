import LegalPage, { LegalSection } from '@/components/legal/legal-page';

const sections: LegalSection[] = [
  {
    heading: '1. Overview',
    paragraphs: [
      'This Privacy Policy explains how Releeve ("we", "us", or "our") collects, uses, discloses, and protects information about you when you use the Releeve platform (the "Service"). By using the Service, you agree to the practices described in this policy.',
    ],
  },
  {
    heading: '2. Information We Collect',
    paragraphs: [
      'We collect information you provide directly, such as your name, email address, username, profile information, and any content you submit, including bounty postings, comments, and repository connections.',
      'We also collect information automatically when you use the Service, including device and browser information, IP address, log data, and usage information such as pages viewed and actions taken.',
      'When you connect third-party accounts such as GitHub, we may collect information from those services consistent with the permissions you grant, such as your public repositories and contribution activity.',
      'When you use blockchain-related features, we may process public blockchain data, including transaction hashes and addresses, that you interact with through the Service.',
    ],
  },
  {
    heading: '3. How We Use Information',
    paragraphs: [
      'We use the information we collect to operate, maintain, and improve the Service; to authenticate you and secure your account; to process bounty transactions and hiring connections; to provide monitoring and alerting features; to respond to your requests and support inquiries; to send you service notifications; and to enforce our Terms of Service.',
    ],
  },
  {
    heading: '4. Cookies and Local Storage',
    paragraphs: [
      'We use cookies and similar technologies, including browser local storage, to keep you signed in, remember your preferences, and understand how the Service is used. You can control cookies through your browser settings, but disabling them may affect the functionality of the Service.',
      'Our cookie consent banner allows you to choose whether to accept or decline non-essential cookies. Essential cookies required for the Service to function, such as those used for authentication, cannot be disabled.',
    ],
  },
  {
    heading: '5. How We Share Information',
    paragraphs: [
      'We do not sell your personal information. We may share your information with service providers who help us operate the Service, such as hosting, email delivery, and analytics providers, subject to appropriate confidentiality obligations.',
      'We may disclose information where required by law, regulation, or legal process, or where we believe in good faith that disclosure is necessary to protect our rights, your safety, or the safety of others.',
      'Information that is publicly visible by design — such as your public profile, public bounty listings, and public blockchain data — is accessible to other users of the Service and, where applicable, the public.',
    ],
  },
  {
    heading: '6. Data Retention',
    paragraphs: [
      'We retain information for as long as necessary to provide the Service and fulfill the purposes described in this policy, unless a longer retention period is required or permitted by law. When you delete your account, we will delete or anonymize your personal information within a reasonable period, except where we must retain it to comply with legal obligations.',
    ],
  },
  {
    heading: '7. Security',
    paragraphs: [
      'We take reasonable measures to protect the information we collect from loss, theft, misuse, and unauthorized access, disclosure, alteration, and destruction. Passwords are stored only as cryptographic hashes, and access tokens are stored only as hashed values. However, no method of transmission or storage is completely secure, and we cannot guarantee absolute security.',
    ],
  },
  {
    heading: '8. Your Rights',
    paragraphs: [
      'Depending on your jurisdiction, you may have rights to access, correct, delete, or export your personal information, and to object to or restrict certain processing. You can update much of your information directly through your account settings. To exercise any of these rights, please contact us using the details below.',
      'You may also have the right to lodge a complaint with a data protection authority in your jurisdiction.',
    ],
  },
  {
    heading: '9. Children',
    paragraphs: [
      'The Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us and we will take steps to delete it.',
    ],
  },
  {
    heading: '10. Third-Party Links',
    paragraphs: [
      'The Service may contain links to third-party websites or services. We are not responsible for the privacy practices or content of those third parties. We encourage you to review the privacy policies of any third-party service you visit.',
    ],
  },
  {
    heading: '11. International Data Transfers',
    paragraphs: [
      'We may process and store information in locations outside your country of residence. By using the Service, you consent to the transfer of your information to those locations, which may have different data-protection rules than your jurisdiction.',
    ],
  },
  {
    heading: '12. Changes to This Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on the Service and updating the "Last updated" date. Your continued use of the Service after changes take effect constitutes acceptance of the revised policy.',
    ],
  },
  {
    heading: '13. Contact Us',
    paragraphs: [
      'If you have any questions or concerns about this Privacy Policy or our privacy practices, please contact us through the support channels available on the Service.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="August 6, 2026"
      intro="This Privacy Policy describes how Releeve collects, uses, and protects information about you when you use the Service."
      sections={sections}
    />
  );
}
