import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { Button } from '../../components/Button.jsx';
import { Field, Select, DateInput } from '../../components/Field.jsx';
import { useResource } from '../../lib/useResource.js';
import { errorText } from '../../lib/errors.js';
import { byStatus } from '../../lib/places.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// Moves a container plant to another space, at this place or another one.
// `onMove(body)` saves through the page's planting resource, so a newer version reloads the page.
export function MoveDialog({ planting, today, onClose, onMove, onMoved }) {
  const { t } = useT();
  const places = useResource('/api/places');
  const [placeId, setPlaceId] = useState(String(planting.space.place_id));
  const [spaceId, setSpaceId] = useState('');
  const [movedOn, setMovedOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const spaces = useResource(`/api/spaces?place_id=${placeId}`);
  const choices = (spaces.data ?? []).filter(s => s.id !== planting.space_id);
  // Keep the space one of the chosen place's, the current one left out.
  useEffect(() => {
    if (spaces.data && !choices.some(s => String(s.id) === spaceId)) setSpaceId(choices[0] ? String(choices[0].id) : '');
  }, [spaces.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async e => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const out = await onMove({ space_id: Number(spaceId), moved_on: movedOn });
      onMoved(out);
    } catch (err) {
      setError(errorText(err, t));
      setSaving(false);
    }
  };
  const ready = choices.some(s => String(s.id) === spaceId) && /^\d{4}-\d{2}-\d{2}$/.test(movedOn);
  return (
    <Dialog open onClose={onClose} title={t('plantings.moveTitle')}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="move-form" disabled={saving || !ready}>{saving ? t('common.saving') : t('plantings.move')}</Button>
      </>}>
      <form id="move-form" onSubmit={move}>
        <p className="muted">{t('plantings.moveIntro')}</p>
        <Field label={t('spaces.place')}>
          <Select value={placeId} onChange={e => { setPlaceId(e.target.value); setSpaceId(''); }}
            options={(places.data ? byStatus(places.data) : []).map(p => ({ value: String(p.id), label: p.name }))} />
        </Field>
        <Field label={t('plantings.space')} hint={spaces.data && choices.length === 0 ? t('plantings.noSpaces') : undefined}>
          <Select value={spaceId} onChange={e => setSpaceId(e.target.value)} options={choices.map(s => ({ value: String(s.id), label: s.name }))} />
        </Field>
        <Field label={t('plantings.movedOn')}><DateInput value={movedOn} onChange={e => setMovedOn(e.target.value)} /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
