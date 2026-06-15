'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  logout: () => void;
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  newsletter: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = Cookies.get('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        Cookies.remove('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    Cookies.set('accessToken', data.accessToken, { expires: 1 });
    Cookies.set('refreshToken', data.refreshToken, { expires: 30 });
    try {
      const { data: profile } = await api.get('/auth/me');
      const fullUser = {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        plan: profile.plan,
        eventCredits: profile.eventCredits ?? 0,
        emailVerified: !!profile.emailVerified,
      };
      Cookies.set('user', JSON.stringify(fullUser), { expires: 30 });
      setUser(fullUser);
    } catch {
      Cookies.set('user', JSON.stringify(data.user), { expires: 30 });
      setUser(data.user);
    }
  };

  const register = async (registerData: RegisterData) => {
    const { data } = await api.post('/auth/register', registerData);
    const newUser = { ...data.user, emailVerified: false };
    Cookies.set('accessToken', data.accessToken, { expires: 1 });
    Cookies.set('refreshToken', data.refreshToken, { expires: 30 });
    Cookies.set('user', JSON.stringify(newUser), { expires: 30 });
    setUser(newUser);
  };

  const refreshUser = async () => {
    try {
      const { data: profile } = await api.get('/auth/me');
      const updatedUser = {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        plan: profile.plan,
        eventCredits: profile.eventCredits ?? 0,
        emailVerified: !!profile.emailVerified,
      };
      Cookies.set('user', JSON.stringify(updatedUser), { expires: 30 });
      setUser(updatedUser);
    } catch {
      // ignore
    }
  };

  const logout = () => {
    const refreshToken = Cookies.get('refreshToken');
    if (refreshToken) {
      api.post('/auth/logout', { refreshToken }).catch(() => {});
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
