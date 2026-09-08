import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Errors } from './errors.js';
import { getDb } from './store/db.js';

/** Parses a body or query with Zod and raises a structured validation error. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw Errors.validation(result.error.flatten());
  }
  return result.data;
}

/**
 * Marks a response as sensitive: no cache may retain it. Applied to anything
 * carrying question content, candidate identity or cryptographic metadata.
 */
export function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
}

export function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
    throw Errors.validation({ 'Idempotency-Key': 'A stable Idempotency-Key header between 8 and 128 characters is required.' });
  }
  return key;
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

export function readPageParams(query: unknown): { page: number; pageSize: number } {
  const q = (query ?? {}) as Record<string, string>;
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 25) || 25));
  return { page, pageSize };
}

export function countRequest(): void {
  getDb().counters.requestsThisMinute += 1;
}
