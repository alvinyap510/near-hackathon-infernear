// Local ed25519 identities and fake access-key reads only; no real wallet or RPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { baseEncode } from 'near-api-js';
import { createSiweMessage } from 'viem/siwe';
import { privateKeyToAccount } from 'viem/accounts';
import { KEY_STATEMENT } from '../src/gateway/auth.ts';
import { harness } from './harness.ts';
const wallet = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const publicKey = 'ed25519:' + baseEncode(wallet.publicKey.export({format:'der',type:'spki'}).subarray(-32));
const text = (value:string) => {const b=Buffer.from(value),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};
function proof(relayNonce:string, now:number, overrides:Record<string,unknown>={}, signer:KeyObject=wallet.privateKey) {
  const message=JSON.stringify({statement:KEY_STATEMENT,account_id:overrides.account_id??'alice.near',nonce:relayNonce,expires_at:Math.floor(now/1000)+300});
  const near={account_id:'alice.near',public_key:publicKey,signature:'',message,nonce:createHash('sha256').update(relayNonce).digest('base64'),recipient:'relay.test',...overrides};
  const tag=Buffer.alloc(4);tag.writeUInt32LE(2147484061);
  near.signature=sign(null,createHash('sha256').update(Buffer.concat([tag,text(near.message),Buffer.from(near.nonce,'base64'),text(near.recipient),Buffer.from([0])])).digest(),signer).toString('base64');
  return {near};
}
const post=(base:string,path:string,value:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
const nonce=async(base:string)=>(await(await fetch(base+'/auth/nonce')).json()).nonce as string;

test('NEP-413 issues an authenticating key, revokes it, and permits implicit accounts',async t=>{
  const now=Date.now(), h=await harness({now:()=>now,nearKey:async(_a,k)=>k===publicKey});t.after(h.close);
  const signed=proof(await nonce(h.base),now);
  const response=await post(h.base,'/keys',signed);assert.equal(response.status,200);
  const key=(await response.json()).key;
  assert.equal((await h.gateway.authenticate(`Bearer ${key}`)).user,'near:mainnet:alice.near');
  assert.equal((await post(h.base,'/keys',signed)).status,401);
  const revoked=await post(h.base,'/keys/revoke',proof(await nonce(h.base),now));assert.equal(revoked.status,200);
  await assert.rejects(h.gateway.authenticate(`Bearer ${key}`));
  const implicit='a'.repeat(64);
  const issued=await post(h.base,'/keys',proof(await nonce(h.base),now,{account_id:implicit}));assert.equal(issued.status,200);
  assert.equal(h.auth.parse(`Bearer ${(await issued.json()).key}`).user,`near:mainnet:${implicit}`);
});

test('NEP-413 rejects domain, time, statement, signature, key, account and base64/length failures uniformly',async t=>{
  const now=Date.now(),h=await harness({now:()=>now,nearKey:async(a,k)=>a!=='unknown.near' && a!=='function.near' && k===publicKey});t.after(h.close);
  const make=async(overrides:Record<string,unknown>={})=>proof(await nonce(h.base),now,overrides);
  const expired=(n:string)=>JSON.stringify({statement:KEY_STATEMENT,nonce:n,expires_at:Math.floor(now/1000)-1});
  const invalid=[await make({recipient:'evil.test'}),await make({recipient:'relay.test:9'}),
    await make({message:expired(await nonce(h.base))}),await make({message:JSON.stringify({statement:KEY_STATEMENT,nonce:await nonce(h.base),expires_at:Math.floor(now/1000)+301})}),
    await make({message:JSON.stringify({statement:'Revoke everything',nonce:await nonce(h.base),expires_at:Math.floor(now/1000)+100})}),
    await make({nonce:Buffer.alloc(32).toString('base64')}),await make({nonce:'!'}),await make({nonce:Buffer.alloc(31).toString('base64')}),
    await make({account_id:'function.near'}),await make({account_id:'unknown.near'}),await make({account_id:'A.near'}),await make({account_id:'a..near'}),
    await make({public_key:'ed25519:'+baseEncode(Buffer.alloc(31))}),await make({public_key:'secp256k1:abc'}),await make({public_key:'ed25519:'+'1'.repeat(100000)}),
    proof(await nonce(h.base),now,{},other.privateKey)];
  const aliased=await make();aliased.near.account_id='bob.near';invalid.push(aliased);
  const tampered=await make();tampered.near.message+=' ';invalid.push(tampered);
  const wrongKey=proof(await nonce(h.base),now,{public_key:'ed25519:'+baseEncode(other.publicKey.export({format:'der',type:'spki'}).subarray(-32))},other.privateKey);invalid.push(wrongKey);
  for(const signature of ['!',Buffer.alloc(63).toString('base64'),Buffer.alloc(65).toString('base64'),Buffer.alloc(64).toString('base64')+'\n']) {
    const p=await make();p.near.signature=signature;invalid.push(p);
  }
  for(const p of invalid) {
    const response=await post(h.base,'/keys',p);assert.equal(response.status,401);
    assert.equal((await response.json()).error.code,'invalid_api_key');
  }
  const logs=JSON.stringify(h.events);
  assert(!logs.includes(publicKey));
  for(const p of invalid)assert(!logs.includes(p.near.message),'proof failures must not log signed messages');
});

test('NEP-413 shares nonce expiry and atomic single-use consumption across concurrent requests',async t=>{
  let now=Date.now();const h=await harness({now:()=>now,nearKey:async()=>true});t.after(h.close);
  const p=proof(await nonce(h.base),now);
  const responses=await Promise.all([post(h.base,'/keys',p),post(h.base,'/keys',p)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);
  const stale=proof(await nonce(h.base),now);now+=300_001;
  assert.equal((await post(h.base,'/keys',stale)).status,401);
});

test('NEAR and SIWE revocations share the daily sponsored budget',async t=>{
  const now=Date.now(),h=await harness({now:()=>now,nearKey:async()=>true,sponsoredPerDay:1});t.after(h.close);
  assert.equal((await post(h.base,'/keys/revoke',proof(await nonce(h.base),now))).status,200);
  const evm=privateKeyToAccount(('0x'+'23'.repeat(32)) as `0x${string}`);
  const message=createSiweMessage({address:evm.address,chainId:8453,domain:'relay.test',uri:'http://relay.test',version:'1',nonce:await nonce(h.base),issuedAt:new Date(now),expirationTime:new Date(now+300_000)});
  const response=await post(h.base,'/keys/revoke',{message,signature:await evm.signMessage({message})});
  assert.equal(response.status,429);assert.equal((await response.json()).error.code,'sponsored_limit');
});


test('NEAR proofs fail closed on lookup errors and expiry reached during the finalized read',async t=>{
  let now=Date.now(),fail=true;
  const h=await harness({now:()=>now,nearKey:async()=>{if(fail)throw Error('https://credential:secret@rpc.fixture/private');now+=300_001;return true;}});t.after(h.close);
  assert.equal((await post(h.base,'/keys',proof(await nonce(h.base),now))).status,401);
  fail=false;assert.equal((await post(h.base,'/keys',proof(await nonce(h.base),now))).status,401);
  assert(!JSON.stringify(h.events).includes('credential'));
});

test('NEAR key routes share the same 30-per-minute IP bucket',async t=>{
  const h=await harness({nearKey:async()=>true});t.after(h.close);
  for(let i=0;i<30;i++)assert.equal((await post(h.base,'/keys',{near:null})).status,401);
  assert.equal((await post(h.base,'/keys/revoke',{near:null})).status,429);
});
