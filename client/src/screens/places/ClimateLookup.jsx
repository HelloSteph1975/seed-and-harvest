import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// Type a town, press Look up, pick one result: `onPick` gets the place's location and climate
// estimate to fill into the form. Nothing is saved here.
export function ClimateLookup({ onPick, disabled }) {
  const { t } = useT();
  const id = useId();
  const [q, setQ] = useState('');
  const [state, setState] = useState({ busy: false, results: null, error: null });

  const search = async () => {
    if (!q.trim()) return;
    setState({ busy: true, results: null, error: null });
    try {
      setState({ busy: false, results: await api.get(`/api/climate/search?q=${encodeURIComponent(q.trim())}`), error: null });
    } catch (err) {
      setState({ busy: false, results: null, error: errorText(err, t) });
    }
  };
  const pick = async r => {
    setState({ busy: true, results: null, error: null });
    try {
      const est = await api.get(`/api/climate/estimate?latitude=${r.latitude}&longitude=${r.longitude}`);
      onPick({ ...est, location: r.label, latitude: r.latitude, longitude: r.longitude, time_zone: r.time_zone });
      setState({ busy: false, results: null, error: null });
    } catch (err) {
      setState({ busy: false, results: null, error: errorText(err, t) });
    }
  };

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
