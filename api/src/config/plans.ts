// Limites par TIER d'événement (free / premium / pro)
export const EVENT_TIER_LIMITS = {
  free: {
    challenges: 5,
    participants: 20,
    galleryDays: 2,
    publicVote: false,
    surpriseChallenges: false,
    branding: false,
    exportZip: false,
  },
  premium: {
    challenges: -1,   // illimité
    participants: 150,
    galleryDays: 60,
    publicVote: true,
    surpriseChallenges: true,
    branding: true,
    exportZip: true,
  },
  pro: {
    challenges: -1,
    participants: -1, // illimité
    galleryDays: 365,
    publicVote: true,
    surpriseChallenges: true,
    branding: true,
    exportZip: true,
  },
} as const;

export type EventTier = keyof typeof EVENT_TIER_LIMITS;

// Plans utilisateur (subscription)
export const USER_PLANS = {
  free: {
    name: 'Gratuit',
    maxFreeEvents: 1,   // nombre max d'events tier=free simultanés
    price: 0,
  },
  pro: {
    name: 'Pro',
    maxFreeEvents: -1,  // illimité
    price: 24,
  },
} as const;

// Prix d'un crédit événement premium (achat unique)
export const EVENT_CREDIT_PRICE = 12;

/**
 * Retourne la limite pour un tier donné.
 * -1 en valeur interne → renvoie 999999 (illimité côté code)
 */
export function getEventLimit(tier: string, key: 'challenges' | 'participants'): number {
  const t = EVENT_TIER_LIMITS[tier as EventTier] ?? EVENT_TIER_LIMITS.free;
  const val = t[key];
  return val === -1 ? 999999 : val;
}

/**
 * Détermine le tier d'un nouvel événement selon le plan et les crédits de l'utilisateur.
 */
export function resolveEventTier(plan: string, eventCredits: number): EventTier {
  if (plan === 'pro') return 'pro';
  if (eventCredits > 0) return 'premium';
  return 'free';
}
