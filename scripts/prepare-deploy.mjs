// Optional helper for Cloudflare Workers Builds: allows overriding worker name
// and existing KV namespace ID via build environment variables without hardcoding
// private IDs into public wrangler.toml.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');

const workerName = (process.env.CF_WORKER_NAME || '').trim();
const kvId = (process.env.CF_KV_ID || '').trim();

if (workerName) {
  toml = toml.replace(/^name\s*=\s*"[^"]*"/m, `name = "${workerName}"`);
}

if (kvId) {
  toml = toml.replace(/#\s*id\s*=\s*"your-existing-kv-namespace-id"/m, `id = "${kvId}"`);
}

fs.writeFileSync(path.join(root, 'wrangler.generated.toml'), toml, 'utf8');
console.log(
  `Prepared wrangler.generated.toml (name=${workerName || 'default'}, kvId=${kvId ? 'configured' : 'auto'})`
);
