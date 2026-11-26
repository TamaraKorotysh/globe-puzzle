import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import ru from './ru.json';
import en from './en.json';

export type Lang = 'ru' | 'en';
type Dict = typeof en;

const dicts: Record<Lang, Dict> = { ru, en };
const STORAGE_KEY = 'globe-lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  const nav = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : 'en';
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof Dict) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key) => dicts[lang][key] ?? String(key) }),
    [lang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
