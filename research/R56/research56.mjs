// Research script for Task R (DEX economic functions) — batch mode
// Usage: cd /home/z/my-project && bun /home/z/research-r.mjs "query 1" "query 2" ...
import ZAI from 'z-ai-web-dev-sdk';

const queries = process.argv.slice(2);
if (queries.length === 0) { console.log('no queries'); process.exit(0); }

const zai = await ZAI.create();

for (const q of queries) {
  console.log('\n==================================================');
  console.log('QUERY: ' + q);
  console.log('==================================================');
  try {
    const res = await zai.functions.invoke('web_search', { query: q, num: 10 });
    const items = Array.isArray(res) ? res : (res?.results || res?.data || []);
    let i = 0;
    for (const r of items) {
      i++;
      const name = r?.name || r?.title || '(no title)';
      const url = r?.url || r?.link || '';
      const snip = (r?.snippet || r?.description || r?.content || '').replace(/\s+/g, ' ').slice(0, 600);
      console.log(`\n[${i}] ${name}\nURL: ${url}\nSNIPPET: ${snip}`);
    }
  } catch (e) {
    console.log('ERROR for query "' + q + '": ' + (e?.message || String(e)));
  }
}
