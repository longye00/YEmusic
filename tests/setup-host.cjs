const net = require('../electron/net.cjs');
const conv = r => ({ ...r, bytes: r.bytes ? new Uint8Array(r.bytes) : undefined });
globalThis.window = globalThis.window || {};
globalThis.window.ye = {
  fetch: async req => conv(await net.request(req)),
  pluginFetch: async req => conv(await net.request(req)),
  fetchImage: async req => conv(await net.request(req)),
};
