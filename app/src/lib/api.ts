import axios from 'axios';

// audit: INFO-019 / INFO-024 — fallback prod en dur conserve pour ne rien casser,
// mais on loggue un avertissement si NEXT_PUBLIC_API_URL manque afin qu'un
// build dev/preview ne tape pas silencieusement la prod.
// TODO(audit:INFO-024): centraliser les URLs d'API dans un module de config unique
// partage entre app/panel/admin et faire echouer le build si la var d'env est absente.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com';
if (!process.env.NEXT_PUBLIC_API_URL && typeof window !== 'undefined') {
  console.warn('[api] NEXT_PUBLIC_API_URL absent : fallback sur la production (https://api.rallye-photo.com)');
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
