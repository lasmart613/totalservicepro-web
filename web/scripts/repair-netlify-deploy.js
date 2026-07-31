/**
 * Fix site-wide Netlify 404 for Next.js:
 * 1) Clear UI publish directory (must be empty for @netlify/plugin-nextjs)
 * 2) Inspect recent deploys
 * 3) Optionally restore last good deploy
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SITE_ID = '1d72bd7f-3f8b-44a1-a1a2-df0f4accaaba';

function findToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const c = path.join(process.env.APPDATA || '', 'netlify', 'Config', 'config.json');
  const j = JSON.parse(fs.readFileSync(c, 'utf8'));
  for (const u of Object.values(j.users || {})) {
    if (u?.auth?.token) return u.auth.token;
  }
  throw new Error('No Netlify token');
}

async function api(token, method, urlPath, body) {
  const res = await fetch(`https://api.netlify.com/api/v1${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

async function main() {
  const token = findToken();
  const action = process.argv[2] || 'fix';

  if (action === 'fix' || action === 'all') {
    // Clear publish dir — empty string is required; null may not stick
    const site = await api(token, 'PUT', `/sites/${SITE_ID}`, {
      build_settings: {
        dir: '',
        cmd: 'npm run build',
        package_path: '',
        base: '',
      },
    });
    console.log('Site publish dir:', JSON.stringify(site.build_settings?.dir));
    console.log('Site cmd:', site.build_settings?.cmd);
    console.log('Site package_path:', JSON.stringify(site.build_settings?.package_path));
    console.log('Site base:', JSON.stringify(site.build_settings?.base));
  }

  if (action === 'list' || action === 'all' || action === 'fix') {
    const deploys = await api(token, 'GET', `/sites/${SITE_ID}/deploys?per_page=12`);
    for (const d of deploys) {
      console.log(
        [
          d.created_at,
          d.state.padEnd(10),
          (d.context || '').padEnd(12),
          d.published_at ? 'PUBLISHED' : '         ',
          d.id,
          d.error_message || '',
          d.framework || '',
        ].join(' | ')
      );
    }
  }

  if (action === 'restore') {
    const deployId = process.argv[3];
    if (!deployId) throw new Error('Usage: restore <deploy_id>');
    const r = await api(token, 'POST', `/sites/${SITE_ID}/deploys/${deployId}/restore`);
    console.log('Restored deploy:', r.id, r.state, r.published_at);
  }

  if (action === 'deploy-info') {
    const deployId = process.argv[3];
    const d = await api(token, 'GET', `/deploys/${deployId}`);
    console.log(
      JSON.stringify(
        {
          id: d.id,
          state: d.state,
          error_message: d.error_message,
          framework: d.framework,
          function_schedules: d.function_schedules,
          summary: d.summary,
          published_at: d.published_at,
          deploy_ssl_url: d.deploy_ssl_url,
          branch: d.branch,
          title: d.title,
          plugins: d.plugins,
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
