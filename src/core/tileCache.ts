/**
 * LRU (Least Recently Used) cache for tile images.
 *
 * Prevents unbounded memory growth when navigating large areas.
 * Tiles accessed most recently are kept; oldest tiles are evicted first.
 */

/** Cache entry wrapping an HTMLImageElement. */
interface TileCacheEntry {
  image: HTMLImageElement;
  /** Last access timestamp (ms). */
  lastAccess: number;
}

/** Key format: `${sourceId}/${z}/${x}/${y}` */
function tileKey(sourceId: string, x: number, y: number, z: number): string {
  return `${sourceId}/${z}/${x}/${y}`;
}

export class TileImageCache {
  private cache = new Map<string, TileCacheEntry>();
  private maxEntries: number;

  constructor(maxEntries = 2000) {
    this.maxEntries = maxEntries;
  }

  /** Get a cached tile image, updating access time. Returns undefined if not cached. */
  get(sourceId: string, x: number, y: number, z: number): HTMLImageElement | undefined {
    const key = tileKey(sourceId, x, y, z);
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.lastAccess = performance.now();
    return entry.image;
  }

  /** Store a tile image. Evicts LRU entries if over capacity. */
  set(sourceId: string, x: number, y: number, z: number, image: HTMLImageElement): void {
    const key = tileKey(sourceId, x, y, z);
    // If already present, just update access time
    if (this.cache.has(key)) {
      this.cache.get(key)!.lastAccess = performance.now();
      return;
    }
    // Evict if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evict(Math.ceil(this.maxEntries * 0.1)); // evict ~10%
    }
    this.cache.set(key, { image, lastAccess: performance.now() });
  }

  /** Check if a tile is cached. */
  has(sourceId: string, x: number, y: number, z: number): boolean {
    return this.cache.has(tileKey(sourceId, x, y, z));
  }

  /** Remove a specific tile from cache. */
  delete(sourceId: string, x: number, y: number, z: number): void {
    this.cache.delete(tileKey(sourceId, x, y, z));
  }

  /** Evict the least recently used entries. */
  private evict(count: number): void {
    if (this.cache.size <= count) {
      this.cache.clear();
      return;
    }
    // Find the entries with the oldest access times
    let entries: TileCacheEntry[] = [];
    for (const entry of this.cache.values()) {
      entries.push(entry);
    }
    entries.sort((a, b) => a.lastAccess - b.lastAccess);
    const toEvict = entries.slice(0, count);
    // We need to find the keys for these entries — iterate and remove
    for (const entry of toEvict) {
      for (const [key, cachedEntry] of this.cache) {
        if (cachedEntry === entry) {
          this.cache.delete(key);
          break;
        }
      }
    }
  }

  /** Clear all cached tiles. */
  clear(): void {
    this.cache.clear();
  }

  /** Current number of cached tiles. */
  get size(): number {
    return this.cache.size;
  }

  /** Update max capacity at runtime. */
  setMaxEntries(max: number): void {
    this.maxEntries = max;
    if (this.cache.size > max) {
      this.evict(this.cache.size - max);
    }
  }
}

/** Singleton tile cache shared across the application. */
export const tileImageCache = new TileImageCache();
