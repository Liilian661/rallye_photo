import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> | { eventId: string } }
) {
  const { eventId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(`rp-ptk-${eventId}`)?.value;

  if (!token) {
    return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
  }

  return NextResponse.json({ token });
}
