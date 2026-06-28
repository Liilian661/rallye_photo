import axios from 'axios';
import Cookies from 'js-cookie';
import { COOKIE_OPTS } from '@/lib/auth';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // envoie les cookies HttpOnly automatiquement
});

// Add access token to every request
api.interceptors.request.use((config) => {
  const token = Cookies.get('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// audit: MED-021 — single-flight refresh : une seule promesse de refresh partagee.
// Les 401 concurrents s'y abonnent puis rejouent leur requete avec le nouveau token,
// au lieu de declencher chacun leur propre POST /auth/refresh (qui, avec la rotation a
// detection de reutilisation, invalide la session). null quand aucun refresh n'est en cours.
let refreshPromise: Promise<string> | null = null;

function purgeAndRedirect() {
  Cookies.remove('accessToken');
  Cookies.remove('refreshToken');
  Cookies.remove('user');
  window.location.href = '/auth/login';
}

// Effectue (ou rejoint) l'unique refresh en cours et renvoie le nouvel accessToken.
function doRefresh(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    // Pour les sessions HttpOnly, le cookie refreshToken est envoyé automatiquement
    // via withCredentials. Pour les anciennes sessions (js-cookie), on l'envoie aussi dans le body.
    const legacyRefreshToken = Cookies.get('refreshToken');
    const body = legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {};
    const { data } = await axios.post(
      `${process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com'}/auth/refresh`,
      body,
      { withCredentials: true }
    );
    // Mettre à jour les cookies legacy si présents (backward compat)
    if (data.accessToken && legacyRefreshToken) {
      Cookies.set('accessToken', data.accessToken, { expires: 1, ...COOKIE_OPTS });
    }
    if (data.refreshToken && legacyRefreshToken) {
      Cookies.set('refreshToken', data.refreshToken, { expires: 30, ...COOKIE_OPTS });
    }
    return (data.accessToken as string) || '';
  })();

  // Liberer le verrou une fois la promesse resolue/rejetee (sans masquer le resultat).
  refreshPromise.finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

// Handle token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // audit: MED-022 — tenter le refresh sur TOUT 401 non deja retente (plus seulement
    // code === 'TOKEN_EXPIRED'), puis purger + rediriger si le refresh echoue.
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const accessToken = await doRefresh(); // audit: MED-021 — promesse partagee
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // audit: MED-022 — echec de refresh => purge + redirection login
        purgeAndRedirect();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
