'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('rp-theme') as Theme | null;
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('rp-theme', theme);
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // audit: MED-023 — toujours rendre {children}, y compris pendant le SSR / premier rendu client,
  // pour que le HTML initial contienne le contenu applicatif (SEO/perf, pas de page blanche).
  // audit: INFO-032 — l'anti-flash de theme est gere UNIQUEMENT par le script inline du <head>
  // (layout.tsx) ; on ne duplique plus de <script> ici.
  // `mounted` evite seulement un mismatch d'hydratation sur la valeur du contexte tant que le
  // theme persiste n'est pas relu cote client ; il ne conditionne plus le rendu des enfants.
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
