// Polyfills for the Web Worker context.
// pdfjs-dist 5.x uses TC39 Stage 4 APIs (Chrome 136+) but Electron 35 has Chromium 134.

if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function toHex(): string {
    let hex = "";
    for (let i = 0; i < this.length; i++) {
      hex += this[i].toString(16).padStart(2, "0");
    }
    return hex;
  };
}

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

// Re-export the real worker
import "pdfjs-dist/build/pdf.worker.min.mjs";
