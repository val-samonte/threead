/**
 * Validation utilities using Zod
 */

import { CreateAdRequestSchema, AdQueryParamsSchema } from '../schemas/ad';
import type { ZodError } from 'zod';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate CreateAdRequest using Zod
 */
export function validateAdRequest(data: unknown): ValidationResult {
  const result = CreateAdRequestSchema.safeParse(data);
  
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.errors.map(err => {
    const path = err.path.join('.');
    return path ? `${path}: ${err.message}` : err.message;
  });

  return { valid: false, errors };
}

/**
 * Validate AdQueryParams using Zod
 */
export function validateAdQueryParams(data: unknown): ValidationResult {
  const result = AdQueryParamsSchema.safeParse(data);
  
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.errors.map(err => {
    const path = err.path.join('.');
    return path ? `${path}: ${err.message}` : err.message;
  });

  return { valid: false, errors };
}

/**
 * Parse and validate CreateAdRequest, throws on error
 */
export function parseAdRequest(data: unknown) {
  return CreateAdRequestSchema.parse(data);
}

/**
 * Parse and validate AdQueryParams, throws on error
 */
export function parseAdQueryParams(data: unknown) {
  return AdQueryParamsSchema.parse(data);
}

