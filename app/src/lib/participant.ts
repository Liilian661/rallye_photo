export interface ParticipantInfo {
  id: string;
  name: string;
  eventId: string;
  eventCode: string;
  eventName: string;
  teamId?: string;
  teamName?: string;
}

export function getParticipant(eventId: string): ParticipantInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`rp-participant-${eventId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveParticipant(info: ParticipantInfo): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`rp-participant-${info.eventId}`, JSON.stringify(info));
}

export function clearParticipant(eventId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`rp-participant-${eventId}`);
}