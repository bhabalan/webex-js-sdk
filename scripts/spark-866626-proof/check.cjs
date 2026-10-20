const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const toolingCommit = '56328c3b77646c20572c26d7725d3d168363bdcb';
const directory = process.env.PROOF_DIRECTORY;
const stateFile = path.join(directory, 'evidence.json');
const registry = 'http://127.0.0.1:4873';
const fixtureRoot = 'packages/@webex/spark-866626-proof-runtime/';
const packages = ['@spark-866626-proof/runtime', '@spark-866626-proof/dependent'];
const locations = ['runtime', 'dependent'].map((name) =>
  'packages/@webex/spark-866626-proof-' + name + '/package.json');
const execute = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const versions = () => locations.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')).version);

function collect() {
  const before = process.env.BEFORE_SHA;
  assert.match(before, /^[a-f0-9]{40}$/);
  assert.notEqual(before, '0'.repeat(40));
  const head = execute('git', ['rev-parse', 'HEAD']);
  assert.equal(head, process.env.GITHUB_SHA);
  const match = /^test: (markdown|sdd|source) proof\b/.exec(process.env.MERGE_MESSAGE);
  assert.ok(match, 'The merge title must identify the expected proof case');
  const kind = match[1];
  const changed = execute('git', ['diff', '--name-only', '--no-renames', before, head]).split('\n');
  const expectedFiles = {
    markdown: fixtureRoot + 'README.md',
    sdd: fixtureRoot + '.sdd/proof.json',
    source: fixtureRoot + 'src/index.js',
  };
  assert.deepEqual(changed, [expectedFiles[kind]]);
  execute('git', ['diff', '--exit-code', toolingCommit, head, '--',
    'packages/tools/cli', 'packages/tools/package', 'config/typescript', '.github/workflows/deploy.yml']);
  const outputs = {};
  for (const mode of ['node', 'yarn']) {
    for (const recursive of [false, true]) {
      const key = mode + (recursive ? '-recursive' : '-changed');
      outputs[key] = execute('yarn', [
        'package-tools', 'list', '--mode', mode, '--since', before,
        ...(recursive ? ['--recursive'] : []),
      ]);
    }
  }
  const release = kind === 'source';
  assert.equal(outputs['node-changed'], release ? packages[0] : '');
  assert.deepEqual(outputs['node-recursive'].split(' ').filter(Boolean).sort(),
    release ? [...packages].sort() : []);
  if (!release) {
    assert.equal(outputs['yarn-changed'], '{}');
    assert.equal(outputs['yarn-recursive'], '{}');
  } else {
    assert.equal(outputs['yarn-changed'], packages[0]);
    assert.deepEqual(outputs['yarn-recursive'].replace(/[{}]/g, '').split(',').sort(),
      [...packages].sort());
  }
  for (const [key, value] of Object.entries(outputs)) {
    console.log(key + '=' + JSON.stringify(value));
    fs.appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
  }
  assert.deepEqual(versions(), ['0.0.0', '0.0.0']);
  const state = {
    kind, before, head, changed, toolingCommit, outputs,
    node: process.version, yarn: execute('yarn', ['--version']),
    versionsBefore: versions(), registry,
    increment: 'yarn package-tools increment --packages $NODE_RECURSIVE --tag next',
    deploy: 'yarn workspaces foreach --from "$PROOF_YARN_SELECTION" --verbose run deploy:npm --access public --tag next',
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log('Package selection assertions passed for ' + kind);
}

async function verify() {
  assert.equal(process.env.NPM_CONFIG_REGISTRY, registry);
  assert.equal(process.env.YARN_NPM_REGISTRY_SERVER, registry);
  assert.equal(process.env.YARN_NPM_PUBLISH_REGISTRY, registry);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const release = state.kind === 'source';
  const expectedVersion = '0.0.0-next.1';
  state.versionsAfter = versions();
  assert.deepEqual(state.versionsAfter,
    release ? [expectedVersion, expectedVersion] : state.versionsBefore);
  state.published = [];
  for (const name of packages) {
    const response = await fetch(registry + '/' + encodeURIComponent(name));
    if (!release) {
      assert.equal(response.status, 404, name + ' must have no registry entry');
      continue;
    }
    assert.equal(response.status, 200);
    const metadata = await response.json();
    assert.equal(metadata['dist-tags'].next, expectedVersion);
    assert.deepEqual(Object.keys(metadata.versions), [expectedVersion]);
    const tarballUrl = new URL(metadata.versions[expectedVersion].dist.tarball);
    assert.equal(tarballUrl.origin, registry);
    const tarball = await fetch(tarballUrl);
    assert.equal(tarball.status, 200);
    const archive = path.join(directory, name.split('/')[1] + '.tgz');
    fs.writeFileSync(archive, Buffer.from(await tarball.arrayBuffer()));
    if (name === packages[0]) {
      assert.equal(execute('tar', ['-xOzf', archive, 'package/src/index.js']),
        'module.exports = 42;');
    }
    state.published.push(name + '@' + expectedVersion);
  }
  state.result = 'PASS';
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  const fence = String.fromCharCode(96).repeat(3);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '# SPARK-866626: ' + state.kind + ' proof', '',
    'Result: **PASS**. Increment and deploy ran without an empty-list guard.', '',
    '| Field | Value |', '| --- | --- |',
    '| Before merge | ' + state.before + ' |',
    '| After merge | ' + state.head + ' |',
    '| Tooling source commit | ' + state.toolingCommit + ' |',
    '| Node / Yarn | ' + state.node + ' / ' + state.yarn + ' |',
    '| Node recursive selection | ' + JSON.stringify(state.outputs['node-recursive']) + ' |',
    '| Yarn recursive selection | ' + JSON.stringify(state.outputs['yarn-recursive']) + ' |',
    '| Manifest versions before | ' + state.versionsBefore.join(', ') + ' |',
    '| Manifest versions after | ' + state.versionsAfter.join(', ') + ' |',
    '| Packages in temporary registry | ' + (state.published.join(', ') || 'None') + ' |', '',
    'CLI/package tooling and the production deploy workflow match the reviewed commit.',
    'Only fork fixture packages publish, to a fresh loopback Verdaccio registry with no uplinks.',
    'The full SDK deploy pipeline is not run by this evidence workflow.', '',
    'Commands:', fence + 'sh', state.increment, state.deploy, fence, '',
  ].join('\n'));
  console.log(JSON.stringify(state, null, 2));
}

Promise.resolve().then(() => {
  if (process.argv[2] === 'collect') return collect();
  if (process.argv[2] === 'verify') return verify();
  throw new Error('Expected collect or verify');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
