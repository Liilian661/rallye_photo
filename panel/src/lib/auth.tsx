'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import Cookies from 'js-cookie';
import api from '@/lib/api';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  plan: string;
  eventCredits: number;
  emailVerified?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>; // audit: LOW-072 — logout async (attend la revocation backend)
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  newsletter: boolean;
  referralCode?: string;
}

// audit: HIGH-015 / LOW-071 — durcissement des cookies js-cookie : sameSite strict + secure en prod.
// Exporte pour etre reutilise par l'interceptor de refresh (api.ts) afin que login ET refresh
// posent des cookies aux memes attributs (cf LOW-070).
// TODO(audit:HIGH-015): migrer vers des cookies httpOnly + Secure poses cote API (Set-Cookie)
// et supprimer accessToken/refreshToken du body JSON. Non realise ici (necessite changement API
// + tests end-to-end), donc on durcit a minima cote client.
export const COOKIE_OPTS = {
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// audit: INFO-033 / INFO-034 — normalisation unique de l'objet user (forme coherente entre
// login, register et refreshUser ; champs toujours definis).
function normalizeUser(raw: Partial<User> & Record<string, unknown>): User {
  return {
    id: String(raw.id ?? ''),
    firstName: String(raw.firstName ?? ''),
    lastName: String(raw.lastName ?? ''),
    email: String(raw.email ?? ''),
    plan: String(raw.plan ?? ''),
    eventCredits: typeof raw.eventCredits === 'number' ? raw.eventCredits : 0,
    emailVerified: !!raw.emailVerified,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = Cookies.get('user');
    if (savedUser) {
      try {
        setUser(normalizeUser(JSON.parse(savedUser)));
      } catch {
        Cookies.remove('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    Cookies.set('accessToken', data.accessToken, { expires: 1, ...COOKIE_OPTS });
    Cookies.set('refreshToken', data.refreshToken, { expires: 30, ...COOKIE_OPTS });
    try {
      const { data: profile } = await api.get('/auth/me');
      const fullUser = normalizeUser(profile); // audit: INFO-033/INFO-034
      Cookies.set('user', JSON.stringify(fullUser), { expires: 30, ...COOKIE_OPTS });
      setUser(fullUser);
    } catch {
      const fallbackUser = normalizeUser(data.user || {}); // audit: INFO-034 — normaliser meme le fallback
      Cookies.set('user', JSON.stringify(fallbackUser), { expires: 30, ...COOKIE_OPTS });
      setUser(fallbackUser);
    }
  };

  const register = async (registerData: RegisterData) => {
    const { data } = await api.post('/auth/register', registerData);
    // audit: INFO-033 — normaliser comme login/refreshUser (eventCredits, plan...), emailVerified force a false.
    const newUser = normalizeUser({ ...data.user, emailVerified: false });
    Cookies.set('accessToken', data.accessToken, { expires: 1, ...COOKIE_OPTS });
    Cookies.set('refreshToken', data.refreshToken, { expires: 30, ...COOKIE_OPTS });
    Cookies.set('user', JSON.stringify(newUser), { expires: 30, ...COOKIE_OPTS });
    setUser(newUser);
  };

  // audit: INFO-025 — memoise (useCallback) pour une reference stable, ce qui permet aux consommateurs
  // (ex: pricing) de l'inclure dans leurs deps useEffect sans re-execution intempestive.
  const refreshUser = useCallback(async () => {
    try {
      const { data: profile } = await api.get('/auth/me');
      const updatedUser = normalizeUser(profile); // audit: INFO-034
      Cookies.set('user', JSON.stringify(updatedUser), { expires: 30, ...COOKIE_OPTS });
      setUser(updatedUser);
    } catch {
      // ignore
    }
  }, []);

  const logout = async () => {
    // audit: LOW-072 — attendre la revocation backend (avec timeout) AVANT de purger les cookies
    // et de naviguer, sinon la navigation full-page peut interrompre la requete XHR et laisser le
    // refreshToken valide cote serveur 30j. On borne l'attente pour ne pas bloquer l'UI.
    const refreshToken = Cookies.get('refreshToken');
    if (refreshToken) {
      try {
        await Promise.race([
          api.post('/auth/logout', { refreshToken }),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        // best-effort : on purge quand meme localement
      }
    }
    Cookies.remove('accessToken');
    Cookies.remove('refreshToken');
    Cookies.remove('user');
    setUser(null);
    window.location.href = '/auth/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
