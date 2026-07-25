import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com';

// Whitelist — blocks tunnelling to /admin, /auth, /webhooks, /payments, etc.
const ALLOWED_PREFIXES = ['events/', 'submissions/', 'challenges/', 'participants/'];

type Context = { params: Promise<{ path: string[] }> | { path: string[] } };

async function forward(request: NextRequest, ctx: Context, method: string): Promise<NextResponse> {
  const { path: pathSegments } = await ctx.params;

  // Reject path traversal
  if (pathSegments.some(s => s.includes('..') || s.includes('://'))) {
    return NextResponse.json({ error: 'Chemin invalide' }, { status: 400 });
  }

  const upstreamPath = pathSegments.join('/');

  if (!ALLOWED_PREFIXES.some(p => upstreamPath.startsWith(p))) {
    return NextResponse.json({ error: 'Route non autorisée' }, { status: 403 });
  }

  const cookieStore = await cookies();

  // Find the participant token. Try to extract eventId from the URL path first,
  // then fall back to the _eid query param (for paths like /submissions/:id/participant
  // that don't carry an eventId in the URL).
  let eventId: string | undefined;
  const pathMatch = upstreamPath.match(/^events\/([^/?]+)/);
  if (pathMatch) {
    eventId = pathMatch[1];
  } else {
    eventId = request.nextUrl.searchParams.get('_eid') ?? undefined;
  }

  const token = eventId ? cookieStore.get(`rp-ptk-${eventId}`)?.value : undefined;

  // Build upstream URL, preserving all query params except the internal _eid sentinel
  const upstreamUrl = new URL(`${API_URL}/${upstreamPath}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== '_eid') upstreamUrl.searchParams.set(key, value);
  });

  const upstreamHeaders: Record<string, string> = {};
  const origContentType = request.headers.get('content-type');
  if (origContentType) upstreamHeaders['content-type'] = origContentType;
  if (token) upstreamHeaders['authorization'] = `Bearer ${token}`;

  // Use blob() to preserve binary bodies (multipart uploads)
  const body = method !== 'GET' && method !== 'HEAD' ? await request.blob() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method,
      headers: upstreamHeaders,
      body,
    });
  } catch {
    return NextResponse.json({ error: 'API indisponible' }, { status: 502 });
  }

  const resContentType = upstream.headers.get('content-type') || '';

  if (resContentType.includes('application/json')) {
    const json = await upstream.json();
    return NextResponse.json(json, { status: upstream.status });
  }

  // Binary response (zip, pdf, image, etc.) — stream buffer through
  const buffer = await upstream.arrayBuffer();
  const resHeaders = new Headers({ 'content-type': resContentType });
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) resHeaders.set('content-disposition', disposition);

  return new NextResponse(buffer, { status: upstream.status, headers: resHeaders });
}

export async function GET(req: NextRequest, ctx: Context) { return forward(req, ctx, 'GET'); }
export async function POST(req: NextRequest, ctx: Context) { return forward(req, ctx, 'POST'); }
export async function DELETE(req: NextRequest, ctx: Context) { return forward(req, ctx, 'DELETE'); }
export async function PATCH(req: NextRequest, ctx: Context) { return forward(req, ctx, 'PATCH'); }
export async function PUT(req: NextRequest, ctx: Context) { return forward(req, ctx, 'PUT'); }
