// Polyfills for brand-new TC39 methods that pdf.js v6 calls internally but
// iPad Safari ≤18.5 (and other not-yet-updated engines) don't implement yet.
// Without them the contract PDF preview breaks on iPad:
//   • Map.prototype.getOrInsertComputed  (TC39 "upsert") — main-thread render
//     throws, every page renders blank white.
//   • Math.sumPrecise — embedded-font parse (checkAndRepair) throws, pdf.js
//     falls back to a system font, so Thai combining marks (สระบน / ไม้หันอากาศ
//     / tone marks) mis-stack and the text isn't Sarabun.
//
// Must run BEFORE pdf.js loads. The worker is a separate realm — it gets the
// same polyfills injected via the Blob shim in PdfCanvasViewer.

function defineGetOrInsertComputed(proto: object) {
  const p = proto as { getOrInsertComputed?: unknown };
  if (typeof p.getOrInsertComputed === 'function') return;
  Object.defineProperty(proto, 'getOrInsertComputed', {
    value: function <K, V>(this: Map<K, V> | WeakMap<object, V>, key: K, callback: (key: K) => V): V {
      const map = this as Map<K, V>;
      if (map.has(key)) return map.get(key) as V;
      const value = callback(key);
      map.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

defineGetOrInsertComputed(Map.prototype);
defineGetOrInsertComputed(WeakMap.prototype);

// Math.sumPrecise(iterable) — sum of numbers, order-independent and precise.
// A plain reduce is accurate enough for pdf.js's use (summing byte lengths).
const M = Math as unknown as { sumPrecise?: (values: Iterable<number>) => number };
if (typeof M.sumPrecise !== 'function') {
  M.sumPrecise = (values: Iterable<number>): number => {
    let sum = 0;
    for (const v of values) sum += v;
    return sum;
  };
}
