import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com';
const COOKIE_PATH = '/api/participant';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24h

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { eventId, ...joinPayload } = body as { eventId: string; [k: string]: unknown };
  if (!eventId || typeof eventId !== 'string') {
    return NextResponse.json({ error: 'eventId requis' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/events/${eventId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(joinPayload),
    });
  } catch {
    return NextResponse.json({ error: 'API indisponible' }, { status: 502 });
  }

  const data = await upstream.json();
  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  // Strip token from client-visible response — stored server-side as HttpOnly cookie
  const { participantToken, ...publicData } = data as {
    participantToken?: string;
    [k: string]: unknown;
  };

  const response = NextResponse.json(publicData, { status: upstream.status });

  if (participantToken) {
    response.cookies.set(`rp-ptk-${eventId}`, participantToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE,
    });
  }

  return response;
}
