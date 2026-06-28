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
  // audit: LOW-051 — valide le format date-time ISO 8601 (le panel envoie
  // deja des chaines .toISOString()), au lieu d'accepter toute chaine pouvant
  // produire une deadline non parsable en base.
  eventDate:   z.string().datetime().optional().nullable(),
  deadline:    z.string().datetime().optional().nullable(),
  scoringMode: z.enum(['winner', 'participation']).optional().default('winner'),
  teamMode:    z.boolean().optional().default(false),
});

export const createChallengeSchema = z.object({
  title: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).optional().nullable(),
  points: z.number().int().min(1).max(1000).default(10),
  isSurprise: z.boolean().optional().default(false),
});

export const updateEventSchema = z.object({
  name:           z.string().min(1).max(255).trim().optional(),
  description:    z.string().max(2000).optional().nullable(),
  eventDate:      z.string().datetime().optional().nullable(),
  deadline:       z.string().datetime().optional().nullable(),
  galleryEnabled: z.boolean().optional(),
  status:         z.enum(['active', 'ended', 'archived']).optional(),
  scoringMode:    z.enum(['winner', 'participation']).optional(),
  teamMode:       z.boolean().optional(),
  themeColor:     z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255).trim().toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token:    z.string().min(1).max(128),
  password: z.string().min(8).max(128),
});

export const adminCreateUserSchema = z.object({
  firstName: z.string().min(1).max(100).trim(),
  lastName:  z.string().min(1).max(100).trim(),
  email:     z.string().email().max(255).trim().toLowerCase(),
  password:  z.string().min(8).max(128),
  plan:      z.enum(['free', 'pro']).optional().default('free'),
});

export const joinEventSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  deviceId: z.string().max(255).optional().nullable(),
  // audit: LOW-051 — teamId est un identifiant de team (UUID) : valide le
  // format UUID plutot qu'une chaine arbitraire de max 36. Reste optionnel
  // (events sans team) — null/undefined acceptes.
  teamId: z.string().uuid().optional().nullable(),
});