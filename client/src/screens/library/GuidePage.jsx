import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { useConfirm } from '../../components/ConfirmProvider.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { starterText } from '../../lib/starter.js';
import { useT } from '../../i18n/I18nProvider.jsx';

export function GuidePageRoute() {
  const { id } = useParams();
  return <GuidePage key={id} id={id} />;
}

function GuidePage({ id }) {
  const { t, tc } = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const guide = useResource(`/api/guides/${id}`);
  const g = guide.data;
  const text = (field, value) => starterText(tc, g, field, value);
  const back = g?.plant ? `/library/plants/${g.plant.id}` : '/library?tab=guides';
  const plantName = g?.plant ? starterText(tc, g.plant, 'name', g.plant.name) : null;

  const remove = async () => {
    if (!await confirm({ title: t('guides.deleteTitle', { name: text('title', g.title) }), body: t('guides.deleteBody'), confirmLabel: t('common.delete'), danger: true })) return;
    try { await api.del(`/api/guides/${g.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); guide.reload(); return; }
    navigate(back);
    toast.show({ message: t('guides.deleted', { name: text('title', g.title) }), duration: 8000,
      action: { label: t('common.undo'), onClick: async () => {
        try { await api.post(`/api/guides/${g.id}/restore`); navigate(`/library/guides/${g.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); }
      } } });
  };

  return (
    <article className="entry guide">
      <LoadState loading={guide.loading && !g} error={guide.error} keepChildren={Boolean(g)} onRetry={guide.reload}>
        {g && (
          <>
            <PageHeader title={text('title', g.title)}>
              <Button as={Link} variant="ghost" icon={Pencil} to={`/library/guides/${g.id}/edit`}>{t('common.edit')}</Button>
              <Button variant="ghost" icon={Trash2} onClick={remove}>{t('common.delete')}</Button>
            </PageHeader>
            <p className="entry-meta">
              {g.plant ? <Link to={`/library/plants/${g.plant.id}`}>{plantName}</Link> : <span>{t('guides.basics')}</span>}
              <span>{t(`guides.stage.${g.stage}`)}</span>
              {g.is_starter ? <span className="tag">{t('common.starter')}</span> : null}
            </p>
            {g.summary && <p className="lead">{text('summary', g.summary)}</p>}
            {g.basics && (g.basics.live
              ? <p className="note">{t('guides.buildsOn')} <Link to={`/library/guides/${g.basics.id}`}>{starterText(tc, g.basics, 'title', g.basics.title)}</Link></p>
              : <p className="note muted">{t('guides.basicsInTrash', { name: starterText(tc, g.basics, 'title', g.basics.title) })}</p>)}
            {g.supplies.length > 0 && (
              <section aria-labelledby="guide-supplies">
                <h2 id="guide-supplies">{t('guides.supplies')}</h2>
                <ul className="supplies" aria-labelledby="guide-supplies">
                  {g.supplies.map((s, i) => {
                    const name = text(`supply.${i + 1}.name`, s.name);
                    const amount = s.amount && text(`supply.${i + 1}.amount`, s.amount);
                    return <li key={i}>{amount ? `${name}: ${amount}` : name}</li>;
                  })}
                </ul>
              </section>
            )}
            <section aria-labelledby="guide-steps">
              <h2 id="guide-steps">{t('guides.steps')}</h2>
              <ol className="steps" aria-labelledby="guide-steps">
                {g.steps.map((s, i) => <li key={i}>{text(`step.${i + 1}`, s)}</li>)}
              </ol>
            </section>
          </>
        )}
      </LoadState>
      <p><Link to={back}>{g?.plant ? t('guides.backToPlant', { name: plantName }) : t('guides.backToGuides')}</Link></p>
    </article>
  );
}
