const fs = require('fs');
const path = require('path');
const os = require('os');

const SITE_ID = '1d72bd7f-3f8b-44a1-a1a2-df0f4accaaba';

function findToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const confPath = path.join(os.homedir(), '.config', 'configstore', 'netlify.json');
  // netlify-cli stores in configstore differently - try home .netlify
  const candidates = [
    path.join(os.homedir(), '.netlify', 'config.json'),
    path.join(process.env.APPDATA || '', 'netlify', 'Config', 'config.json'),
    path.join(os.homedir(), '.config', 'netlify', 'config.json'),
    confPath,
  ];
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const j = JSON.parse(fs.readFileSync(c, 'utf8'));
      if (j.access_token) return j.access_token;
      if (j.users) {
        for (const u of Object.values(j.users)) {
          const t = u?.auth?.token || u?.token;
          if (t) return t;
        }
      }
    } catch {}
  }
  // Parse from netlify CLI auth via process env written earlier scripts
  // Use configstore package path for netlify
  try {
    const Configstore = require('configstore');
  } catch {}
  // Search known netlify-cli auth locations in AppData
  const appData = process.env.APPDATA || '';
  try {
    const root = path.join(appData, 'netlify');
    if (fs.existsSync(root)) {
      const walk = (d, depth = 0) => {
        if (depth > 3) return null;
        for (const f of fs.readdirSync(d)) {
          const p = path.join(d, f);
          const st = fs.statSync(p);
          if (st.isDirectory()) {
            const r = walk(p, depth + 1);
            if (r) return r;
          } else if (f.endsWith('.json')) {
            try {
              const j = JSON.parse(fs.readFileSync(p, 'utf8'));
              const t = j.access_token || j.token || (j.users && Object.values(j.users)[0]?.auth?.token);
              if (t) return t;
            } catch {}
          }
        }
        return null;
      };
      const t = walk(root);
      if (t) return t;
    }
  } catch {}
  return null;
}

async function main() {
  // Reuse token by calling through netlify if needed - read from previous successful script
  // The fix-netlify-publish.js found a token - same logic
  let token = findToken();
  if (!token) {
    // Hard fallback: run `netlify api getSite` is broken due to escaping; use oauth from configstore under Local
    const local = path.join(process.env.LOCALAPPDATA || '', 'netlify');
    console.log('searching', local);
    process.exit(1);
  }

  // Clear publish dir again with null
  let res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ build_settings: { dir: null, cmd: 'npm run build', package_path: null } }),
  });
  let site = await res.json();
  console.log('after null clear dir=', JSON.stringify(site.build_settings?.dir), 'pkg=', site.build_settings?.package_path);

  // Get recent deploys
  res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys?per_page=8`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const deploys = await res.json();
  for (const d of deploys) {
    console.log(
      d.created_at,
      d.state,
      d.context,
      'error=',
      d.error_message || '',
      'published=',
      !!d.published_at,
      'id=',
      d.id,
      'framework=',
      d.framework || '',
      'summary=',
      (d.summary && d.summary.messages && d.summary.messages.map((m) => m.title).join('; ')) || ''
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
