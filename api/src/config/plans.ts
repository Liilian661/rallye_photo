export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    events: 1,
    challengesPerEvent: 2,
    participantsPerEvent: 30,
    galleryDays: 1,
    surpriseChallenges: false,
    publicVote: false,
    galleryDownload: false,
    support: 'email',
  },
  starter: {
    name: 'Starter',
    price: 9,
    events: 5,
    challengesPerEvent: 10,
    participantsPerEvent: 100,
    galleryDays: 7,
    surpriseChallenges: true,
    publicVote: false,
    galleryDownload: true,
    support: 'email',
  },
  pro: {
    name: 'Pro',
    price: 29,
    events: -1, // unlimited
    challengesPerEvent: -1,
    participantsPerEvent: -1,
    galleryDays: 30,
    surpriseChallenges: true,
    publicVote: true,
    galleryDownload: true,
    support: 'priority',
  },
} as const;

export type PlanName = keyof typeof PLANS;

export function getPlanLimit(plan: string, key: 'events' | 'challengesPerEvent' | 'participantsPerEvent'): number {
  const p = PLANS[plan as PlanName];
  if (!p) return PLANS.free[key];
  const val = p[key];
  return val === -1 ? 999999 : val;
}
