import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/alvinyap510/near-hackathon-infernear';

export default defineConfig({
  title: 'InferNear Docs',
  description:
    'Private AI inference for every chain, paid for by the yield on your own deposits. Guides, API reference and specs.',
  lang: 'en',
  cleanUrls: true,
  srcExclude: ['README.md'],
  sitemap: { hostname: 'https://docs.infernear.dev' },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],
  // Code blocks read like the console on the landing page: night blocks in light and dark.
  markdown: { theme: { light: 'github-dark', dark: 'github-dark' } },
  themeConfig: {
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: 'InferNear' },
    siteTitle: false,
    outline: [2, 3],
    search: { provider: 'local' },
    nav: [
      { text: 'Quickstart', link: '/getting-started/quickstart' },
      { text: 'API reference', link: '/using-the-api/api-reference' },
      { text: 'Specs', link: '/specs/conventions' },
      { text: 'Console', link: 'https://app.infernear.dev' },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    sidebar: [
      {
        text: 'Overview',
        items: [
          { text: 'Welcome', link: '/' },
          { text: 'Vision', link: '/overview/vision' },
          { text: 'How it works', link: '/overview/how-it-works' },
        ],
      },
      {
        text: 'Getting started',
        items: [
          { text: 'Quickstart', link: '/getting-started/quickstart' },
          { text: 'API keys', link: '/getting-started/api-keys' },
          { text: 'Free trial calls', link: '/getting-started/free-trial-calls' },
        ],
      },
      {
        text: 'Using the API',
        items: [
          { text: 'Standard mode', link: '/using-the-api/standard-mode' },
          { text: 'Private mode', link: '/using-the-api/private-mode' },
          { text: 'Models and pricing', link: '/using-the-api/models-and-pricing' },
          { text: 'API reference', link: '/using-the-api/api-reference' },
        ],
      },
      {
        text: 'Credits',
        items: [
          { text: 'How credits work', link: '/credits/how-credits-work' },
          { text: 'Vaults', link: '/credits/vaults' },
          { text: 'Buy credits', link: '/credits/buy-credits' },
        ],
      },
      {
        text: 'Accounts',
        items: [{ text: 'Accounts and linked wallets', link: '/accounts/accounts-and-linked-wallets' }],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'NEAR Intents', link: '/concepts/near-intents' },
          { text: 'Privacy and trust', link: '/concepts/privacy-and-trust' },
        ],
      },
      {
        text: 'Specs',
        items: [
          { text: 'Conventions and units', link: '/specs/conventions' },
          { text: 'Credit ledger', link: '/specs/credit-ledger' },
          { text: 'Base vaults', link: '/specs/base-vaults' },
          { text: 'Rhea USDC vault', link: '/specs/rhea-vault' },
          { text: 'Gateway', link: '/specs/gateway' },
          { text: 'Keeper', link: '/specs/keeper' },
          { text: 'Wallet proofs', link: '/specs/wallet-proofs' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Live deployments', link: '/reference/live-deployments' },
          { text: 'Verify it yourself', link: '/reference/verify-it-yourself' },
          { text: 'Known limits', link: '/reference/known-limits' },
          { text: 'FAQ', link: '/reference/faq' },
        ],
      },
    ],
    footer: {
      message: 'Built at NEAR HACKATHON, 2026. Released under the MIT License.',
    },
  },
});
