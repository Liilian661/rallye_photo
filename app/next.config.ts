import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com';
// socket.io uses WebSocket — build the ws(s):// counterpart
const wsUrl = apiUrl.replace(/^https/, 'wss').replace(/^http(?!s)/, 'ws');

// app.rallye-photo.com — app participant (PWA)
// Needs: camera/microphone (CameraModal), blob: media, S3 images, socket.io WS
const csp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // https: covers S3 signed URLs (hostname configurable via admin panel)
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  `connect-src 'self' ${apiUrl} ${wsUrl}`,
  // blob: needed for service worker and offline queue
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy',    value: csp },
  { key: 'X-Frame-Options',            value: 'DENY' },
  { key: 'X-Content-Type-Options',     value: 'nosniff' },
  { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control',     value: 'on' },
  // camera/microphone intentionally NOT restricted — required by CameraModal
  { key: 'Permissions-Policy',         value: 'geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
