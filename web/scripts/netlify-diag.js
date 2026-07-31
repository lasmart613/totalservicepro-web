const fs = require('fs');
const path = require('path');

const SITE_ID = '1d72bd7f-3f8b-44a1-a1a2-df0f4accaaba';
const c = path.join(process.env.APPDATA, 'netlify', 'Config', 'config.json');
const j = JSON.parse(fs.readFileSync(c, 'utf8'));
const token = Object.values(j.users)[0].auth.token;

async function main() {
  const headers = { Authorization: `Bearer ${token}` };

  let r = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}`, { headers });
  const site = await r.json();
  console.log('repo:', site.build_settings?.repo_url, site.build_settings?.repo_branch);
  console.log('dir:', JSON.stringify(site.build_settings?.dir));
  console.log('cmd:', site.build_settings?.cmd);
  console.log('base:', JSON.stringify(site.build_settings?.base));
  console.log('package_path:', JSON.stringify(site.build_settings?.package_path));

  r = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/build_hooks`, { headers });
  console.log('hooks:', await r.json());

  r = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys?per_page=3`, { headers });
  const deploys = await r.json();
  for (const d of deploys) {
    const msgs = (d.summary?.messages || []).map((m) => m.title).join(' | ');
    console.log(d.id, d.state, d.context, msgs);
  }

  // Create a build hook if none, then trigger remote Linux build
  r = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/build_hooks`, { headers });
  let hooks = await r.json();
  if (!Array.isArray(hooks) || hooks.length === 0) {
    console.log('Creating build hook...');
    r = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/build_hooks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'manual-fix', branch: site.build_settings?.repo_branch || 'main' }),
    });
    const created = await r.json();
    console.log('created hook', created);
    hooks = [created];
  }

  const hook = hooks[0];
  if (hook?.url || hook?.id) {
    const url = hook.url || `https://api.netlify.com/build_hooks/${hook.id}`;
    console.log('Triggering remote build via', url);
    r = await fetch(url, { method: 'POST' });
    console.log('trigger status', r.status, await r.text());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
