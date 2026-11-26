// Builds a standalone single-module Cloudflare Worker bundle (`.build/worker-standalone.js`)
// containing both Worker logic and compiled Vite Mini App assets for direct API uploads.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const outDir = path.join(root, '.build');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('dist/index.html not found. Run `npm run build` first.');
}

function walkFiles(dir, base = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, rel));
    } else {
      results.push({ webPath: `/${rel}`, fullPath: full });
    }
  }
  return results;
}

function contentTypeOf(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

const files = walkFiles(distDir);
const assetMap = {};
for (const f of files) {
  assetMap[f.webPath] = {
    type: contentTypeOf(f.webPath),
    body: fs.readFileSync(f.fullPath, 'utf8'),
    immutable: f.webPath.startsWith('/assets/'),
  };
}

fs.mkdirSync(outDir, { recursive: true });

// Temporarily generate embedded-assets module, bundle with esbuild (bundled inside vite), then restore stub
const embeddedPath = path.join(root, 'src/worker/embedded-assets.js');
const originalStub = fs.readFileSync(embeddedPath, 'utf8');

const generatedModule = `// Auto-generated embedded Mini App assets for standalone single-module upload
const ASSETS_MAP = ${JSON.stringify(assetMap)};

export function serveEmbeddedAsset(pathname) {
  const entry = ASSETS_MAP[pathname] || ASSETS_MAP['/index.html'];
  if (!entry) return null;
  return new Response(entry.body, {
    status: 200,
    headers: {
      'Content-Type': entry.type,
      'Cache-Control': entry.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}
`;

try {
  fs.writeFileSync(embeddedPath, generatedModule, 'utf8');
  execSync(
    `npx esbuild src/worker/index.js --bundle --format=esm --platform=neutral --target=es2022 --minify --outfile=.build/worker-standalone.js`,
    { stdio: 'inherit', cwd: root }
  );
  const stat = fs.statSync(path.join(outDir, 'worker-standalone.js'));
  console.log(`Built .build/worker-standalone.js (${(stat.size / 1024).toFixed(1)} KiB)`);
} finally {
  fs.writeFileSync(embeddedPath, originalStub, 'utf8');
}
