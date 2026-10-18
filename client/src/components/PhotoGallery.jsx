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
  // Photos whose caption hit a conflict, with the text that was sent. Until Keep mine or Use theirs
  // is chosen (or the caption is typed in again), leaving the field doesn't save it.
  const [conflicts, setConflicts] = useState({});
  const settle = id => setConflicts(c => { const { [id]: gone, ...rest } = c; return rest; });
  const fail = err => toast.show({ message: errorText(err, t), duration: 6000 });

  const latestDraft = useRef(drafts);
  latestDraft.current = drafts;
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
            // Keeping mine is a choice, not a side effect of leaving the field. A draft that is still
            // what was sent goes, showing the other window's text; one typed since then stays on screen.
            const sent = body.caption;
            let newer;
            setDrafts(d => {
              newer = d[p.id] !== undefined && d[p.id] !== sent ? d[p.id] : undefined;
              if (newer !== undefined) return d;
              const { [p.id]: gone, ...rest } = d;
              return rest;
            });
            setConflicts(c => ({ ...c, [p.id]: sent }));
            toast.show({ message: t('photos.conflict'), duration: 8000 });
          } else fail(err);
        } else fail(err);
      }
      await list.reload();
    };
    queues.current[p.id] = (queues.current[p.id] ?? Promise.resolve()).then(run);
    return queues.current[p.id];
  };
  const saveCaption = p => {
    if (conflicts[p.id] !== undefined) return;
    if (drafts[p.id] !== undefined && drafts[p.id] !== (p.caption ?? '')) save(p, { caption: drafts[p.id] });
  };
  const remove = async p => {
    try {
      await list.act(() => api.del(`/api/photos/${p.id}`));
      dropDraft(p.id);
      settle(p.id);
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
                  onChange={e => { const v = e.target.value; settle(p.id); setDrafts(d => ({ ...d, [p.id]: v })); }}
                  onBlur={() => saveCaption(p)} />
                {p.is_cover
                  ? <span className="tag">{t('photos.cover')}</span>
                  : <button type="button" className="icon-btn" aria-label={t('photos.makeCover')} onClick={() => save(p, { is_cover: true })}><Star size={16} /></button>}
                <button type="button" className="icon-btn" aria-label={t('photos.delete')} onClick={() => remove(p)}><Trash2 size={16} /></button>
              </figcaption>
              {conflicts[p.id] !== undefined && (
                <div role="group" aria-label={t('photos.conflictLabel', { n: i + 1 })} className="caption-conflict">
                  <span>{t('photos.conflictShort')}</span>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => { const text = latestDraft.current[p.id] ?? conflicts[p.id]; settle(p.id); save(p, { caption: text }); }}>{t('photos.keepMine')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { settle(p.id); dropDraft(p.id); }}>{t('photos.useTheirs')}</button>
                </div>
              )}
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
