import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { starterText } from '../../lib/starter.js';
import { addDays, dayText } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { ForWhom } from '../microgreens/TrayPage.jsx';

// Today's microgreens: trays ready to cut and sowings due, each with its button, then the rest of the week.
export function TrayList({ place, today }) {
  const { t, tc, language } = useT();
  const toast = useToast();
  const due = useResource(`/api/trays/due?place_id=${place.id}&from=${today}&to=${addDays(today, 6)}`);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const ready = due.data?.ready ?? [];
  const sow = due.data?.sow ?? [];
  if (!ready.length && !sow.length) return null;
  const name = x => starterText(tc, x.plant, 'name', x.plant.name);
  const day = iso => dayText(iso, language, today);
  // One request at a time, so a double click can't sow two trays.
  const run = async fn => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await due.act(fn); } catch (err) { toast?.show({ message: errorText(err, t) }); due.reload(); } finally { inFlight.current = false; setBusy(false); }
  };
  const cut = x => run(() => api.patch(`/api/trays/${x.id}`, { version: x.version, status: 'harvested', harvested_on: today }));
  const sowNow = s => run(() => (s.planned
    ? api.patch(`/api/trays/${s.tray.id}`, { version: s.tray.version, status: 'growing', sown_on: today, harvest_on: addDays(today, s.tray.plant.days_min ?? 7) })
    : api.post(`/api/trays/${s.tray.id}/sow-again`, { sown_on: today })));
  const readyNow = ready.filter(x => x.harvest_on <= today);
  const sowNowList = sow.filter(s => s.on <= today);
  const later = [...ready.filter(x => x.harvest_on > today).map(x => ({ key: `c${x.id}`, on: x.harvest_on, text: t('trays.cutOn', { crop: name(x), day: day(x.harvest_on) }), x })),
    ...sow.filter(s => s.on > today).map(s => ({ key: `s${s.tray.id}`, on: s.on, text: t('trays.sowOn', { crop: name(s.tray), day: day(s.on) }), x: s.tray }))]
    .sort((a, b) => a.on.localeCompare(b.on));
  return (
    <section className="today-tasks" aria-labelledby="today-trays">
      <h2 id="today-trays">{t('nav.microgreens')}</h2>
      <ul className="list">
        {readyNow.map(x => (
          <li key={`r${x.id}`}>
            <span className="grow"><strong>{t('trays.ready')}</strong> · <Link to={`/microgreens/trays/${x.id}`}>{name(x)}</Link>
              <span className="muted"> · {x.space.name} · </span><ForWhom tray={x} /></span>
            <Button size="sm" disabled={busy} onClick={() => cut(x)}>{t('trays.harvestedToday')}</Button>
          </li>
        ))}
        {sowNowList.map(s => (
          <li key={`s${s.tray.id}`}>
            <span className="grow"><strong>{t('trays.sowNextTitle')}</strong> · <Link to={`/microgreens/trays/${s.tray.id}`}>{name(s.tray)}</Link>
              <span className="muted"> · {s.tray.space.name}</span>{s.on < today && <span className="muted"> · {t('trays.dueSince', { day: day(s.on) })}</span>}
              <span className="muted"> · </span><ForWhom tray={s.tray} /></span>
            <Button size="sm" disabled={busy} onClick={() => sowNow(s)}>{t('trays.sowNow')}</Button>
          </li>
        ))}
        {later.map(l => <li key={l.key} className="muted"><Link to={`/microgreens/trays/${l.x.id}`}>{l.text}</Link> · <ForWhom tray={l.x} /></li>)}
      </ul>
    </section>
  );
}
