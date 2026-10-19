import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { PhotoGallery } from '../../components/PhotoGallery.jsx';
import { useConfirm } from '../../components/ConfirmProvider.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { starterText } from '../../lib/starter.js';
import { byStatus } from '../../lib/places.js';
import { toDisplay, unitLabel } from '../../lib/units.js';
import { plantingWindows, zoneFit } from '../../lib/windows.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { yearsText } from '../../lib/tasks.js';
import { VarietyDialog } from './VarietyDialog.jsx';
import { PlantingsOf } from '../plantings/PlantingsOf.jsx';

const FRUIT_KINDS = ['fruit_tree', 'shrub', 'vine'];

export const STAGE_ORDER = ['start_indoors', 'sow_outdoors', 'transplant', 'container', 'greenhouse', 'care', 'harvest', 'preserve', 'microgreens', 'general'];

export function PlantPageRoute() {
  const { id } = useParams();
  return <PlantPage key={id} id={id} />;
}

function PlantPage({ id }) {
  const { t, tc } = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const plant = useResource(`/api/plants/${id}`);
  const all = useResource('/api/plants');
  const [variety, setVariety] = useState(null);
  const p = plant.data;
  const text = (field, value) => starterText(tc, p, field, value);

  const remove = async () => {
    const n = p.guides.length + p.varieties.length;
    const body = [n > 0 && t('plants.deleteWith', { n }), t('plants.deleteBody')].filter(Boolean).join(' ');
    if (!await confirm({ title: t('plants.deleteTitle', { name: text('name', p.name) }), body, confirmLabel: t('common.delete'), danger: true })) return;
    try { await api.del(`/api/plants/${p.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); plant.reload(); return; }
    navigate('/library');
    toast.show({ message: t('plants.deleted', { name: text('name', p.name) }), duration: 8000,
      action: { label: t('common.undo'), onClick: async () => {
        try { await api.post(`/api/plants/${p.id}/restore`); navigate(`/library/plants/${p.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); }
      } } });
  };
  const removeVariety = async v => {
    try { await plant.act(() => api.del(`/api/varieties/${v.id}`)); toast.show({ message: t('varieties.deleted', { name: v.name }) }); }
    catch (err) { toast.show({ message: errorText(err, t) }); }
  };

  const byKey = new Map((all.data ?? []).filter(x => x.starter_key).map(x => [x.starter_key, x]));
  const plantLink = key => {
    const other = byKey.get(key);
    if (other) return <Link key={key} to={`/library/plants/${other.id}`}>{starterText(tc, other, 'name', other.name)}</Link>;
    return key.startsWith('plant.') ? null : <span key={key}>{key}</span>;
  };
  const joinNodes = nodes => nodes.filter(Boolean).flatMap((n, i) => (i ? [', ', n] : [n]));

  return (
    <article className="entry plant">
      <LoadState loading={plant.loading && !p} error={plant.error} keepChildren={Boolean(p)} onRetry={plant.reload}>
        {p && (
          <>
            <PageHeader title={text('name', p.name)}>
              <Button as={Link} variant="ghost" icon={Pencil} to={`/library/plants/${p.id}/edit`}>{t('common.edit')}</Button>
              <Button variant="ghost" icon={Trash2} onClick={remove}>{t('common.delete')}</Button>
            </PageHeader>
            <p className="entry-meta">
              <span>{t(`plants.kind.${p.kind}`)}</span>
              {p.latin_name && <em>{p.latin_name}</em>}
              {p.is_starter ? <span className="tag">{t('common.starter')}</span> : null}
            </p>
            {p.summary && <p className="lead">{text('summary', p.summary)}</p>}
            <WhenToPlant plant={p} />
            <Facts plant={p} text={text} />
            {(p.companions.length > 0 || p.avoid.length > 0) && (
              <dl className="entry-facts">
                {p.companions.length > 0 && <><dt>{t('plants.companions')}</dt><dd>{joinNodes(p.companions.map(plantLink))}</dd></>}
                {p.avoid.length > 0 && <><dt>{t('plants.avoid')}</dt><dd>{joinNodes(p.avoid.map(plantLink))}</dd></>}
              </dl>
            )}
            {p.problems && <section><h2>{t('plants.problems')}</h2>{text('problems', p.problems).split(/\n\s*\n/).map((x, i) => <p key={i}>{x}</p>)}</section>}
            {p.greenhouse_notes && <section><h2>{t('plants.greenhouseNotes')}</h2><p>{text('greenhouse_notes', p.greenhouse_notes)}</p></section>}
            {p.notes && <section><h2>{t('plants.notes')}</h2>{text('notes', p.notes).split(/\n\s*\n/).map((x, i) => <p key={i}>{x}</p>)}</section>}
            <section aria-labelledby="plant-guides">
              <h2 id="plant-guides">{t('plants.guides')}</h2>
              {p.guides.length === 0 && <p className="muted">{t('plants.noGuides')}</p>}
              <ul className="list">
                {[...p.guides].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)).map(g => (
                  <li key={g.id}><Link to={`/library/guides/${g.id}`}>{starterText(tc, g, 'title', g.title)}</Link></li>
                ))}
              </ul>
              <p><Link to={`/library/guides/new?plant=${p.id}`}>{t('guides.addForPlant')}</Link></p>
            </section>
            <PlantingsOf url={`/api/plantings?plant_id=${p.id}`} title={t('plantings.forPlant')} empty={t('plantings.noneForPlant')}
              addTo={`/plantings/new?plant=${p.id}`} addLabel={t('plantings.add')} />
            <section aria-labelledby="plant-varieties">
              <h2 id="plant-varieties">{t('varieties.title')}</h2>
              {p.varieties.length === 0 && <p className="muted">{t('varieties.none')}</p>}
              <ul className="list">
                {p.varieties.map(v => (
                  <li key={v.id}>
                    <span className="grow"><strong>{v.name}</strong>{v.days ? <> <span className="muted">{t('varieties.days', { n: v.days })}</span></> : null}
                      {v.notes && <><br /><span className="muted">{v.notes}</span></>}</span>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('varieties.edit', { name: v.name })} onClick={() => setVariety(v)} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('varieties.delete', { name: v.name })} onClick={() => removeVariety(v)} />
                  </li>
                ))}
              </ul>
              <Button variant="ghost" icon={Plus} onClick={() => setVariety({})}>{t('varieties.add')}</Button>
            </section>
            <PhotoGallery ownerType="plant" ownerId={p.id} />
            {variety && <VarietyDialog plantId={p.id} record={variety.id ? variety : null}
              onClose={() => setVariety(null)} onSaved={() => { setVariety(null); plant.reload(); }} />}
          </>
        )}
      </LoadState>
      <p><Link to="/library">{t('library.back')}</Link></p>
    </article>
  );
}

function WhenToPlant({ plant }) {
  const { t, language } = useT();
  const { settings } = useSettings();
  const places = useResource('/api/places');
  const [placeId, setPlaceId] = useState(null);
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(x => x.id === placeId) ?? list.find(x => x.status === 'current') ?? list[0] ?? null;
  const today = useToday(place?.time_zone || settings?.time_zone);
  const { windows, needs } = plantingWindows(plant, place, today);
  const year = today.slice(0, 4);
  const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(language, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const range = w => t('plants.range', { from: day(w.from), to: day(w.to) }) + (w.to.slice(0, 4) !== year ? `, ${w.to.slice(0, 4)}` : '');
  const fit = zoneFit(plant, place);
  // Fruit trees, shrubs and vines are bought as plants and planted, not moved out from a seed tray.
  const label = kind => (kind === 'transplant' && FRUIT_KINDS.includes(plant.kind) ? 'frost_free' : kind);
  if (plant.kind === 'microgreen') {
    return (
      <section className="card when" aria-labelledby="when-title">
        <h2 id="when-title">{t('plants.when')}</h2>
        <p>{plant.days_min != null && plant.days_max != null
          ? t('plants.microgreenWhen', { from: plant.days_min, to: plant.days_max }) : t('plants.microgreenAnyTime')}</p>
      </section>
    );
  }
  return (
    <section className="card when" aria-labelledby="when-title">
      <h2 id="when-title">{place ? t('plants.whenAt', { place: place.name }) : t('plants.when')}</h2>
      {places.data && list.length === 0 && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
      {list.length > 1 && (
        <label className="inline-field">{t('spaces.place')}{' '}
          <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => setPlaceId(Number(e.target.value))}
            options={list.map(x => ({ value: String(x.id), label: x.name }))} />
        </label>
      )}
      {windows.length > 0 && (
        <dl className="entry-facts">
          {windows.map((w, i) => (
            <div key={`${w.kind}-${i}`} className="fact-row"><dt>{t(`plants.window.${label(w.kind)}`)}</dt><dd>{range(w)}</dd></div>
          ))}
        </dl>
      )}
      {place && windows.length === 0 && needs.length === 0 && <p className="muted">{t('plants.noWindows')}</p>}
      {needs.filter(n => n !== 'place').map(n => (
        <p key={n} className="note">{t(`plants.need.${n === 'last_frost' && windows.length === 0 ? 'last_frost_only' : n}`)} <Link to={`/places/${place.id}/edit`}>{t('plants.editPlace')}</Link></p>
      ))}
      {fit === 'too_cold' && <p className="note">{t('plants.tooCold', { place: place.name })}</p>}
      {fit === 'too_warm' && <p className="note">{t('plants.tooWarm', { place: place.name })}</p>}
    </section>
  );
}

function Facts({ plant: p, text }) {
  const { t } = useT();
  const others = new Map((useResource('/api/animals').data ?? []).map(x => [x.id, x.name]));
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const num = (kind, v) => `${toDisplay(kind, v, units)} ${unitLabel(kind, units)}`;
  const range = (lo, hi, key) => (lo != null && hi != null ? t(key, { from: lo, to: hi }) : null);
  const rows = [
    p.sun && [t('spaces.sun'), t(`spaces.sun.${p.sun}`)],
    p.water && [t('plants.water'), t(`plants.water.${p.water}`)],
    // Trees and vines are spaced meters apart: show feet or meters, not a pile of inches.
    p.spacing_cm != null && [t('plants.spacing'), p.spacing_cm >= 100 ? num('length', p.spacing_cm / 100) : num('spacing', p.spacing_cm)],
    p.container_liters != null && [t('plants.potSize'), num('volume', p.container_liters)],
    range(p.days_min, p.days_max, 'plants.daysRange') && [t('plants.daysToHarvest'), range(p.days_min, p.days_max, 'plants.daysRange')],
    p.years_min != null && p.years_max != null && [t('plants.yearsToFruit'), yearsText(t, p.years_min, p.years_max)],
    p.zone_min != null && p.zone_max != null && [t('plants.zones'), t('plants.zoneRange', { from: p.zone_min, to: p.zone_max })],
    p.yield_kg != null && [t('plants.yield'), t(`plants.yieldPer.${p.yield_per ?? 'plant'}`, { amount: num('weight', p.yield_kg) })],
    ...p.preserves.map((pr, i) => [text(`preserve.${i + 1}`, pr.form), t('plants.preserveNeeds', { amount: num('weight', pr.raw_kg) })]),
    p.kind === 'microgreen' && p.soak_hours != null && [t('plants.soak'), t('plants.hours', { n: p.soak_hours })],
    p.kind === 'microgreen' && p.seed_g_per_tray != null && [t('plants.seedPerTray'), num('seed', p.seed_g_per_tray)],
    p.kind === 'microgreen' && p.safety_goats && [t('plants.goats'), t(`plants.safety.${p.safety_goats}`)],
    p.kind === 'microgreen' && p.safety_chickens && [t('plants.chickens'), t(`plants.safety.${p.safety_chickens}`)],
    ...(p.kind === 'microgreen' ? (p.animal_safety ?? []).map(x => others.get(x.animal_id) && [t('plants.forAnimal', { animal: others.get(x.animal_id) }), t(`plants.safety.${x.safety}`)]) : []),
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="facts-title">
      <h2 id="facts-title">{t('plants.facts')}</h2>
      <dl className="entry-facts">{rows.map(([k, v], i) => <div key={i} className="fact-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {p.is_starter ? <p className="muted small">{t('plants.ruleOfThumb')}</p> : null}
    </section>
  );
}
