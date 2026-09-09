import steem from 'steem';
async function getAcct(node, name) {
  const r = await fetch(node, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[name]], id: 1 }) });
  return ((await r.json()).result || [])[0] || null;
}
const pubs = readPubs();
function readPubs() {
  // the candidate pubs we want to test (from /tmp/hc-keys.txt decrypted WIFs)
  const fs = require('fs');
  const lines = fs.readFileSync('/tmp/hc-keys.txt', 'utf8').trim().split('\n');
  const out = {};
  for (const l of lines) { const [k, ...v] = l.split('='); out[k] = steem.auth.wifToPublic(v.join('=')); }
  return out;
}
for (const chain of ['steem', 'hive']) {
  const node = chain === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const acct = await getAcct(node, 'headcorner');
  console.log(`== ${chain}`);
  for (const role of ['owner', 'active', 'posting']) {
    const auth = acct[role];
    const keys = (auth?.key_auths ?? []).map(k => k.key);
    const match = keys.includes(pubs[`${chain}:${role}`]);
    console.log(`  ${role}: chain=${keys[0]?.slice(0, 14)}… candidate MATCH=${match}`);
  }
}
