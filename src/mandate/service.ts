import { and, eq, sql } from 'drizzle-orm';
import type { TenantTx } from '@/db/client';
import {
  channelRatings, channelSelections, intakeGaps, mandates, mandateTerms,
  pipelineProjections, searchStrings, sourceOfHireEvents, targetCompanies,
} from '@/db/schema';
import type { LlmGateway } from '@/llm/gateway';
import { CHANNEL_MATRIX_SEED } from './channel-matrix';
import { deriveIntakeGaps, jobSpecExtraction, toDraft } from './extraction';
import { projectPipeline, type PipelineInput } from './pipeline';
import { planChannels, type ChannelPlan } from './planner';
import { generateSearchStrings, type GeneratedStrings } from './strings';
import { MandateError, OutOfScopeError, isSupportedSegment, type ChannelRatingSeed, type IntakeGap, type MandateDraft, type MandateTerm, type PipelineProjection, type Segment } from './types';
import { validateVocabulary, type TitleFrequencySource, type ValidatedVocabulary } from './vocabulary';

export interface Actor {
  readonly id: string;
}

export interface DraftedMandate {
  readonly mandateId: string;
  readonly draft: MandateDraft;
  readonly vocabulary: ValidatedVocabulary;
  readonly gaps: readonly IntakeGap[];
  readonly status: 'awaiting_confirmation' | 'out_of_scope';
  /** Set only when the verdict is out_of_scope: why, in the recruiter's terms. */
  readonly outOfScopeReason?: string;
}

export interface SearchPlan {
  readonly mandateId: string;
  readonly strings: GeneratedStrings;
  readonly channels: ChannelPlan;
  readonly pipeline: PipelineProjection;
}

export interface TermDecision {
  readonly kind: MandateTerm['kind'];
  readonly term: string;
  readonly decision: 'confirm' | 'reject';
}

/**
 * Seed a tenant's channel matrix.
 *
 * Called once when a tenant is created. The values are the practice's
 * researched ratings, and they become tenant data the moment they land: phase
 * four writes source of hire outcomes back into them.
 */
export async function seedChannelRatings(tx: TenantTx, tenantId: string): Promise<number> {
  const rows = CHANNEL_MATRIX_SEED.map((c: ChannelRatingSeed) => ({ tenantId, ...c }));
  await tx.insert(channelRatings).values(rows).onConflictDoNothing();
  return rows.length;
}

export class MandateService {
  readonly #tx: TenantTx;
  readonly #gateway: LlmGateway;
  readonly #titleFrequency: TitleFrequencySource | null;

  constructor(tx: TenantTx, gateway: LlmGateway, titleFrequency: TitleFrequencySource | null = null) {
    this.#tx = tx;
    this.#gateway = gateway;
    this.#titleFrequency = titleFrequency;
  }

  /**
   * Job specification in, drafted mandate out.
   *
   * The mandate lands as `awaiting_confirmation`, never `live`. Everything the
   * model proposed is marked `proposed`, the title variants carry their observed
   * frequency in the target universe, and the questions the specification did
   * not answer are recorded as gaps to put to the hiring leader.
   */
  async draftFromJobSpec(args: {
    jobSpec: string;
    actor: Actor;
    tenantId: string;
    sourceDocumentRef?: string;
  }): Promise<DraftedMandate> {
    const extracted = await this.#gateway.run(jobSpecExtraction, { jobSpec: args.jobSpec });
    const draft = toDraft(extracted);

    // Triage before anything else. A mandate outside the two segments this
    // practice recruits is recorded and stopped, not force fitted: the channel
    // matrix has no opinion about it, and inventing one produces a plan that is
    // confidently wrong. The row is kept because what the practice is being
    // sent and cannot serve is itself worth knowing.
    if (!isSupportedSegment(draft.segment)) {
      const [outOfScope] = await this.#tx
        .insert(mandates)
        .values({
          tenantId: args.tenantId,
          title: draft.title,
          segment: 'out_of_scope',
          segmentRationale: draft.segmentRationale,
          functionDomain: draft.functionDomain,
          location: draft.location,
          engagementType: draft.engagementType,
          status: 'out_of_scope',
          sourceDocumentRef: args.sourceDocumentRef ?? null,
          createdBy: args.actor.id,
        })
        .returning({ id: mandates.id });

      return {
        mandateId: outOfScope!.id,
        draft,
        vocabulary: { terms: [], zeroCount: [], checkedAgainst: null, note: 'Not assessed: mandate is out of scope.' },
        gaps: [],
        status: 'out_of_scope',
        outOfScopeReason: draft.segmentRationale,
      };
    }

    const vocabulary = await validateVocabulary(
      draft.terms,
      { targetCompanies: draft.targetCompanies.map((c) => c.name), location: draft.location },
      this.#titleFrequency,
    );
    const gaps = deriveIntakeGaps(draft);

    const [row] = await this.#tx
      .insert(mandates)
      .values({
        tenantId: args.tenantId,
        title: draft.title,
        segment: draft.segment,
        segmentRationale: draft.segmentRationale,
        functionDomain: draft.functionDomain,
        location: draft.location,
        engagementType: draft.engagementType,
        status: 'awaiting_confirmation',
        firstYearOutcomes: draft.intake.firstYearOutcomes,
        operatingRange: draft.intake.operatingRange,
        careerMoveCase: draft.intake.careerMoveCase,
        sourceDocumentRef: args.sourceDocumentRef ?? null,
        createdBy: args.actor.id,
      })
      .returning({ id: mandates.id });

    const mandateId = row!.id;

    if (vocabulary.terms.length > 0) {
      await this.#tx.insert(mandateTerms).values(
        vocabulary.terms.map((t) => ({
          tenantId: args.tenantId,
          mandateId,
          kind: t.kind,
          term: t.term,
          origin: t.origin,
          status: t.status,
          observedCount: t.observedCount,
          observedAt: t.observedCount === null ? null : new Date(),
          extractionConfidence: t.extractionConfidence?.toString() ?? null,
          rank: t.rank,
        })),
      );
    }

    if (gaps.length > 0) {
      await this.#tx
        .insert(intakeGaps)
        .values(gaps.map((g) => ({ tenantId: args.tenantId, mandateId, field: g.field, question: g.question })));
    }

    if (draft.targetCompanies.length > 0) {
      await this.#tx.insert(targetCompanies).values(
        draft.targetCompanies.map((c) => ({
          tenantId: args.tenantId,
          mandateId,
          name: c.name,
          kind: c.kind,
          rationale: c.rationale ?? null,
          // Every target company joins the employer watchlist permanently.
          watchlisted: true,
        })),
      );
    }

    return { mandateId, draft, vocabulary, gaps, status: 'awaiting_confirmation' };
  }

  /**
   * The gate.
   *
   * A recruiter accepts or rejects each proposed term, and only then does the
   * mandate go live. This is not removable: a language model will write an
   * excellent search string for the wrong search, and the human is the only
   * thing that knows what this market calls the role. See architecture.md s5.2.
   */
  async confirmVocabulary(args: {
    mandateId: string;
    decisions: readonly TermDecision[];
    actor: Actor;
    /** Terms the recruiter added that the model never proposed. */
    additions?: readonly { kind: MandateTerm['kind']; term: string }[];
    tenantId: string;
  }): Promise<{ confirmed: number; rejected: number }> {
    const mandate = await this.#requireMandate(args.mandateId);
    if (mandate.status === 'out_of_scope') {
      throw new OutOfScopeError(mandate.title, mandate.segmentRationale ?? '');
    }
    if (mandate.status === 'live') {
      throw new MandateError(`mandate ${args.mandateId} is already live`);
    }

    for (const addition of args.additions ?? []) {
      await this.#tx
        .insert(mandateTerms)
        .values({
          tenantId: args.tenantId,
          mandateId: args.mandateId,
          kind: addition.kind,
          term: addition.term,
          origin: 'recruiter',
          status: 'confirmed',
          rank: 0,
        })
        .onConflictDoNothing();
    }

    let confirmed = 0;
    let rejected = 0;
    for (const decision of args.decisions) {
      await this.#tx
        .update(mandateTerms)
        .set({ status: decision.decision === 'confirm' ? 'confirmed' : 'rejected' })
        .where(
          and(
            eq(mandateTerms.mandateId, args.mandateId),
            eq(mandateTerms.kind, decision.kind),
            eq(mandateTerms.term, decision.term),
          ),
        );
      if (decision.decision === 'confirm') confirmed += 1;
      else rejected += 1;
    }

    const confirmedTitles = await this.#confirmedTerms(args.mandateId, 'title_variant');
    if (confirmedTitles.length === 0) {
      throw new MandateError(
        'a mandate cannot go live with no confirmed title variant: the search would have nothing to look for',
      );
    }

    await this.#tx
      .update(mandates)
      .set({ status: 'live', confirmedBy: args.actor.id, confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(mandates.id, args.mandateId));

    return { confirmed: confirmed + (args.additions?.length ?? 0), rejected };
  }

  /**
   * Build the executable plan: search strings, channel plan and pipeline
   * arithmetic. Only runs against a live mandate, because only a live mandate
   * has human confirmed vocabulary behind it.
   */
  async buildSearchPlan(args: {
    mandateId: string;
    tenantId: string;
    pipeline?: Partial<PipelineInput>;
  }): Promise<SearchPlan> {
    const mandate = await this.#requireMandate(args.mandateId);
    if (mandate.status === 'out_of_scope') {
      throw new OutOfScopeError(mandate.title, mandate.segmentRationale ?? '');
    }
    if (mandate.status !== 'live') {
      throw new MandateError(
        `mandate ${args.mandateId} is "${mandate.status}": a recruiter must confirm the market vocabulary ` +
          `before a search plan is generated`,
      );
    }

    const terms = await this.#allTerms(args.mandateId);
    const strings = generateSearchStrings({ terms, location: mandate.location });

    const ratings = await this.#tx
      .select()
      .from(channelRatings)
      .where(eq(channelRatings.tenantId, args.tenantId));
    if (ratings.length === 0) {
      throw new MandateError('channel matrix is not seeded for this tenant: call seedChannelRatings first');
    }
    const channels = planChannels(ratings as unknown as ChannelRatingSeed[], mandate.segment as Segment);

    const pipeline = projectPipeline({
      targetConversations: args.pipeline?.targetConversations ?? 10,
      longListSize: args.pipeline?.longListSize ?? 75,
      ...(args.pipeline?.responseRate !== undefined ? { responseRate: args.pipeline.responseRate } : {}),
      ...(args.pipeline?.interestedShare !== undefined ? { interestedShare: args.pipeline.interestedShare } : {}),
      ...(args.pipeline?.touchesPerPerson !== undefined ? { touchesPerPerson: args.pipeline.touchesPerPerson } : {}),
    });

    await this.#tx.insert(searchStrings).values(
      strings.strings.map((s) => ({ tenantId: args.tenantId, mandateId: args.mandateId, kind: s.kind, value: s.value })),
    );

    await this.#tx
      .insert(channelSelections)
      .values(
        channels.selections.map((s) => ({
          tenantId: args.tenantId,
          mandateId: args.mandateId,
          channelCode: s.channelCode,
          fit: s.fit,
          priority: s.priority,
          reason: s.reason,
        })),
      )
      .onConflictDoNothing();

    await this.#tx.insert(pipelineProjections).values({
      tenantId: args.tenantId,
      mandateId: args.mandateId,
      targetConversations: pipeline.targetConversations,
      longListSize: pipeline.longListSize,
      responseRate: pipeline.responseRate.toString(),
      interestedShare: pipeline.interestedShare.toString(),
      touchesPerPerson: pipeline.touchesPerPerson,
      contactsRequired: pipeline.contactsRequired,
      touchesRequired: pipeline.touchesRequired,
      longListSufficient: pipeline.longListSufficient,
      ratesSource: pipeline.ratesSource,
      ratesSampleSize: pipeline.ratesSampleSize,
    });

    return { mandateId: args.mandateId, strings, channels, pipeline };
  }

  /**
   * Source of hire instrumentation. Captured from phase one, reported in phase
   * four. Every stage of every person's journey is attributed to the channel
   * that produced it, because that attribution is what lets the channel matrix
   * converge on this practice's own results.
   */
  async recordSourceOfHire(args: {
    tenantId: string;
    mandateId: string;
    channelCode: string;
    stage: 'identified' | 'contacted' | 'replied' | 'conversation' | 'shortlisted' | 'placed';
    personId?: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    await this.#tx.insert(sourceOfHireEvents).values({
      tenantId: args.tenantId,
      mandateId: args.mandateId,
      channelCode: args.channelCode,
      stage: args.stage,
      personId: args.personId ?? null,
      detail: args.detail ?? {},
    });
  }

  async #requireMandate(mandateId: string) {
    const [row] = await this.#tx.select().from(mandates).where(eq(mandates.id, mandateId)).limit(1);
    if (!row) throw new MandateError(`mandate ${mandateId} not found in this tenant`);
    return row;
  }

  async #allTerms(mandateId: string): Promise<MandateTerm[]> {
    const rows = await this.#tx
      .select()
      .from(mandateTerms)
      .where(eq(mandateTerms.mandateId, mandateId))
      .orderBy(mandateTerms.rank);
    return rows.map((r) => ({
      kind: r.kind,
      term: r.term,
      origin: r.origin,
      status: r.status,
      observedCount: r.observedCount,
      ...(r.extractionConfidence !== null ? { extractionConfidence: Number(r.extractionConfidence) } : {}),
      rank: r.rank,
    }));
  }

  async #confirmedTerms(mandateId: string, kind: MandateTerm['kind']) {
    return this.#tx
      .select({ term: mandateTerms.term })
      .from(mandateTerms)
      .where(
        and(
          eq(mandateTerms.mandateId, mandateId),
          eq(mandateTerms.kind, kind),
          eq(mandateTerms.status, 'confirmed'),
        ),
      );
  }
}

/** Channels whose own rules prohibit unsolicited outreach, for the policy engine. */
export const channelCodesWithNoColdOutreach = (): readonly string[] =>
  CHANNEL_MATRIX_SEED.filter((c) =>
    /no-recruiter|not for cold outreach|rules against|not a list to scrape|do not pitch/i.test(c.etiquette),
  ).map((c) => c.code);

export { sql };
