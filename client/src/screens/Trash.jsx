import { Button } from '../components/Button.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { LoadState } from '../components/LoadState.jsx';
import { useConfirm } from '../components/ConfirmProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { useResource } from '../lib/useResource.js';
import { api } from '../lib/api.js';
import { errorText } from '../lib/errors.js';
import { useT } from '../i18n/I18nProvider.jsx';

export function Trash() {
  const { t, tc, language } = useT();
  const title = item => {
    if (item.type === 'task') return item.title || t(`tasks.kind.${item.task_kind}`);
    if (item.type === 'log') return item.title || t(`log.kind.${item.log_kind}`);
    return tc(item.starter_key, item.type === 'guide' ? 'title' : 'name', item.title);
  };
  const confirm = useConfirm();
  const toast = useToast();
  const list = useResource('/api/trash');
  const fmt = iso => new Date(iso).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  const run = async (fn, message) => {
    try { await list.act(fn); if (message) toast.show({ message }); } catch (err) { toast.show({ message: errorText(err, t) }); }
  };

  const restore = item => run(() => api.post(`/api/trash/${item.type}/${item.id}/restore`), t('trash.restored', { title: title(item) }));
  const forever = async item => {
    const body = [item.extra > 0 && t('trash.deleteParentForever', { n: item.extra + item.earlier }), t('trash.deleteForeverBody')].filter(Boolean).join(' ');
    if (!await confirm({ title: t('trash.deleteForeverTitle', { title: title(item) }), body, confirmLabel: t('trash.deleteForever'), danger: true })) return;
    run(() => api.del(`/api/trash/${item.type}/${item.id}`));
  };
  const emptyAll = async () => {
    if (!await confirm({ title: t('trash.emptyAllTitle'), body: t('trash.emptyAllBody'), confirmLabel: t('trash.emptyAll'), danger: true })) return;
    run(() => api.post('/api/trash/empty'));
  };

  return (
    <>
      <PageHeader title={t('trash.title')}>
        {list.data?.length > 0 && <Button variant="danger" onClick={emptyAll}>{t('trash.emptyAll')}</Button>}
      </PageHeader>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        {list.data?.length === 0 && <p className="muted">{t('trash.empty')}</p>}
        <ul className="list">
          {list.data?.map(item => (
            <li key={`${item.type}-${item.id}`}>
              <span className="tag">{t(`trash.type.${item.type}`)}</span>
              <span className="grow"><strong>{title(item)}</strong> <span className="muted">{fmt(item.deleted_at)}</span>
                {item.extra > 0 && <> <span className="muted">{t('trash.withChildren', { n: item.extra })}</span></>}
                {item.earlier > 0 && <> <span className="muted">{t('trash.earlierChildren', { n: item.earlier })}</span></>}
                {item.parentInTrash && <> <span className="muted">{t('trash.parentInTrash')}</span></>}</span>
              <Button size="sm" variant="ghost" onClick={() => restore(item)}>{t('trash.restore')}</Button>
              <Button size="sm" variant="ghost" onClick={() => forever(item)}>{t('trash.deleteForever')}</Button>
            </li>
          ))}
        </ul>
      </LoadState>
    </>
  );
}
