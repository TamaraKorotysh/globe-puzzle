import { useEffect, useState } from 'react';
import { countries, disputed, isDisputedZone, loadFacts, type Facts } from './data';
import { useI18n } from './i18n';

export default function CountryCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { lang, t } = useI18n();
  const [facts, setFacts] = useState<Facts | null>(null);
  const c = countries[id];

  useEffect(() => {
    let alive = true;
    loadFacts().then((f) => alive && setFacts(f)).catch(() => alive && setFacts({}));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const note = disputed[id];
  const zone = isDisputedZone(id);
  if (!c && !(zone && note)) return null;
  const list = facts?.[id]?.[lang];
  const title = c ? c.name[lang] : note.name?.[lang] ?? id;

  const noteBlock = note && (
    <div className="card-note">
      <p>{note.claimants[lang]}</p>
      <p>{note.control[lang]}</p>
    </div>
  );

  if (zone) {
    return (
      <aside className="card" role="dialog" aria-label={title}>
        <button className="card-close" onClick={onClose} aria-label={t('close')}>×</button>
        <header className="card-head">
          <span className="card-flag card-flag-hatch" aria-hidden="true" />
          <div>
            <h2>{title}</h2>
            <p className="card-sub">{t('disputedZone')}</p>
          </div>
        </header>
        {noteBlock}
      </aside>
    );
  }

  return (
    <aside className="card" role="dialog" aria-label={title}>
      <button className="card-close" onClick={onClose} aria-label={t('close')}>×</button>
      <header className="card-head">
        {c.flag ? (
          <span className={`fi fi-${c.flag} card-flag`} aria-hidden="true" />
        ) : (
          <span className="card-flag card-flag-empty" aria-hidden="true">🏳️</span>
        )}
        <div>
          <h2>{title}</h2>
          {note && <p className="card-sub">{t('limitedRecognition')}</p>}
        </div>
      </header>
      {noteBlock}
      <p className="card-capital">
        <span className="label">{t('capital')}:</span>{' '}
        {c.capital ? c.capital[lang] : <em>{t('noCapital')}</em>}
      </p>
      <h3>{t('facts')}</h3>
      {!facts ? (
        <p className="muted">{t('loadingFacts')}</p>
      ) : list?.length ? (
        <ul className="facts">
          {list.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      ) : (
        <p className="muted">{t('noFacts')}</p>
      )}
    </aside>
  );
}
