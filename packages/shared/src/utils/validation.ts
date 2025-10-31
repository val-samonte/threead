/**
 * Ad validation utilities
 */

import type { CreateAdRequest } from '../types/ad';

export function validateAdRequest(req: CreateAdRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Title is required and must be non-empty
  if (!req.title || req.title.trim().length === 0) {
    errors.push('Title is required');
  } else if (req.title.length > 200) {
    errors.push('Title must be 200 characters or less');
  }

  // Days validation
  if (req.days < 1) {
    errors.push('Days must be at least 1');
  } else if (req.days > 365) {
    errors.push('Days cannot exceed 365');
  }

  // Location coordinates validation
  if (req.latitude !== undefined) {
    if (req.latitude < -90 || req.latitude > 90) {
      errors.push('Latitude must be between -90 and 90');
    }
    if (req.longitude === undefined) {
      errors.push('Longitude is required when latitude is provided');
    }
  }

  if (req.longitude !== undefined) {
    if (req.longitude < -180 || req.longitude > 180) {
      errors.push('Longitude must be between -180 and 180');
    }
    if (req.latitude === undefined) {
      errors.push('Latitude is required when longitude is provided');
    }
  }

  // Age range validation
  if (req.min_age !== undefined && req.min_age < 0) {
    errors.push('Minimum age cannot be negative');
  }
  if (req.max_age !== undefined && req.max_age < 0) {
    errors.push('Maximum age cannot be negative');
  }
  if (req.min_age !== undefined && req.max_age !== undefined && req.min_age > req.max_age) {
    errors.push('Minimum age cannot be greater than maximum age');
  }

  // Interests validation (≤5)
  if (req.interests && req.interests.length > 5) {
    errors.push('Maximum 5 interests allowed');
  }

  // URL validation
  if (req.link_url) {
    try {
      new URL(req.link_url);
    } catch {
      errors.push('link_url must be a valid URL');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

