// Synthetic fixture identities only. Never fund them. No RPC or wallet is used.
// node scripts/generate-vectors.cjs <directory containing viem's package.json>
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { writeFileSync } = require('node:fs');
const dependency = createRequire(resolve(process.argv[2], 'package.json'));
const { keccak256, stringToBytes } = dependency('viem');
const { privateKeyToAccount } = dependency('viem/accounts');
const wallet = privateKeyToAccount(keccak256(stringToBytes('INFERNEAR_PUBLIC_TEST_FIXTURE_NEVER_FUND')));
const other = privateKeyToAccount(keccak256(stringToBytes('INFERNEAR_OTHER_PUBLIC_TEST_FIXTURE_NEVER_FUND')));
const user = 'eip155:8453:' + wallet.address.toLowerCase();
const request = { action: 'withdraw', network: 'mainnet', vault: 'vault.near', user, amount: '900000', nonce: 0, expires_at: 4000000000 };
async function vector(name, patch = {}, signer = wallet) {
  const message = JSON.stringify({ ...request, ...patch });
  return { name, message, signature: await signer.signMessage({ message }), address: signer.address.toLowerCase() };
}
(async () => {
  const vectors = [];
  for (const target of [27,28]) {
    for (let i = 0; i < 1000; i++) {
      const candidate = await vector('v'+target, {amount:String(900000+i)});
      if (parseInt(candidate.signature.slice(-2),16) === target) { vectors.push(candidate); break; }
    }
  }
  vectors.push(await vector('replace', {amount:'500000',nonce:1}));
  vectors.push(await vector('zero', {amount:'0'}));
  vectors.push(await vector('too_large', {amount:'1000001'}));
  vectors.push(await vector('expired', {expires_at:1}));
  vectors.push(await vector('wrong_vault', {vault:'other.near'}));
  vectors.push(await vector('wrong_network', {network:'testnet'}));
  vectors.push(await vector('wrong_action', {action:'harvest'}));
  vectors.push(await vector('wrong_signer', {}, other));
  const valid = vectors[0];
  const order = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  const s = BigInt('0x' + valid.signature.slice(66,130));
  const v = parseInt(valid.signature.slice(-2),16);
  vectors.push({...valid,name:'high_s',signature:valid.signature.slice(0,66)+(order-s).toString(16).padStart(64,'0')+(v===27?'1c':'1b')});
  const worst = [];
  for (let i=0;i<10;i++) {
    const account = privateKeyToAccount(keccak256(stringToBytes('INFERNEAR_WORST_CASE_FIXTURE_'+i)));
    worst.push(await vector('holder_'+i,{user:'eip155:8453:'+account.address.toLowerCase(),amount:'1000000'},account));
  }
  writeFileSync(resolve(__dirname,'../test-vectors/withdrawals.json'), JSON.stringify({vectors,worst},null,2)+'\n');
})();
