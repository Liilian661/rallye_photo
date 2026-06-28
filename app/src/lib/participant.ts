export interface ParticipantInfo {
  id: string;
  name: string;
  eventId: string;
  eventCode: string;
  eventName: string;
  teamId?: string;
  teamName?: string;
  // audit: CRIT-001 — token participant signe par l'API (Bearer pour submit/vote/delete)
  participantToken?: string;
}

const STORAGE_KEY = (eventId: string) => `rp-participant-${eventId}`;

export function getParticipant(eventId: string): ParticipantInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    // sessionStorage : effacé à la fermeture de l'onglet (surface d'attaque réduite vs localStorage)
    const raw = sessionStorage.getItem(STORAGE_KEY(eventId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveParticipant(info: ParticipantInfo): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY(info.eventId), JSON.stringify(info));
}

export function clearParticipant(eventId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY(eventId));
}