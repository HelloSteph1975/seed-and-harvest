import { useState } from 'react';
import { ImagePlus, Trash2, Star } from 'lucide-react';
import { api } from '../lib/api.js';
import { errorText } from '../lib/errors.js';
import { resizeImage } from '../lib/image.js';
import { useResource } from '../lib/useResource.js';
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
export function PhotoGallery({ ownerType, ownerId }) {
  const { t } = useT();
  const toast = useToast();
  const list = useResource(`/api/photos?owner_type=${ownerType}&owner_id=${ownerId}`);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fail = err => toast.show({ message: errorText(err, t), duration: 6000 });

  async function add(files) {
    const images = files.filter(f => f.type.startsWith('image/'));
    setBusy(true);
    try { for (const f of images) await uploadPhoto(ownerType, ownerId, f); } catch (err) { fail(err); }
    finally { setBusy(false); list.reload(); }
    if (images.length < files.length) toast.show({ message: t('photos.skipped', { n: files.length - images.length }), duration: 6000 });
  }
  const patch = async (p, body) => {
    try { await list.act(() => api.patch(`/api/photos/${p.id}`, { ...body, version: p.version })); } catch (err) { fail(err); list.reload(); }
  };
  const remove = async p => {
    try {
      await list.act(() => api.del(`/api/photos/${p.id}`));
      toast.show({ message: t('photos.deleted'), action: { label: t('common.undo'), onClick: () => list.act(() => api.post(`/api/photos/${p.id}/restore`)).catch(fail) }, duration: 8000 });
    } catch (err) { fail(err); }
  };

  return (
    <section className="photos">
      <h2>{t('photos.title')}</h2>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        <div className="gallery">
          {list.data?.map((p, i) => (
            <figure key={p.id} className="gallery-item">
              <img src={`/photos/${p.filename}`} alt={p.caption || t('photos.alt', { n: i + 1 })} loading="lazy" />
              <figcaption>
                <input className="input caption-input" defaultValue={p.caption ?? ''} placeholder={t('photos.captionPlaceholder')}
                  aria-label={t('photos.caption', { n: i + 1 })} maxLength={300}
                  onBlur={e => { if (e.target.value !== (p.caption ?? '')) patch(p, { caption: e.target.value }); }} />
                {p.is_cover
                  ? <span className="tag">{t('photos.cover')}</span>
                  : <button type="button" className="icon-btn" aria-label={t('photos.makeCover')} onClick={() => patch(p, { is_cover: true })}><Star size={16} /></button>}
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
