'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { EngagementService } from '@/engagement';
import { operator, withSession } from '@/web/session';

/**
 * The three decisions, as one action.
 *
 * The decision follows the text, not the button. An operator who edits the
 * draft and clicks Approve has edited it, and recording that as an approval
 * would quietly understate the edit rate, which is the only number that says
 * whether the drafting is worth keeping at all. The service refuses it too;
 * this derives the right answer so the operator is never fighting the screen to
 * get an honest record.
 */
export async function decide(formData: FormData): Promise<void> {
  const messageId = String(formData.get('messageId') ?? '');
  const intent = String(formData.get('intent') ?? '');
  const body = String(formData.get('body') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  const error = await withSession(async (tx, tenantId) => {
    const svc = new EngagementService(tx, tenantId, operator());
    const detail = await svc.messageDetail(messageId);
    if (!detail) return 'That draft is not in this queue.';

    try {
      if (intent === 'reject') {
        await svc.decide({ messageId, decision: 'rejected', reason, decidedAt: new Date() });
      } else {
        const changed = body.trim() !== detail.body.trim();
        await svc.decide({
          messageId,
          decision: changed ? 'edited' : 'approved',
          ...(changed ? { finalBody: body } : {}),
          decidedAt: new Date(),
        });
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'That decision could not be recorded.';
    }
  });

  if (error) redirect(`/queue/${messageId}?error=${encodeURIComponent(error)}`);
  revalidatePath('/queue');
  redirect('/queue');
}
