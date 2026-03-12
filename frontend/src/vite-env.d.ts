/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// TC39 proposals (Chrome 136+, polyfilled for Electron 35 / Chromium 134)
interface Uint8Array {
  toHex(): string;
}

interface Map<K, V> {
  getOrInsertComputed(key: K, callbackFn: (key: K) => V): V;
}
