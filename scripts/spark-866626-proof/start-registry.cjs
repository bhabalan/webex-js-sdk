const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const registry = 'http://127.0.0.1:4873';
const directory = process.env.PROOF_DIRECTORY;

async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const config = path.join(directory, 'registry.json');
  fs.writeFileSync(config, JSON.stringify({
    storage: path.join(directory, 'storage'),
    auth: { htpasswd: { file: path.join(directory, 'htpasswd') } },
    uplinks: {},
    packages: {
      '@spark-866626-proof/*': { access: '$all', publish: '$authenticated' },
    },
    log: { type: 'stdout', format: 'json', level: 'warn' },
  }));
  const log = fs.openSync(path.join(directory, 'registry.log'), 'a');
  const child = spawn(process.execPath, [
    process.argv[2], '--config', config, '--listen', '127.0.0.1:4873',
  ], { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  fs.writeFileSync(path.join(directory, 'registry.pid'), String(child.pid));
  fs.closeSync(log);

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      ready = (await fetch(registry + '/-/ping')).ok;
      if (ready) break;
    } catch {
      // Wait for the local registry to bind its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Local registry did not start');

  const response = await fetch(registry + '/-/user/org.couchdb.user:proof', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'proof',
      password: crypto.randomBytes(32).toString('hex'),
      email: 'proof@example.invalid',
      type: 'user',
    }),
  });
  if (!response.ok) throw new Error('Local registry account creation failed: ' + response.status);
  const { token } = await response.json();
  if (!token) throw new Error('Local registry did not return an auth token');
  console.log('::add-mask::' + token);
  fs.appendFileSync(process.env.GITHUB_ENV, [
    'YARN_NPM_REGISTRY_SERVER=' + registry,
    'YARN_NPM_PUBLISH_REGISTRY=' + registry,
    'YARN_UNSAFE_HTTP_WHITELIST=127.0.0.1',
    'YARN_NPM_AUTH_TOKEN=' + token,
    'NPM_CONFIG_REGISTRY=' + registry,
    '',
  ].join('\n'));
  console.log('Temporary registry is ready on loopback; no upstream registry is configured.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
