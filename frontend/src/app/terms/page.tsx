import LegalPage, { LegalSection } from '@/components/legal/legal-page';

const sections: LegalSection[] = [
  {
    heading: '1. Acceptance of Terms',
    paragraphs: [
      'By accessing or using Releeve (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Service. We may update these Terms from time to time; continued use of the Service after changes take effect constitutes acceptance of the revised Terms.',
    ],
  },
  {
    heading: '2. Description of the Service',
    paragraphs: [
      'Releeve is a developer platform for the Stellar network. It provides tooling to help Stellar projects and developers work together, including funded bounties, direct hiring, smart-contract simulation, monitoring and alerting, and public chain exploration.',
      'Certain features of the Service are provided through third-party infrastructure, including the Stellar network, Horizon, and Soroban RPC endpoints. We do not control and are not responsible for the operation of that underlying infrastructure.',
    ],
  },
  {
    heading: '3. Eligibility',
    paragraphs: [
      'You must be at least 18 years old and capable of forming a binding contract to use the Service. If you use the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms.',
    ],
  },
  {
    heading: '4. Accounts and Access',
    paragraphs: [
      'You are responsible for safeguarding your account credentials, including passwords, API tokens, and any authentication codes. You must promptly notify us of any unauthorized access to or use of your account.',
      'We may suspend or terminate your access to the Service if we reasonably believe you have violated these Terms or that your activity presents a security or legal risk to us or to other users.',
    ],
  },
  {
    heading: '5. Prohibited Conduct',
    paragraphs: [
      'You agree not to use the Service to: violate any applicable law or regulation; infringe the rights of any third party; distribute malware or otherwise compromise the security of the Service; interfere with or disrupt the Service or its connected infrastructure; attempt to gain unauthorized access to any system or account; or misrepresent your identity or affiliation.',
    ],
  },
  {
    heading: '6. Bounties and Payments',
    paragraphs: [
      'Bounties are offers posted by project owners to reward contributors for completing specified work. Funds for bounties are held and released through the Stellar network and related mechanisms.',
      'Project owners are responsible for accurately describing work, acceptance criteria, and rewards. Contributors are responsible for delivering work that satisfies the posted criteria. Disputes regarding bounty eligibility or reward amounts should be raised with the project owner; we are not a party to the underlying work arrangement between project owners and contributors.',
    ],
  },
  {
    heading: '7. Fees',
    paragraphs: [
      'Some features of the Service are free and some are paid. Where fees apply, they will be disclosed to you before you incur them. Unless stated otherwise, fees are non-refundable.',
    ],
  },
  {
    heading: '8. Content You Provide',
    paragraphs: [
      'You retain ownership of content you submit to the Service ("Your Content"). By submitting Your Content, you grant us a non-exclusive, worldwide, royalty-free license to host, store, process, and display Your Content solely to operate and improve the Service.',
      'You are solely responsible for Your Content and represent that you have the rights to submit it and that it does not violate these Terms.',
    ],
  },
  {
    heading: '9. Intellectual Property',
    paragraphs: [
      'The Service, including its software, design, text, graphics, and trademarks, is owned by us or our licensors and is protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works of the Service except as expressly permitted.',
    ],
  },
  {
    heading: '10. Third-Party Services',
    paragraphs: [
      'The Service may integrate with third-party services, including GitHub, email providers, and blockchain infrastructure. Your use of those services is subject to their own terms and privacy policies. We are not responsible for the availability or behavior of third-party services.',
    ],
  },
  {
    heading: '11. Disclaimers of Warranty',
    paragraphs: [
      'THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT INFORMATION PROVIDED THROUGH THE SERVICE IS ACCURATE OR COMPLETE.',
      'Nothing in these Terms constitutes financial, investment, legal, or tax advice. You are solely responsible for your decisions involving Stellar assets and other digital assets.',
    ],
  },
  {
    heading: '12. Limitation of Liability',
    paragraphs: [
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL WE, OUR AFFILIATES, OR THEIR RESPECTIVE OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, OR DIGITAL ASSETS, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE SHALL NOT EXCEED THE GREATER OF THE AMOUNT YOU PAID US IN THE SIX (6) MONTHS PRECEDING THE CLAIM OR ONE HUNDRED U.S. DOLLARS ($100).',
    ],
  },
  {
    heading: '13. Indemnification',
    paragraphs: [
      'You agree to indemnify and hold harmless us and our affiliates from and against any claims, liabilities, damages, losses, and expenses, including reasonable attorneys\' fees, arising out of or in connection with your use of the Service, Your Content, or your violation of these Terms.',
    ],
  },
  {
    heading: '14. Termination',
    paragraphs: [
      'You may stop using the Service at any time. We may suspend or terminate your access to the Service at any time, with or without notice, for conduct that we determine, in our sole discretion, violates these Terms or is otherwise harmful to the Service or other users.',
      'Sections that by their nature should survive termination, including but not limited to disclaimers, limitation of liability, and indemnification, will survive any termination of these Terms.',
    ],
  },
  {
    heading: '15. Changes to the Service',
    paragraphs: [
      'We may modify, suspend, or discontinue the Service, or any part of it, at any time with or without notice. We will not be liable to you or to any third party for any modification, suspension, or discontinuation of the Service.',
    ],
  },
  {
    heading: '16. Governing Law',
    paragraphs: [
      'These Terms are governed by the laws of the jurisdiction in which Releeve is organized, without regard to its conflict-of-laws principles. Any dispute arising out of these Terms or the Service will be resolved in the competent courts of that jurisdiction.',
    ],
  },
  {
    heading: '17. Contact',
    paragraphs: [
      'If you have any questions about these Terms, please contact us through the support channels available on the Service.',
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="August 6, 2026"
      intro="These Terms of Service govern your access to and use of the Releeve platform. Please read them carefully before using the Service."
      sections={sections}
    />
  );
}
