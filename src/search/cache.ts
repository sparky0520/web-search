import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

interface CacheEntry {
  timestamp: number;
  data: unknown;
}

export class SearchCache {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private diskCachePath: string;
  private mode: 'off' | 'record' | 'replay';
  private ttlMs: number = 10 * 60 * 1000; // 10 minutes in memory

  constructor(mode: 'off' | 'record' | 'replay' = config.SEARCH_CACHE as 'off' | 'record' | 'replay', dataDir: string = config.DATA_DIR) {
    this.mode = mode;
    this.diskCachePath = join(dataDir, 'cache', 'search_cache.json');
    if (this.mode === 'record' || this.mode === 'replay') {
      this.loadDiskCache();
    }
  }

  private loadDiskCache(): void {
    if (existsSync(this.diskCachePath)) {
      try {
        const raw = readFileSync(this.diskCachePath, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.memoryCache.set(k, { timestamp: Date.now(), data: v });
        }
      } catch (err) {
        console.warn('Could not read disk cache:', err);
      }
    }
  }

  private saveDiskCache(): void {
    try {
      const dir = join(config.DATA_DIR, 'cache');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const serializable: Record<string, unknown> = {};
      for (const [k, v] of this.memoryCache.entries()) {
        serializable[k] = v.data;
      }
      writeFileSync(this.diskCachePath, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Could not write disk cache:', err);
    }
  }

  public get<T>(key: string): T | null {
    if (this.mode === 'off') {
      // Memory cache only
      const item = this.memoryCache.get(key);
      if (!item) return null;
      if (Date.now() - item.timestamp > this.ttlMs) {
        this.memoryCache.delete(key);
        return null;
      }
      return item.data as T;
    }

    if (this.mode === 'replay') {
      const item = this.memoryCache.get(key);
      return item ? (item.data as T) : null;
    }

    if (this.mode === 'record') {
      const item = this.memoryCache.get(key);
      if (item && Date.now() - item.timestamp <= this.ttlMs) {
        return item.data as T;
      }
      return null;
    }

    return null;
  }

  public set<T>(key: string, data: T): void {
    this.memoryCache.set(key, { timestamp: Date.now(), data });
    if (this.mode === 'record') {
      this.saveDiskCache();
    }
  }
}

export const searchCache = new SearchCache();

