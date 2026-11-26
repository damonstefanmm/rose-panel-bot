// Default no-op stub when running with Cloudflare Workers `[assets]` binding.
// During standalone single-module API uploads, scripts/build-standalone.mjs
// generates an inlined asset map bundle in `.build/worker-standalone.js`.

export function serveEmbeddedAsset(_pathname) {
  return null;
}
