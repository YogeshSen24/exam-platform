import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { sha256Hex } from '../crypto/canonical.js';

/**
 * Infrastructure adapters.
 *
 * Each has a production-shaped interface and an in-memory implementation so the
 * POC runs with no external services. Docker Compose supplies the real
 * PostgreSQL, Redis and MinIO services when they are available.
 */

/* ------------------------------- cache ---------------------------- */

export interface CacheAdapter {
  readonly driver: 'memory' | 'redis';
  readonly label: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Simulated outage used by the operations console. */
  setAvailability(available: boolean): void;
  isAvailable(): boolean;
}

class MemoryCache implements CacheAdapter {
  readonly driver = 'memory' as const;
  readonly label = 'In-memory cache (Redis-compatible interface)';
  #entries = new Map<string, { value: unknown; expiresAt: number | null }>();
  #available = true;

  #assert() {
    if (!this.#available) throw new Error('Cache unavailable (simulated outage)');
  }

  async get<T>(key: string): Promise<T | null> {
    this.#assert();
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.#assert();
    this.#entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    this.#assert();
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.set(key, next, ttlSeconds);
    return next;
  }

  setAvailability(available: boolean): void {
    this.#available = available;
  }

  isAvailable(): boolean {
    return this.#available;
  }
}

/* --------------------------- object store ------------------------- */

export interface StoredObject {
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ObjectStoreAdapter {
  readonly driver: 'memory' | 's3';
  readonly label: string;
  readonly bucket: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Objects still waiting to be flushed — surfaced as "upload delayed". */
  queuedCount(): number;
  setDelay(delayed: boolean): void;
}

class MemoryObjectStore implements ObjectStoreAdapter {
  readonly driver = 'memory' as const;
  readonly label = 'In-memory evidence store (S3/MinIO-compatible interface)';
  readonly bucket = env.S3_BUCKET;
  #objects = new Map<string, { meta: StoredObject; body: Buffer }>();
  #queue: string[] = [];
  #delayed = false;

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const meta: StoredObject = {
      bucket: this.bucket,
      key,
      contentType,
      sizeBytes: body.length,
      sha256: sha256Hex(body),
      createdAt: new Date().toISOString(),
    };
    if (this.#delayed) {
      this.#queue.push(key);
    }
    this.#objects.set(key, { meta, body });
    return meta;
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.#objects.get(key)?.meta ?? null;
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
    this.#queue = this.#queue.filter((k) => k !== key);
  }

  queuedCount(): number {
    return this.#queue.length;
  }

  setDelay(delayed: boolean): void {
    this.#delayed = delayed;
    if (!delayed) this.#queue = [];
  }
}

/* ----------------------------- database --------------------------- */

export interface DatabaseAdapter {
  readonly driver: 'memory' | 'postgres';
  readonly label: string;
  /** Simulated query latency, surfaced on the operations dashboard. */
  latencyMs(): number;
  setLatency(ms: number): void;
  isHealthy(): boolean;
}

class MemoryDatabase implements DatabaseAdapter {
  readonly driver = 'memory' as const;
  readonly label = 'In-process demo database (Prisma/PostgreSQL schema supplied)';
  #latency = 3;
  latencyMs(): number {
    return this.#latency + Math.round(Math.random() * 2);
  }
  setLatency(ms: number): void {
    this.#latency = ms;
  }
  isHealthy(): boolean {
    return this.#latency < 500;
  }
}

/* ----------------------------- registry --------------------------- */

export const cache: CacheAdapter = new MemoryCache();
export const objectStore: ObjectStoreAdapter = new MemoryObjectStore();
export const database: DatabaseAdapter = new MemoryDatabase();

export function newId(): string {
  return randomUUID();
}
