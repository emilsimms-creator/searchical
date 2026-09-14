import { notFound } from 'next/navigation';
import { decide } from '~/actions';
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

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function DraftPage({
  params, searchParams,
}: {
  params: Promise<{ messageId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { messageId } = await params;
  const { error } = await searchParams;

  const detail = await withSession((tx, tenantId) =>
    new EngagementService(tx, tenantId, operator()).messageDetail(messageId));
  if (!detail) notFound();

  const stale = detail.hooks.filter((h) => !h.evidenceLive).length;

  return (
    <>
      <p className="note"><a href="/queue">Back to the queue</a></p>
      <h1>{detail.personName}</h1>
      <p className="note">
        {detail.mandateTitle} · touch {detail.touch} of {detail.sequenceTouches} ·{' '}
        {CHANNEL_LABEL[detail.channel] ?? detail.channel} · due {detail.scheduledFor}
      </p>

      {error ? <div className="error">{error}</div> : null}

      {/*
        The evidence comes before the draft, deliberately. The argument for a
        human in this loop is that they read the claim against its source. A
        screen that leads with the prose invites approval of the prose.
      */}
      <h2>What this rests on</h2>
      <div className="card">
        {detail.hooks.length === 0 ? (
          <p className="note">
            No hooks recorded. This template does not require person specific evidence.
          </p>
        ) : (
          detail.hooks.map((hook) => (
            <div className="hook" key={hook.token}>
              <div className="token">[{hook.token}]</div>
              <div className="value">{hook.value}</div>
              <div>
                <a href={hook.citation} target="_blank" rel="noreferrer noopener">{hook.citation}</a>
                {' '}
                <span className={hook.evidenceLive ? 'badge live' : 'badge stale'}>
                  {hook.evidenceLive ? 'live' : 'expired'}
                </span>
                <span className="note"> collected {day(hook.collectedAt)}</span>
              </div>
            </div>
          ))
        )}
        {stale > 0 ? (
          <p className="note" style={{ marginTop: 10 }}>
            {stale} of these has expired. A talk from four years ago cited as recent is the
            sentence that ends the conversation. Check it before this goes out.
          </p>
        ) : null}
      </div>

      <h2>What this touch is for</h2>
      <div className="card">
        <dl className="facts">
          <dt>Purpose</dt><dd>{detail.templatePurpose}</dd>
          <dt>Rests on</dt><dd>{detail.templateEvidence}</dd>
          {detail.priorDecisions.length > 0 ? (
            <>
              <dt>Already decided</dt>
              <dd>
                {detail.priorDecisions
                  .map((d) => `touch ${d.touch} ${d.decision} on ${day(d.decidedAt)}`)
                  .join(', ')}
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <h2>The draft</h2>
      <form action={decide}>
        <input type="hidden" name="messageId" value={detail.messageId} />
        {detail.subject ? (
          <p className="note">Subject: {detail.subject}</p>
        ) : null}
        <textarea name="body" defaultValue={detail.body} aria-label="Draft message" />
        <p className="note">
          Change the words here and Approve records it as an edit. That is on purpose: an edit
          recorded as an approval understates the edit rate, which is the measure of whether the
          drafting is doing its job.
        </p>

        <div className="actions">
          <button className="primary" name="intent" value="approve" type="submit">
            Approve
          </button>
          <button className="danger" name="intent" value="reject" type="submit">
            Reject
          </button>
        </div>

        <h2>Reason, if rejecting</h2>
        <input
          type="text"
          name="reason"
          placeholder="Why this angle is wrong for this person. It is the signal that improves the drafting."
        />
      </form>

      <p className="note" style={{ marginTop: 20 }}>
        Approving does not send. The Pilot Cut relays by hand from your own seat.
      </p>
    </>
  );
}
