import type { Request } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);

export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new HttpError(400, "Validation failed", z.flattenError(result.error));
  }
  return result.data;
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown, label = "Validation failed"): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, label, z.flattenError(result.error));
  return result.data;
}

/** Express 5 types params as string | string[]; we only ever use plain strings. */
export function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}
