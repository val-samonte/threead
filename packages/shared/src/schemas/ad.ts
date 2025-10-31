/**
 * Zod schemas for ad validation
 */

import { z } from 'zod';

export const CreateAdRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  description: z.string().max(2000, 'Description too long').optional(),
  call_to_action: z.string().max(100).optional(),
  link_url: z.string().url('link_url must be a valid URL').optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  days: z.number().int().min(1, 'Days must be at least 1').max(365, 'Days cannot exceed 365'),
  min_age: z.number().int().min(0, 'Minimum age cannot be negative').optional(),
  max_age: z.number().int().min(0, 'Maximum age cannot be negative').optional(),
  location: z.string().max(200).optional(),
  interests: z.array(z.string()).max(5, 'Maximum 5 interests allowed').optional(),
  media: z.instanceof(File).or(z.instanceof(Blob)).optional(),
}).refine(
  (data) => {
    // Both or neither latitude/longitude
    const hasLat = data.latitude !== undefined;
    const hasLon = data.longitude !== undefined;
    return hasLat === hasLon;
  },
  {
    message: 'Both latitude and longitude are required together',
    path: ['latitude'],
  }
).refine(
  (data) => {
    // min_age <= max_age if both provided
    if (data.min_age !== undefined && data.max_age !== undefined) {
      return data.min_age <= data.max_age;
    }
    return true;
  },
  {
    message: 'Minimum age cannot be greater than maximum age',
    path: ['max_age'],
  }
);

export const AdQueryParamsSchema = z.object({
  query: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius: z.number().min(0).optional(),
  min_age: z.number().int().min(0).optional(),
  max_age: z.number().int().min(0).optional(),
  interests: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
}).refine(
  (data) => {
    // If radius is provided, lat/lon are required
    if (data.radius !== undefined) {
      return data.latitude !== undefined && data.longitude !== undefined;
    }
    return true;
  },
  {
    message: 'Latitude and longitude are required when radius is provided',
    path: ['radius'],
  }
);

// Export TypeScript types inferred from schemas
export type CreateAdRequest = z.infer<typeof CreateAdRequestSchema>;
export type AdQueryParams = z.infer<typeof AdQueryParamsSchema>;

