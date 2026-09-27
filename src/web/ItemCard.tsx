/**
 * One thing on the list, and everything you can do to it in a tap or two:
 * Watched/Read then a reaction, Dismiss then a reason, and more/less like this.
 */
import {useState} from 'react';
import {FEEDBACK_KINDS, REACTIONS, dismissReasonsFor, type FeedbackKind} from '../core/feedback.ts';
import {itemPath, post, type ItemWithFeedback} from './api.ts';
import {ago, length, useShared} from './state.ts';

const REACTION_ICON: Record<string, string> = {loved: '❤️', liked: '👍', meh: '😐', disliked: '👎', abandoned: '⏹'};
const SOURCE_ICON: Record<string, string> = {youtube: '▶', papers: '📄', docs: '📘'};

const label = (kind: string) => (FEEDBACK_KINDS as Record<string, {label: string}>)[kind]?.label ?? kind.replace(/_/g, ' ');

type Panel = 'none' | 'done' | 'dismiss' | 'menu' | 'block';

export function ItemCard({item, history = false}: {item: ItemWithFeedback; history?: boolean}) {
  const shared = useShared();
  const source = shared.source(item.source);
  const [panel, setPanel] = useState<Panel>('none');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const doneLabel = source?.done_label ?? 'Done';
  const itemLabel = item.source === 'docs' ? (shared.who.docs?.item_label ?? 'page') : (source?.item_label ?? 'item');

  const act = async (action: string, body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await post(itemPath(item.id, action), {...body, ...(note.trim() === '' ? {} : {note: note.trim()})});
      shared.toast(message);
      setPanel('none');
      setNote('');
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (next: Panel) => setPanel(panel === next ? 'none' : next);
  const title = item.title || item.url;
  const meta = [item.creator, item.container, length(item.length_minutes), ago(item.published ?? item.added)].filter(Boolean);
  const blurb = item.summary ?? item.abstract;

  return (
    <article className={`card state-${item.state}${item.origin === 'agent' ? ' suggested' : ''}`}>
      <div className="card-main">
        {item.thumbnail && (
          <a className="thumb" href={item.url} target="_blank" rel="noreferrer">
            <img src={item.thumbnail} alt="" loading="lazy" />
            {item.length_minutes !== null && <span className="duration">{length(item.length_minutes)}</span>}
          </a>
        )}
        <div className="card-body">
          <h3>
            <span className={`src src-${item.source}`} title={source?.name ?? item.source}>
              {SOURCE_ICON[item.source]}
            </span>
            <a href={item.url} target="_blank" rel="noreferrer">
              {title}
            </a>
          </h3>
          <p className="meta">{meta.join(' · ')}</p>
          {item.origin === 'agent' && item.reason && (
            <button type="button" className={`reason${showReason ? ' open' : ''}`} onClick={() => setShowReason(!showReason)}>
              <span className="badge">✦ suggested</span> {item.reason}
            </button>
          )}
          {item.origin === 'follow' && item.reason && <p className="reason-plain">Passed screening: {item.reason}</p>}
          {item.source === 'docs' && item.summary === null && item.title === '' && <p className="meta">Waiting for the curator to read and summarise it.</p>}
          {blurb && (
            <details className="blurb">
              <summary>{item.summary ? 'Summary' : 'Abstract'}</summary>
              <p>{blurb}</p>
            </details>
          )}
          {history && (
            <p className="history-line">
              <span className={`pill ${item.state}`}>{item.state === 'done' ? doneLabel : 'Dismissed'}</span> {ago(item.changed)}
              {(item.feedback ?? []).map((f, i) => (
                <span key={i} className="pill soft" title={f.note}>
                  {REACTION_ICON[f.kind] ?? ''} {label(f.kind)}
                  {f.note ? ` — ${f.note}` : ''}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="actions">
        <a className="button" href={item.url} target="_blank" rel="noreferrer">
          Open
        </a>
        {history ? (
          <button type="button" disabled={busy} onClick={() => void act('restore', {}, 'Back on the list')}>
            Restore
          </button>
        ) : (
          <>
            <button type="button" className={panel === 'done' ? 'on' : ''} onClick={() => toggle('done')}>
              {doneLabel}
            </button>
            <button type="button" className={panel === 'dismiss' || panel === 'block' ? 'on' : ''} onClick={() => toggle('dismiss')}>
              Dismiss
            </button>
          </>
        )}
        <button type="button" className={`more${panel === 'menu' ? ' on' : ''}`} aria-label="More" onClick={() => toggle('menu')}>
          ⋯
        </button>
      </div>

      {panel === 'done' && (
        <div className="panel">
          <p className="panel-title">How was it?</p>
          <div className="chips">
            {REACTIONS.map(r => (
              <button key={r} type="button" className="chip" disabled={busy} onClick={() => void act('done', {reaction: r}, `${doneLabel}: ${label(r)}`)}>
                {REACTION_ICON[r]} {label(r)}
              </button>
            ))}
            <button type="button" className="chip plain" disabled={busy} onClick={() => void act('done', {}, doneLabel)}>
              Just mark {doneLabel.toLowerCase()}
            </button>
          </div>
          <input className="note" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
        </div>
      )}

      {panel === 'dismiss' && (
        <div className="panel">
          <p className="panel-title">Why not?</p>
          <div className="chips">
            {dismissReasonsFor(item.source).map((reason: FeedbackKind) => (
              <button
                key={reason}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => (reason === 'not_interested_creator' ? setPanel('block') : void act('dismiss', {reason}, `Dismissed: ${label(reason)}`))}
              >
                {label(reason)}
              </button>
            ))}
            <button type="button" className="chip plain" disabled={busy} onClick={() => void act('dismiss', {}, 'Dismissed')}>
              No reason
            </button>
          </div>
          <input className="note" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
        </div>
      )}

      {panel === 'block' && (
        <div className="panel">
          <p className="panel-title">Not {item.creator || 'this creator'}.</p>
          <div className="chips">
            <button type="button" className="chip" disabled={busy} onClick={() => void act('dismiss', {reason: 'not_interested_creator'}, 'Dismissed')}>
              Dismiss
            </button>
            {item.creator_external_id && (
              <button type="button" className="chip danger" disabled={busy} onClick={() => void act('dismiss', {reason: 'not_interested_creator', block: true}, `Dismissed and blocked ${item.creator}`)}>
                Dismiss and block {item.creator}
              </button>
            )}
          </div>
        </div>
      )}

      {panel === 'menu' && (
        <div className="panel">
          <div className="chips">
            <button type="button" className="chip" disabled={busy} onClick={() => void act('feedback', {kind: 'more'}, 'Noted: more like this')}>
              More like this
            </button>
            <button type="button" className="chip" disabled={busy} onClick={() => void act('feedback', {kind: 'less'}, 'Noted: less like this')}>
              Less like this
            </button>
            {note.trim() !== '' && (
              <button type="button" className="chip" disabled={busy} onClick={() => void act('feedback', {kind: 'comment'}, 'Comment saved')}>
                Save comment
              </button>
            )}
          </div>
          <input className="note" placeholder={`Comment on this ${itemLabel} (optional)`} value={note} onChange={e => setNote(e.target.value)} />
        </div>
      )}
    </article>
  );
}
