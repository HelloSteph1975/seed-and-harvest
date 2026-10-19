import { useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { toDisplay, toMetric, unitLabel } from '../../lib/units.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// An elevation in whole feet or meters, as typed and shown.
const shownElevation = (m, units) => (typeof m === 'number' ? String(Math.round(Number(toDisplay('length', m, units)))) : '');

// Type a town, press Look up, pick one result: `onPick` gets the place's location and climate
// estimate to fill into the form. The estimate says which elevation it was worked out for; land
// higher or lower than the town can be looked up again with its own elevation. Nothing is saved here. One request at a time: while one runs,
// Look up and Enter wait, and a reply from a request that was replaced is ignored.
export function ClimateLookup({ onPick, disabled }) {
  const { t } = useT();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const id = useId();
  const elevationId = useId();
  const [picked, setPicked] = useState(null);
  const [elevation, setElevation] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState({ busy: false, results: null, error: null });
  const latest = useRef(0);

  const run = async (request, onReply) => {
    const mine = ++latest.current;
    setState({ busy: true, results: null, error: null });
    try {
      const reply = await request();
      if (mine === latest.current) onReply(reply);
    } catch (err) {
      if (mine === latest.current) setState({ busy: false, results: null, error: errorText(err, t) });
    }
  };
  const search = () => {
    if (!q.trim() || state.busy) return;
    run(() => api.get(`/api/climate/search?q=${encodeURIComponent(q.trim())}`), results => setState({ busy: false, results, error: null }));
  };
  const pick = (r, elevationM) => {
    if (state.busy) return;
    const extra = typeof elevationM === 'number' ? `&elevation_m=${elevationM}` : '';
    run(() => api.get(`/api/climate/estimate?latitude=${r.latitude}&longitude=${r.longitude}${extra}`), est => {
      onPick({ ...est, location: r.label, latitude: r.latitude, longitude: r.longitude, time_zone: r.time_zone });
      setPicked({ result: r, used: est.elevation_m ?? null });
      setElevation(shownElevation(est.elevation_m, units));
      setState({ busy: false, results: null, error: null });
    });
  };
  let typedM = null;
  try { typedM = toMetric('length', elevation, units); } catch { typedM = null; }
  const again = () => { if (typedM !== null) pick(picked.result, Math.round(typedM * 10) / 10); };

  return (
    <fieldset className="field field-group climate-lookup">
      <legend>{t('places.lookup.title')}</legend>
      <p className="field-hint">{t('places.lookup.hint')}</p>
      <div className="lookup-row">
        <label htmlFor={id} className="visually-hidden">{t('places.lookup.town')}</label>
        <input id={id} className="input" value={q} onChange={e => setQ(e.target.value)} disabled={disabled}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} placeholder={t('places.lookup.placeholder')} />
        <Button variant="ghost" icon={Search} onClick={search} disabled={disabled || state.busy || !q.trim()}>{t('places.lookup.go')}</Button>
      </div>
      {picked && !state.results && typeof picked.used === 'number' && (
        <div className="lookup-elevation">
          <p className="field-hint">{t('places.lookup.elevationUsed', { n: shownElevation(picked.used, units), unit: unitLabel('length', units) })}</p>
          <div className="lookup-row">
            <label htmlFor={elevationId}>{t('places.lookup.elevation', { unit: unitLabel('length', units) })}</label>
            <input id={elevationId} className="input" inputMode="decimal" value={elevation} onChange={e => setElevation(e.target.value)} disabled={disabled} maxLength={6}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); again(); } }} />
            <Button variant="ghost" onClick={again} disabled={disabled || state.busy || typedM === null}>{t('places.lookup.again')}</Button>
          </div>
        </div>
      )}
      {state.busy && <p role="status" className="muted">{t('places.lookup.working')}</p>}
      {state.error && <p role="alert" className="form-error">{state.error}</p>}
      {state.results?.length === 0 && <p role="status">{t('places.lookup.none')}</p>}
      {state.results?.length > 0 && (
        <div className="lookup-results">
          <p className="field-hint">{t('places.lookup.pick')}</p>
          <ul className="list">
            {state.results.map(r => (
              <li key={`${r.latitude},${r.longitude}`}><Button variant="ghost" onClick={() => pick(r)}>{r.label}</Button></li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
