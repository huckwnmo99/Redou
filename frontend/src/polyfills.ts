// Polyfills for APIs used by pdfjs-dist 5.x that are not yet available in
// Electron 35 (Chromium 134). These are TC39 Stage 4 proposals shipping in Chrome 136+.

// Uint8Array.prototype.toHex — used for document fingerprinting
if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function toHex(): string {
    let hex = "";
    for (let i = 0; i < this.length; i++) {
      hex += this[i].toString(16).padStart(2, "0");
    }
    return hex;
  };
}

// Map.prototype.getOrInsertComputed — used throughout PDF.js for caching
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Map.prototype.getOrInsertComputed = function getOrInsertComputed<K, V>(
    this: Map<K, V>,
    key: K,
    callbackFn: (key: K) => V,
  ): V {
    if (this.has(key)) {
      return this.get(key) as V;
    }
    const value = callbackFn(key);
    this.set(key, value);
    return value;
  };
}
