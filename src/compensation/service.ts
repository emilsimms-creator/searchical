import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { TenantTx } from '@/db/client';
import { mandateCompensation, prospectCompensation } from '@/db/schema';
import { analyseGap, factor8Guidance } from './gap';
import { missingBandQuestion, payHistoryRestrictedAt } from './jurisdiction';
import { formatRange, normaliseCurrency } from './money';
import type {
  CompensationBand, CompensationPeriod, GapAnalysis, ProspectFigure,
} from './types';

export class CompensationError extends Error {}

const asBand = (r: typeof mandateCompensation.$inferSelect): CompensationBand => ({
  id: r.id,
  mandateId: r.mandateId,
  version: r.version,
  currency: r.currency.trim(),
  period: r.period,
  baseMinCents: r.baseMinCents,
  baseMaxCents: r.baseMaxCents,
  bonusTargetPct: r.bonusTargetPct === null ? null : Number(r.bonusTargetPct),
  equityNote: r.equityNote,
  pensionNote: r.pensionNote,
  otherNote: r.otherNote,
  inferred: r.inferred,
  sourceQuote: r.sourceQuote,
  confirmedBy: r.confirmedBy,
  confirmedAt: r.confirmedAt,
  supersededAt: r.supersededAt,
  supersededReason: r.supersededReason,
});

const asFigure = (r: typeof prospectCompensation.$inferSelect): ProspectFigure => ({
  id: r.id,
  prospectId: r.prospectId,
  figureKind: r.figureKind,
  currency: r.currency.trim(),
  period: r.period,
  amountCents: r.amountCents,
  amountMaxCents: r.amountMaxCents,
  volunteered: r.volunteered,
  note: r.note,
});

export class CompensationService {
  readonly #tx: TenantTx;
  readonly #tenantId: string;
  readonly #actor: { id: string };

  constructor(tx: TenantTx, tenantId: string, actor: { id: string }) {
    this.#tx = tx;
    this.#tenantId = tenantId;
    this.#actor = actor;
  }

  /**
   * Record a band, superseding whatever was live.
   *
   * Goes through the database function rather than an INSERT, because the
   * supersede and the insert have to be one statement. A caller that did the
   * two halves itself and got interrupted between them would leave a mandate
   * with either two live bands or none, and two live bands means two recruiters
   * quoting two different numbers on the same search.
   */
  async recordBand(args: {
    mandateId: string;
    currency?: string;
    period?: CompensationPeriod;
    baseMinCents?: bigint | null;
    baseMaxCents?: bigint | null;
    bonusTargetPct?: number | null;
    equityNote?: string | null;
    pensionNote?: string | null;
    otherNote?: string | null;
    inferred: boolean;
    sourceQuote?: string | null;
    reason?: string;
  }): Promise<{ bandId: string }> {
    const currency = normaliseCurrency(args.currency);
    if (args.inferred && args.sourceQuote) {
      throw new CompensationError(
        'An inferred band carries no source quote. If the specification states the number, the ' +
        'band is not inferred; if it does not, the quote is evidence for something else.',
      );
    }
    const r = (await this.#tx.execute(sql`
      SELECT compensation_record_band(
        ${args.mandateId}::uuid, ${currency}::char(3),
        ${args.period ?? 'annual'}::compensation_period,
        ${args.baseMinCents ?? null}::bigint, ${args.baseMaxCents ?? null}::bigint,
        ${args.bonusTargetPct ?? null}::numeric,
        ${args.equityNote ?? null}::text, ${args.pensionNote ?? null}::text,
        ${args.otherNote ?? null}::text,
        ${args.inferred}::boolean, ${args.sourceQuote ?? null}::text,
        ${this.#actor.id}::text, ${args.reason ?? null}::text
      ) AS id`)) as unknown as { rows: { id: string }[] };
    return { bandId: r.rows[0]!.id };
  }

  /** The live band, confirmed or not. */
  async liveBand(mandateId: string): Promise<CompensationBand | null> {
    const rows = await this.#tx.select().from(mandateCompensation).where(and(
      eq(mandateCompensation.tenantId, this.#tenantId),
      eq(mandateCompensation.mandateId, mandateId),
      isNull(mandateCompensation.supersededAt),
    )).limit(1);
    return rows[0] ? asBand(rows[0]) : null;
  }

  /** Every version, newest first. What the practice was quoting, and when. */
  async history(mandateId: string): Promise<CompensationBand[]> {
    const rows = await this.#tx.select().from(mandateCompensation).where(and(
      eq(mandateCompensation.tenantId, this.#tenantId),
      eq(mandateCompensation.mandateId, mandateId),
    )).orderBy(desc(mandateCompensation.version));
    return rows.map(asBand);
  }

  /**
   * The hiring leader stands behind the number.
   *
   * An inferred band cannot be confirmed: the database refuses it, and so does
   * this, because a market estimate confirmed by a recruiter reads downstream
   * exactly like a number the client committed to.
   */
  async confirmBand(bandId: string, at: Date): Promise<void> {
    const band = (await this.#tx.select().from(mandateCompensation)
      .where(and(
        eq(mandateCompensation.tenantId, this.#tenantId),
        eq(mandateCompensation.id, bandId),
      )).limit(1))[0];
    if (!band) throw new CompensationError(`no band ${bandId} in this tenant`);
    if (band.supersededAt !== null) {
      throw new CompensationError(
        'That version has been superseded. Confirm the live one, or record a new version.',
      );
    }
    if (band.inferred) {
      throw new CompensationError(
        'This band is inferred from the market, not stated by the client. Ask the hiring leader ' +
        'for their number and record that as a new version. A confirmed guess is indistinguishable ' +
        'downstream from a number the client committed to, and it is the recruiter who finds out.',
      );
    }
    await this.#tx.update(mandateCompensation)
      .set({ confirmedBy: this.#actor.id, confirmedAt: at })
      .where(eq(mandateCompensation.id, bandId));
  }

  /**
   * Record what the candidate said.
   *
   * `expectation` is what they want for this role and is the figure this system
   * is built around. `current_package` is pay history, which British Columbia
   * and Prince Edward Island both restrict employers from asking applicants
   * for. Whether a search firm acting as the client's agent is caught by those
   * provisions is a question for counsel that this code does not answer; it
   * takes the conservative route and refuses to record a history figure that
   * was not volunteered or that carries no stated lawful basis.
   */
  async recordFigure(args: {
    prospectId: string;
    figureKind: 'expectation' | 'current_package';
    amountCents: bigint | null;
    amountMaxCents?: bigint | null;
    currency?: string;
    period?: CompensationPeriod;
    volunteered: boolean;
    lawfulBasis?: string | null;
    note?: string | null;
    statedAt: Date;
    /** Where the person works, used only to check the pay history restriction. */
    personLocation?: string | null;
  }): Promise<{ figureId: string }> {
    if (args.figureKind === 'current_package') {
      if (!args.volunteered) {
        throw new CompensationError(
          'Pay history is recorded only where the person offered it unprompted. Asking an ' +
          'applicant what previous employers paid them is restricted in British Columbia and ' +
          'Prince Edward Island, and a system that cannot show which it did cannot show it ' +
          'complied. Record their expectation instead, which is the more useful number anyway.',
        );
      }
      if (!args.lawfulBasis) {
        throw new CompensationError(
          'A pay history figure needs a stated lawful basis naming why it is held, for this ' +
          'person, in this jurisdiction.',
        );
      }
      if (payHistoryRestrictedAt(args.personLocation ?? null)) {
        // Volunteered plus a stated basis clears the conservative bar; the note
        // makes sure the jurisdiction travels with the row for a later review.
        args.note = [args.note, `Pay history recorded in a jurisdiction where asking is restricted ` +
          `(${args.personLocation ?? 'location unknown'}). Volunteered, basis on file.`]
          .filter(Boolean).join(' ');
      }
    }
    const [row] = await this.#tx.insert(prospectCompensation).values({
      tenantId: this.#tenantId,
      prospectId: args.prospectId,
      figureKind: args.figureKind,
      currency: normaliseCurrency(args.currency),
      period: args.period ?? 'annual',
      amountCents: args.amountCents,
      amountMaxCents: args.amountMaxCents ?? null,
      note: args.note ?? null,
      volunteered: args.volunteered,
      lawfulBasis: args.lawfulBasis ?? null,
      statedAt: args.statedAt,
      recordedBy: this.#actor.id,
    }).returning({ id: prospectCompensation.id });
    return { figureId: row!.id };
  }

  /** The candidate's most recent expectation for this search. */
  async latestExpectation(prospectId: string): Promise<ProspectFigure | null> {
    const rows = await this.#tx.select().from(prospectCompensation).where(and(
      eq(prospectCompensation.tenantId, this.#tenantId),
      eq(prospectCompensation.prospectId, prospectId),
      eq(prospectCompensation.figureKind, 'expectation'),
    )).orderBy(desc(prospectCompensation.statedAt)).limit(1);
    return rows[0] ? asFigure(rows[0]) : null;
  }

  /**
   * The gap that kills searches at offer, surfaced at the first call instead.
   * Closes factor 8 of the receptivity model, which until now had a weight and
   * nothing to weigh.
   */
  async gap(mandateId: string, prospectId: string): Promise<GapAnalysis> {
    const [band, figure] = await Promise.all([
      this.liveBand(mandateId), this.latestExpectation(prospectId),
    ]);
    return analyseGap(band, figure);
  }

  async factor8(mandateId: string, prospectId: string, discussed: boolean): Promise<string> {
    return factor8Guidance(await this.gap(mandateId, prospectId), discussed);
  }

  /**
   * What a recruiter may say out loud, and to whom.
   *
   * The reply ladder's prescribed action for a compensation question is to give
   * a range anchored to track record. This is where that range comes from, and
   * there is exactly one source for it: a band the client has confirmed.
   */
  async quotableRange(mandateId: string): Promise<
    { quotable: true; text: string } | { quotable: false; reason: string }
  > {
    const band = await this.liveBand(mandateId);
    if (!band) {
      return {
        quotable: false,
        reason: 'No band on this mandate. Do not invent one: go back to the hiring leader.',
      };
    }
    if (band.inferred) {
      return {
        quotable: false,
        reason: 'This band is the system\'s reading of the market, not the client\'s number. ' +
          'Quoting it commits the client to something they have not agreed to.',
      };
    }
    if (band.confirmedAt === null) {
      return {
        quotable: false,
        reason: `Version ${band.version} is recorded from the specification but the hiring leader ` +
          'has not confirmed it. Specifications go stale and posting ranges are not offer ranges.',
      };
    }
    const parts = [`${formatRange(band.baseMinCents, band.baseMaxCents, band.currency)} base`];
    if (band.bonusTargetPct !== null) parts.push(`${band.bonusTargetPct} percent target bonus`);
    if (band.pensionNote) parts.push(band.pensionNote);
    if (band.equityNote) parts.push(band.equityNote);
    return { quotable: true, text: parts.join(', ') };
  }

  /** The intake question, sharpened by where the role sits. */
  bandQuestion(location: string | null): string {
    return missingBandQuestion(location);
  }
}
