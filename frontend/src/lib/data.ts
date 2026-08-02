export const BRAND = { violet: '#5B3DF5', violetDeep: '#38267E', violetSoft: '#F1EEFD', blue: '#2F6FED', ink: '#15141A' };

export function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
export function generateContributions(seed: number, weeks = 52) {
  const rand = seededRandom(seed);
  const grid: number[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: number[] = [];
    for (let d = 0; d < 7; d++) {
      const r = rand();
      let level = 0;
      if (r > 0.88) level = 4; else if (r > 0.72) level = 3; else if (r > 0.52) level = 2; else if (r > 0.3) level = 1;
      week.push(level);
    }
    grid.push(week);
  }
  return grid;
}
export const LEVEL_COLORS = ['#1C1A27', '#38267E', '#5B3DF5', '#8269F8', '#B7A2F9'];
export function cx(...args: (string | boolean | undefined | null)[]) { return args.filter(Boolean).join(' '); }

export const PROJECTS = [
  { id: 'walletx', name: 'WalletX', initial: 'W', color: 'bg-violet-600', category: 'Wallets & Custody',
    tagline: 'Non-custodial multi-sig wallet infrastructure for Stellar.',
    description: 'WalletX provides multi-signature account infrastructure and hardware-key support for teams and individuals holding assets on Stellar. Used by 40+ Stellar-native treasuries.',
    repo: 'walletx/core', stars: 812, contributors: 18, totalPaid: 14280, walletBalance: 6400,
    activity: [420, 460, 510, 495, 610, 640, 700, 680, 740, 790, 820, 860] },
  { id: 'anchorpay', name: 'AnchorPay', initial: 'A', color: 'bg-blue-600', category: 'Payments & Anchors',
    tagline: 'Fiat on/off-ramp anchor infrastructure (SEP-24/SEP-31).',
    description: 'AnchorPay is a compliant fiat anchor stack that lets Stellar projects plug in deposit and withdrawal rails in days instead of months.',
    repo: 'anchorpay/anchor-sdk', stars: 534, contributors: 12, totalPaid: 9120, walletBalance: 3800,
    activity: [300, 340, 320, 380, 410, 400, 460, 500, 470, 520, 560, 590] },
  { id: 'lumenshub', name: 'Lumens Hub', initial: 'L', color: 'bg-amber-500', category: 'Analytics',
    tagline: 'Real-time analytics and community dashboard for XLM holders.',
    description: 'Lumens Hub aggregates Horizon and DEX data into a single analytics layer, tracking network health, validator performance, and token flows.',
    repo: 'lumenshub/dashboard', stars: 297, contributors: 7, totalPaid: 4650, walletBalance: 1900,
    activity: [180, 210, 205, 230, 260, 250, 300, 290, 320, 340, 330, 360] },
  { id: 'novawallet', name: 'Nova Wallet', initial: 'N', color: 'bg-rose-500', category: 'Wallets & Custody',
    tagline: 'Mobile-first Stellar wallet for everyday payments.',
    description: 'Nova Wallet is a consumer mobile wallet focused on fast onboarding, biometric security, and a delightful send/receive experience for XLM and Stellar assets.',
    repo: 'novawallet/mobile', stars: 651, contributors: 15, totalPaid: 11460, walletBalance: 5200,
    activity: [350, 380, 400, 420, 460, 480, 510, 540, 560, 600, 640, 670] },
  { id: 'stellarcommerce', name: 'Stellar Commerce', initial: 'S', color: 'bg-emerald-600', category: 'Commerce',
    tagline: 'Checkout SDK for accepting Stellar-native payments online.',
    description: 'Stellar Commerce gives merchants a drop-in checkout SDK and plugins for major e-commerce platforms, settling directly in USDC or XLM.',
    repo: 'stellarcommerce/checkout-sdk', stars: 403, contributors: 9, totalPaid: 7380, walletBalance: 4100,
    activity: [220, 240, 260, 250, 290, 310, 330, 350, 370, 400, 420, 450] },
  { id: 'opentreasury', name: 'Open Treasury', initial: 'O', color: 'bg-indigo-600', category: 'Governance',
    tagline: 'DAO treasury management tooling built on Soroban.',
    description: 'Open Treasury gives Stellar-native DAOs multi-sig approvals, proposal voting, and on-chain spend tracking for community-controlled funds.',
    repo: 'opentreasury/soroban-core', stars: 268, contributors: 6, totalPaid: 3240, walletBalance: 2600,
    activity: [140, 150, 170, 165, 190, 210, 200, 230, 250, 260, 280, 300] },
];

export const USER_NOTIFICATIONS = [
  { id: 'n1', type: 'reward', title: 'Reward received', message: 'You earned $200 for "Onboarding carousel" on Nova Wallet.', time: '2h ago', read: false },
  { id: 'n2', type: 'accepted', title: 'Contribution accepted', message: 'Your PR for AnchorPay\u2019s webhook tests was merged.', time: '5h ago', read: false },
  { id: 'n3', type: 'bounty', title: 'New bounty matches your skills', message: '"Optimize Horizon API polling" was just posted on Lumens Hub.', time: '1d ago', read: false },
  { id: 'n5', type: 'interview', title: 'Interview invitation', message: 'Stellar Commerce invited you to interview for Full-Stack Engineer.', time: '2d ago', read: true },
  { id: 'n6', type: 'job', title: 'New job posted', message: 'Open Treasury is hiring a Smart Contract Engineer.', time: '3d ago', read: true },
  { id: 'n7', type: 'rejected', title: 'Submission needs changes', message: 'Your submission for "Multi-currency support" needs revisions.', time: '4d ago', read: true },
  { id: 'n8', type: 'system', title: 'Weekly summary ready', message: 'Your contribution and earnings summary for last week is ready.', time: '5d ago', read: true },
];

export const PROJECT_NOTIFICATIONS = [
  { id: 'pn1', type: 'submission', title: 'New submission', message: 'Wei Zhang submitted a draft PR for \u201cLedger hardware wallet integration\u201d.', time: '1h ago', read: false },
  { id: 'pn2', type: 'applicant', title: 'New applicant', message: 'Amara Chukwu applied to Senior Rust Engineer.', time: '4h ago', read: false },
  { id: 'pn3', type: 'deadline', title: 'Bounty deadline approaching', message: '\u201cFix transaction fee estimation bug\u201d is due in 2 days.', time: '6h ago', read: false },
  { id: 'pn4', type: 'message', title: 'New message', message: 'Priya Nair sent a message about the withdrawal flow bounty.', time: '1d ago', read: true },
  { id: 'pn5', type: 'treasury', title: 'Treasury funded', message: 'Your treasury was topped up with $2,000.', time: '2d ago', read: true },
  { id: 'pn6', type: 'merged', title: 'Contribution merged', message: 'Lucas Ferreira\u2019s onboarding carousel PR was merged and paid out.', time: '3d ago', read: true },
];

export const USER_CONVERSATIONS = [
  { id: 'c1', name: 'WalletX Team', color: 'bg-violet-600', lastMessage: 'Looks great \u2014 can you open a PR?', time: '10m', unread: 2,
    messages: [
      { from: 'them', text: 'Hey! Saw your note on the Ledger integration bounty.', time: '9:02 AM' },
      { from: 'them', text: 'The transport layer approach sounds right. Any blockers so far?', time: '9:03 AM' },
      { from: 'me', text: 'Not yet, working through APDU framing today. Should have a draft PR by tomorrow.', time: '9:10 AM' },
      { from: 'them', text: 'Looks great \u2014 can you open a PR?', time: '9:14 AM' },
    ] },
  { id: 'c2', name: 'AnchorPay \u00b7 Priya Nair', color: 'bg-blue-600', lastMessage: 'Pushed the KYC step, take a look?', time: '1h', unread: 0,
    messages: [
      { from: 'them', text: 'Pushed the KYC step, take a look?', time: '8:30 AM' },
      { from: 'me', text: 'On it, will review within the hour.', time: '8:41 AM' },
    ] },
  { id: 'c3', name: 'Nova Wallet Team', color: 'bg-rose-500', lastMessage: 'Payout for the carousel bounty is on its way.', time: '3h', unread: 0,
    messages: [
      { from: 'them', text: 'Payout for the carousel bounty is on its way.', time: '6:15 AM' },
      { from: 'me', text: 'Appreciate it, thanks!', time: '6:20 AM' },
    ] },
  { id: 'c4', name: 'Stellar Commerce Hiring', color: 'bg-emerald-600', lastMessage: 'Would Thursday 3pm work for a call?', time: '1d', unread: 1,
    messages: [
      { from: 'them', text: 'Thanks for applying to Full-Stack Engineer!', time: 'Yesterday' },
      { from: 'them', text: 'Would Thursday 3pm work for a call?', time: 'Yesterday' },
    ] },
];

export const PROJECT_CONVERSATIONS = [
  { id: 'pc1', name: 'Wei Zhang', color: 'bg-indigo-600', lastMessage: 'Transport layer is working, opening a draft PR now.', time: '20m', unread: 1,
    messages: [
      { from: 'them', text: 'Quick update on the Ledger integration \u2014 transport layer handshake is working.', time: '9:40 AM' },
      { from: 'them', text: 'Transport layer is working, opening a draft PR now.', time: '9:41 AM' },
    ] },
  { id: 'pc2', name: 'Priya Nair', color: 'bg-emerald-600', lastMessage: 'Should the KYC step block withdrawal or run async?', time: '2h', unread: 0,
    messages: [
      { from: 'them', text: 'Should the KYC step block withdrawal or run async?', time: '7:55 AM' },
      { from: 'me', text: 'Block it \u2014 compliance wants KYC confirmed before funds move.', time: '8:02 AM' },
    ] },
  { id: 'pc3', name: 'Daniel Osei', color: 'bg-blue-600', lastMessage: 'Submitted the webhook tests, ready for review.', time: '1d', unread: 0,
    messages: [{ from: 'them', text: 'Submitted the webhook tests, ready for review.', time: 'Yesterday' }] },
];

export const ACTIVITY_FEED = [
  { id: 'a1', text: 'Wei Zhang submitted a draft PR for "Ledger hardware wallet integration".', time: '1h ago' },
  { id: 'a2', text: 'Your contribution to "Onboarding carousel" was merged and paid out.', time: '2h ago' },
  { id: 'a3', text: 'Priya Nair started working on "SEP-24 interactive withdrawal flow".', time: '5h ago' },
  { id: 'a4', text: 'Open Treasury posted a new bounty: "Multi-sig approval UI flow".', time: '1d ago' },
  { id: 'a5', text: 'Stellar Commerce invited you to interview for Full-Stack Engineer.', time: '2d ago' },
];

export const CURRENT_USER = { id: 'me', name: 'Justice Uzoigwe', username: 'justiceu', color: 'bg-violet-600', seed: 5 };

export const PROJECT_MEMBERSHIPS = {
  walletx: [
    { name: 'Justice Uzoigwe', username: 'justiceu', role: 'owner', color: 'bg-violet-600', isMe: true },
    { name: 'Kingsley Agu', username: 'kingsleya', role: 'admin', color: 'bg-blue-600', isMe: false },
  ],
  lumenshub: [
    { name: 'Amara Chukwu', username: 'amarabuilds', role: 'owner', color: 'bg-violet-600', isMe: false },
    { name: 'Justice Uzoigwe', username: 'justiceu', role: 'admin', color: 'bg-violet-600', isMe: true },
  ],
};