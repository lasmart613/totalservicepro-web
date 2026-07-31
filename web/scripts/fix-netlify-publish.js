const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SITE_ID = '1d72bd7f-3f8b-44a1-a1a2-df0f4accaaba';

function findToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;

  const candidates = [
    path.join(os.homedir(), '.netlify', 'config.json'),
    path.join(process.env.APPDATA || '', 'netlify', 'Config', 'config.json'),
    path.join(os.homedir(), '.config', 'netlify', 'config.json'),
  ];

  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const j = JSON.parse(fs.readFileSync(c, 'utf8'));
      if (j.access_token) return j.access_token;
      if (j.token) return j.token;
      if (j.users) {
        for (const u of Object.values(j.users)) {
          const t = u?.auth?.token || u?.token || u?.access_token;
          if (t) return t;
        }
      }
      console.log('config found but no token keys:', c, Object.keys(j));
    } catch (e) {
      console.log('skip', c, e.message);
    }
  }

  // configstore path used by netlify-cli
  try {
    const confPath = path.join(os.homedir(), '.config', 'configstore', 'netlify.json');
    if (fs.existsSync(confPath)) {
      const j = JSON.parse(fs.readFileSync(confPath, 'utf8'));
      if (j.users) {
        for (const u of Object.values(j.users)) {
          const t = u?.auth?.token || u?.token;
          if (t) return t;
        }
      }
      console.log('configstore keys', Object.keys(j));
    }
  } catch (e) {
    console.log('configstore', e.message);
  }

  return null;
}

async function main() {
  let token = findToken();
  if (!token) {
    // last resort: ask netlify CLI for status and use api via child with file
    console.error('No Netlify auth token found in env/config.');
    process.exit(1);
  }

  console.log('Updating site build_settings.dir to empty string...');
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      build_settings: {
        dir: '',
        cmd: 'npm run build',
      },
    }),
  });
  const j = await res.json();
  if (!res.ok) {
    console.error('Update failed', res.status, j);
    process.exit(1);
  }
  console.log('OK. publish dir now:', JSON.stringify(j.build_settings?.dir));
  console.log('cmd:', j.build_settings?.cmd);
  console.log('url:', j.ssl_url || j.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
