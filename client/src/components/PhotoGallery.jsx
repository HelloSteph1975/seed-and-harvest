import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Star } from 'lucide-react';
import { api } from '../lib/api.js';
import { errorText } from '../lib/errors.js';
import { resizeImage } from '../lib/image.js';
import { useResource } from '../lib/useResource.js';
import { useLeaveGuard } from '../lib/useLeaveGuard.js';
import { LoadState } from './LoadState.jsx';
import { useToast } from './ToastProvider.jsx';
import { useT } from '../i18n/I18nProvider.jsx';

async function uploadPhoto(ownerType, ownerId, file) {
  // Big phone photos are shrunk first; if the browser can't, the original goes up as it is.
  let blob = file;
  try { blob = await resizeImage(file); } catch { /* keep the original */ }
  const fd = new FormData();
  fd.append('owner_type', ownerType);
  fd.append('owner_id', String(ownerId));
  fd.append('file', blob, blob === file ? file.name : 'photo.jpg');
  return api.upload('/api/photos', fd);
}

// Photos for one record: add (drop or choose), caption, pick the cover, delete (to the Trash).
// Caption drafts are kept here until saved, so leaving with one unsaved asks first. Saves for a
// photo run one at a time, each with the version the last one returned.
export function PhotoGallery({ ownerType, ownerId }) {
  const { t } = useT();
  const toast = useToast();
  const list = useResource(`/api/photos?owner_type=${ownerType}&owner_id=${ownerId}`);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [drafts, setDrafts] = useState({});
  const versions = useRef({});
  const queues = useRef({});
  const fail = err => toast.show({ message: errorText(err, t), duration: 6000 });

  const photos = list.data ?? [];
  for (const p of photos) versions.current[p.id] = Math.max(versions.current[p.id] ?? 0, p.version);
  const captionOf = p => drafts[p.id] ?? p.caption ?? '';
  const dirty = photos.some(p => drafts[p.id] !== undefined && drafts[p.id] !== (p.caption ?? ''));
  useLeaveGuard(dirty);
  const dropDraft = (id, text) => setDrafts(d => {
    if (text !== undefined && d[id] !== text) return d;
    const { [id]: gone, ...rest } = d;
    return rest;
  });

  async function add(files) {
    const images = files.filter(f => f.type.startsWith('image/'));
    setBusy(true);
    try { for (const f of images) await uploadPhoto(ownerType, ownerId, f); } catch (err) { fail(err); }
    finally { setBusy(false); list.reload(); }
    if (images.length < files.length) toast.show({ message: t('photos.skipped', { n: files.length - images.length }), duration: 6000 });
  }

  const save = (p, body) => {
    const run = async () => {
      try {
        const out = await api.patch(`/api/photos/${p.id}`, { ...body, version: versions.current[p.id] });
        versions.current[p.id] = out.version;
        if (body.caption !== undefined) dropDraft(p.id, body.caption);
      } catch (err) {
        if (err.status === 409 && err.current) {
          versions.current[p.id] = err.current.version;
          if (body.caption !== undefined) {
            // Show what the other window saved; keeping mine is a choice, not a side effect of leaving the field.
            const mine = body.caption;
            dropDraft(p.id);
            toast.show({ message: t('photos.conflict'), action: { label: t('photos.keepMine'), onClick: () => save(p, { caption: mine }) }, duration: 10000 });
          } else fail(err);
        } else fail(err);
      }
      await list.reload();
    };
    queues.current[p.id] = (queues.current[p.id] ?? Promise.resolve()).then(run);
    return queues.current[p.id];
  };
  const saveCaption = p => { if (drafts[p.id] !== undefined && drafts[p.id] !== (p.caption ?? '')) save(p, { caption: drafts[p.id] }); };
  const remove = async p => {
    try {
      await list.act(() => api.del(`/api/photos/${p.id}`));
      dropDraft(p.id);
      toast.show({ message: t('photos.deleted'), action: { label: t('common.undo'), onClick: () => list.act(() => api.post(`/api/photos/${p.id}/restore`)).catch(fail) }, duration: 8000 });
    } catch (err) { fail(err); }
  };

  return (
    <section className="photos">
      <h2>{t('photos.title')}</h2>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        <div className="gallery">
          {photos.map((p, i) => (
            <figure key={p.id} className="gallery-item">
              <img src={`/photos/${p.filename}`} alt={p.caption || t('photos.alt', { n: i + 1 })} loading="lazy" />
              <figcaption>
                <input className="input caption-input" value={captionOf(p)} placeholder={t('photos.captionPlaceholder')}
                  aria-label={t('photos.caption', { n: i + 1 })} maxLength={300}
                  onChange={e => { const v = e.target.value; setDrafts(d => ({ ...d, [p.id]: v })); }}
                  onBlur={() => saveCaption(p)} />
                {p.is_cover
                  ? <span className="tag">{t('photos.cover')}</span>
                  : <button type="button" className="icon-btn" aria-label={t('photos.makeCover')} onClick={() => save(p, { is_cover: true })}><Star size={16} /></button>}
                <button type="button" className="icon-btn" aria-label={t('photos.delete')} onClick={() => remove(p)}><Trash2 size={16} /></button>
              </figcaption>
            </figure>
          ))}
          <label className={`gallery-drop${over ? ' is-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
            <ImagePlus size={28} aria-hidden="true" />
            <span>{busy ? t('photos.adding') : t('photos.drop')}</span>
            <input type="file" accept="image/*" multiple className="visually-hidden"
              onChange={e => { const files = [...e.target.files]; e.target.value = ''; add(files); }} />
          </label>
        </div>
      </LoadState>
    </section>
  );
}
