// Chain, token and protocol marks from @web3icons/core (MIT), bundled at build time.
// Each mark was rendered and checked: Base's blue square, NEAR's N, Circle's USDC, Coinbase's
// cbETH, Pendle, Aave, Ethereum, Arbitrum One, Solana, BNB Chain, Robinhood (the feather) and Sui. There is no Rhea mark in the package,
// so Rhea is named in text only.
import base from '@web3icons/core/svgs/networks/branded/base.svg.js';
import nearMono from '@web3icons/core/svgs/networks/mono/near-protocol.svg.js';
import ethereum from '@web3icons/core/svgs/networks/branded/ethereum.svg.js';
import arbitrum from '@web3icons/core/svgs/networks/branded/arbitrum-one.svg.js';
import solana from '@web3icons/core/svgs/networks/branded/solana.svg.js';
import bnb from '@web3icons/core/svgs/networks/branded/binance-smart-chain.svg.js';
import robinhood from '@web3icons/core/svgs/networks/branded/robinhood.svg.js';
import sui from '@web3icons/core/svgs/networks/branded/sui.svg.js';
import usdc from '@web3icons/core/svgs/tokens/branded/USDC.svg.js';
import cbeth from '@web3icons/core/svgs/tokens/branded/CBETH.svg.js';
import pendle from '@web3icons/core/svgs/tokens/branded/PENDLE.svg.js';
import aave from '@web3icons/core/svgs/tokens/branded/AAVE.svg.js';

// NEAR's mark in its own black or white: the mono glyph, drawn in the text colour.
const near = nearMono.replace('fill="#fff"', 'fill="currentColor"');

const ICONS = { base, near, ethereum, arbitrum, solana, bnb, robinhood, sui, usdc, cbeth, pendle, aave };
const NAMES = { base: 'Base', near: 'NEAR', ethereum: 'Ethereum', arbitrum: 'Arbitrum', solana: 'Solana', bnb: 'BNB Chain', robinhood: 'Robinhood Chain', sui: 'Sui', usdc: 'USDC', cbeth: 'cbETH', pendle: 'Pendle', aave: 'Aave' };

/** Fills every <i data-icon="name"> with its mark, hidden from screen readers (the name is in text). */
let uid = 0;

export function placeIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const svg = ICONS[el.dataset.icon];
    if (!svg || el.firstChild) continue;
    // Marks with gradients carry ids; suffix them so a mark can appear more than once.
    const n = ++uid;
    el.innerHTML = svg
      .replace(/\s(width|height)="24"/g, '')
      .replace('class="web3icons"', 'class="web3icons" aria-hidden="true" focusable="false"')
      .replace(/id="([^"]+)"/g, `id="$1-${n}"`)
      .replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`);
    el.classList.add('icon', `icon-${el.dataset.icon}`);
    if (!el.title) el.title = NAMES[el.dataset.icon];
  }
}
