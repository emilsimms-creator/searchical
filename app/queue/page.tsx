import { EngagementService } from '@/engagement';
import { operator, withSession } from '@/web/session';

export const dynamic = 'force-dynamic';

const CHANNEL_LABEL: Record<string, string> = {
  linkedin_connection: 'LinkedIn connection note',
  linkedin_inmail: 'LinkedIn InMail',
  email: 'Email',
  phone: 'Phone',
  voicemail: 'Voicemail',
  referral: 'Referral',
};

export default async function QueuePage() {
  const { queue, metrics } = await withSession(async (tx, tenantId) => {
    const svc = new EngagementService(tx, tenantId, operator());
    return { queue: await svc.pendingQueue(), metrics: await svc.approvalMetrics() };
  });

  return (
    <>
      <h1>Waiting on you</h1>
      <p className="note">
        {queue.length === 0
          ? 'Nothing queued.'
          : `${queue.length} draft${queue.length === 1 ? '' : 's'}, oldest first. A touch that goes out late is no longer the sequence the research supports.`}
      </p>

      {/*
        The edit rate is shown on the queue rather than buried in a report,
        because it is the number that says whether the drafting is worth
        keeping. An operator rewriting most drafts is writing the messages
        themselves, and that is worth knowing early.
      */}
      <div className={metrics.editRate > 0.7 ? 'metric loud' : 'metric'}>{metrics.statement}</div>

      {queue.length === 0 ? (
        <p className="empty">
          When a sequence schedules a touch and research has a verified hook for it, the draft
          appears here. Nothing reaches a candidate without passing through this screen.
        </p>
      ) : (
        queue.map((item) => (
          <a className="row" key={item.messageId} href={`/queue/${item.messageId}`}>
            <div className="who">{item.personName}</div>
            <div className="meta">
              {item.mandateTitle} · touch {item.touch} ·{' '}
              {CHANNEL_LABEL[item.channel] ?? item.channel} · due {item.scheduledFor} ·{' '}
              {item.hookCount} hook{item.hookCount === 1 ? '' : 's'}
            </div>
            <div className="preview">
              {item.body.length > 160 ? `${item.body.slice(0, 160)}…` : item.body}
            </div>
          </a>
        ))
      )}
    </>
  );
}
