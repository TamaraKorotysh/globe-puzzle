import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import Globe from './Globe';
import CountryCard from './CountryCard';
import { buildWorld, type WorldGeometry } from './geo/buildCountries';
import { lonLatToXYZ } from './geo/sphere';
import { STYLES, styleFromUrl } from './globeStyles';
import { loadFacts } from './data';
import { useI18n, type Lang } from './i18n';
import { isMuted, setMuted, sfx } from './puzzle/sounds';

const Puzzle = lazy(() => import('./puzzle/Puzzle'));

interface PuzzleState { round: number; total: number; remaining: Set<string>; hints: number; hintSignal: number }

const HINTS_PER_BLOCK = 3;

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [style] = useState(styleFromUrl);
  const compare = new URLSearchParams(location.search).has('compare');
  useEffect(() => { document.body.classList.toggle('look-antique', !!style.antique); }, [style]);
  const [fc, setFc] = useState<FeatureCollection | null>(null);
  const [world, setWorld] = useState<WorldGeometry | null>(null);
  const [error, setError] = useState(false);
  // Deep link: #FRA or #D-CRIMEA opens that card.
  const [selected, setSelected] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null);

  useEffect(() => {
    const hash = selected ? `#${selected}` : '';
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
  }, [selected]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/borders.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: FeatureCollection) => { setFc(data); setWorld(buildWorld(data, style.height)); })
      .catch(() => setError(true));
    loadFacts(); // warm up in the background
  }, []);

  const close = useCallback(() => setSelected(null), []);

  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [muted, setMutedState] = useState(isMuted);
  const scatter = () => {
    setSelected(null);
    setPuzzle((p) => ({ round: (p?.round ?? 0) + 1, total: 0, remaining: new Set(), hints: HINTS_PER_BLOCK, hintSignal: 0 }));
  };
  const onInit = useCallback((ids: string[]) => setPuzzle((p) => p && { ...p, total: ids.length, remaining: new Set(ids) }), []);
  const onPlaced = useCallback((id: string) => setPuzzle((p) => {
    if (!p) return p;
    const remaining = new Set(p.remaining);
    remaining.delete(id);
    if (!remaining.size) window.setTimeout(() => sfx.win(), 250);
    return { ...p, remaining };
  }), []);
  const done = puzzle && puzzle.total > 0 && puzzle.remaining.size === 0;
  const useHint = () => setPuzzle((p) => (p && p.hints > 0 ? { ...p, hints: p.hints - 1, hintSignal: p.hintSignal + 1 } : p));

  if (compare && fc) return <Compare fc={fc} lang={lang} />;

  return (
    <div className="app">
      {world ? (
        <Globe world={world} style={style} lang={lang} selected={selected} onSelect={setSelected}
          locked={!!puzzle && !done} hiddenIds={puzzle?.remaining}>
          {puzzle && !done && (
            <Suspense fallback={null}>
              <Puzzle key={puzzle.round} world={world} style={style} onInit={onInit} onPlaced={onPlaced}
                lang={lang} hint={puzzle.hintSignal} onInfo={setSelected} />
            </Suspense>
          )}
        </Globe>
      ) : (
        <div className="center muted">{error ? t('loadError') : t('loading')}</div>
      )}

      <header className="topbar">
        <h1>{t('title')}</h1>
        <div className="lang" role="group" aria-label="Language">
          {(['ru', 'en'] as Lang[]).map((l) => (
            <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)} aria-pressed={l === lang}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {world && (
        <div className="hud">
          {puzzle && puzzle.total > 0 && (
            <div className={`counter${done ? ' done' : ''}`}>
              {done ? t('puzzleDone') : `${t('placed')} ${puzzle.total - puzzle.remaining.size} / ${puzzle.total}`}
              {!done && <div className="bar"><i style={{ width: `${(100 * (puzzle.total - puzzle.remaining.size)) / puzzle.total}%` }} /></div>}
            </div>
          )}
          <div className="hud-buttons">
            <button className="primary" onClick={scatter}>{puzzle ? t('again') : t('scatter')}</button>
            {puzzle && !done && (
              <button onClick={useHint} disabled={puzzle.hints === 0} title={t('hintTitle')}>
                💡 {t('hintBtn')} {puzzle.hints}
              </button>
            )}
            {puzzle && <button onClick={() => setPuzzle(null)}>{t('exit')}</button>}
            <button
              className="icon"
              aria-label={muted ? t('soundOn') : t('soundOff')}
              title={muted ? t('soundOn') : t('soundOff')}
              onClick={() => { setMuted(!muted); setMutedState(!muted); }}
            >{muted ? '🔇' : '🔊'}</button>
          </div>
        </div>
      )}

      {!selected && <p className={`hint${puzzle ? ' hint-puzzle' : ''}`}>{puzzle ? (done ? '' : t('puzzleHint')) : t('hint')}</p>}
      {selected && <CountryCard id={selected} onClose={close} />}
    </div>
  );
}

/** ?compare — the same view of Europe in every style, side by side (for picking a look). */
function Compare({ fc, lang }: { fc: FeatureCollection; lang: Lang }) {
  const cam = lonLatToXYZ(14, 47, 2.05);
  return (
    <div className="compare">
      {Object.values(STYLES).map((s) => (
        <div key={s.id} className="compare-cell">
          <Globe world={buildWorld(fc, s.height)} style={s} lang={lang} selected={null} onSelect={() => {}} cameraPos={cam} still />
          <div className="compare-name">{s.name[lang]}</div>
        </div>
      ))}
    </div>
  );
}
