import axios from 'axios';
import Cookies from 'js-cookie';

// audit: HIGH-017 / LOW-070 — options de cookie durcies, partagees entre login (page.tsx),
// l'impersonation et l'interceptor de refresh ci-dessous (attributs coherents partout).
// secure: true en prod (cookies jamais envoyes en clair sur HTTP), sameSite strict (anti-CSRF).
// TODO(httpOnly): le durcissement reel reste de faire poser ces cookies par l'API en
// Set-Cookie httpOnly + Secure + SameSite=Strict (non realisable ici sans refonte API + tests e2e).
export const COOKIE_OPTS: Cookies.CookieAttributes = {
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = Cookies.get('adminAccessToken');
  if (token) {
    config.headers.Authorization = 'Bearer ' + token;
  }
  return config;
});

// audit: LOW-084 / MED-021 — single-flight refresh : une seule promesse de refresh partagee.
// Les 401 concurrents s'y abonnent puis rejouent leur requete avec le nouveau token, au lieu
// de declencher chacun leur propre POST /auth/refresh (qui, avec la rotation a detection de
// reutilisation, invalide la session). null quand aucun refresh n'est en cours.
let refreshPromise: Promise<string> | null = null;

function purgeAndRedirect() {
  Cookies.remove('adminAccessToken');
  Cookies.remove('adminRefreshToken');
  Cookies.remove('adminUser');
  window.location.href = '/auth/login';
}

// Effectue (ou rejoint) l'unique refresh en cours et renvoie le nouvel accessToken.
function doRefresh(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    // audit: LOW-080 — verifier la presence du refreshToken avant tout aller-retour reseau.
    const refreshToken = Cookies.get('adminRefreshToken');
    if (!refreshToken) {
      throw new Error('NO_REFRESH_TOKEN');
    }
    const { data } = await axios.post(API_BASE + '/auth/refresh', { refreshToken });
    // audit: LOW-070 — reutiliser COOKIE_OPTS (sameSite strict + secure) au refresh, comme au login.
    Cookies.set('adminAccessToken', data.accessToken, { expires: 1, ...COOKIE_OPTS });
    Cookies.set('adminRefreshToken', data.refreshToken, { expires: 30, ...COOKIE_OPTS });
    return data.accessToken as string;
  })();

  // Liberer le verrou une fois la promesse resolue/rejetee (sans masquer le resultat).
  refreshPromise.finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // audit: LOW-081 / MED-022 — tenter le refresh sur TOUT 401 non deja retente
    // (plus seulement code === 'TOKEN_EXPIRED'), puis purger + rediriger si le refresh echoue,
    // pour ne plus laisser l'UI affichee avec des appels qui echouent silencieusement.
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        const accessToken = await doRefresh(); // audit: LOW-084 — promesse partagee
        original.headers = original.headers || {};
        original.headers.Authorization = 'Bearer ' + accessToken;
        return api(original);
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
