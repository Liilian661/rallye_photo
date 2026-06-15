import { z } from 'zod';

export const registerSchema = z.object({
  firstName:    z.string().min(1).max(100).trim(),
  lastName:     z.string().min(1).max(100).trim(),
  email:        z.string().email().max(255).trim().toLowerCase(),
  password:     z.string().min(8).max(128),
  newsletter:   z.boolean().optional().default(false),
  referralCode: z.string().max(8).trim().toUpperCase().optional(),
});

export const loginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1),
});

export const createEventSchema = z.object({
  name:        z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional().nullable(),
  eventDate:   z.string().optional().nullable(),
  deadline:    z.string().optional().nullable(),
  scoringMode: z.enum(['winner', 'participation']).optional().default('winner'),
  teamMode:    z.boolean().optional().default(false),
});

export const createChallengeSchema = z.object({
  title: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).optional().nullable(),
  points: z.number().int().min(1).max(1000).default(10),
  isSurprise: z.boolean().optional().default(false),
});

export const joinEventSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  deviceId: z.string().max(255).optional().nullable(),
  teamId: z.string().max(36).optional().nullable(),
});