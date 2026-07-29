import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com';

// panel.rallye-photo.com — panel organisateur
// Pas de camera/micro ; connect limité à l'API ; Stripe checkout = redirect externe (pas Stripe.js)
const csp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  `connect-src 'self' ${apiUrl}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy',    value: csp },
  { key: 'X-Frame-Options',            value: 'DENY' },
  { key: 'X-Content-Type-Options',     value: 'nosniff' },
  { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control',     value: 'on' },
  { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
