import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from './helpers/db';
import { expectRejection } from './helpers/errors';
import { organizations, persons, signalTypes } from '@/db/schema';
import { Ledger } from '@/ledger';
import { createPublicEvidenceDirectory, linkedInRecruiterSeat, recruiterManualEntry } from '@/connectors';

/**
 * Phase 0 exit criterion: a fact can be written only through the ledger, with
 * full provenance. Not by convention. By grant.
 */
describe('the evidence ledger is the only write path', () => {
  let h: Harness;
  let tenant: string;
  let personId: string;

  beforeAll(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Ledger Test')).id;
    personId = await h.app.withTenant(tenant, async (tx) => {
      const [row] = await tx
        .insert(persons)
        .values({ tenantId: tenant, displayName: 'Test Subject' })
        .returning({ id: persons.id });
      return row!.id;
    });
  });

  afterAll(async () => h?.close());

  it('refuses a direct insert into every append only fact table', async () => {
    const tables = ['evidence', 'attributes', 'sensitive_attributes', 'signals', 'employments', 'consents', 'audit_log'];
    for (const table of tables) {
      await expectRejection(
        h.app.withTenant(tenant, async (tx) => {
          await tx.execute(sql.raw(`INSERT INTO ${table} (tenant_id) VALUES ('${tenant}')`));
        }),
        /permission denied/i,
        `direct insert into ${table} must be denied`,
      );
    }
  });

  it('refuses to update or delete history', async () => {
    await expectRejection(
      h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE evidence SET confidence = 1`)),
      /permission denied/i,
      'updating evidence must be denied',
    );
    await expectRejection(
      h.app.withTenant(tenant, (tx) => tx.execute(sql`DELETE FROM signals`)),
      /permission denied/i,
      'deleting signals must be denied',
    );
  });

  it('writes a fact with its provenance through the ledger', async () => {
    const row = await h.app.withTenant(tenant, async (tx) => {
      const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
      const sourceId = await ledger.registerSource(recruiterManualEntry);
      const evidenceId = await ledger.recordEvidence({
        sourceId,
        collectionMethod: 'recruiter_entered',
        collectedAt: new Date('2026-09-01T00:00:00Z'),
        lawfulBasis: 'legitimate_interest',
        jurisdiction: 'CA',
        confidence: 0.8,
        citation: 'https://example.org/talk',
      });
      await ledger.recordAttribute({ personId, key: 'headline', value: 'VP Infrastructure', evidenceId });

      const res = (await tx.execute(sql`
        SELECT a.key, a.value, e.lawful_basis, e.jurisdiction, e.confidence, e.citation, s.connector_id
        FROM attributes a
        JOIN evidence e ON e.id = a.evidence_id
        JOIN sources  s ON s.id = e.source_id
        WHERE a.person_id = ${personId}::uuid
      `)) as unknown as { rows: Record<string, unknown>[] };
      return res.rows[0]!;
    });

    expect(row.key).toBe('headline');
    expect(row.lawful_basis).toBe('legitimate_interest');
    expect(row.jurisdiction).toBe('CA');
    expect(row.citation).toBe('https://example.org/talk');
    expect(row.connector_id).toBe('recruiter-manual-entry');
  });

  it('derives signal expiry from the signal type rather than trusting the caller', async () => {
    const { observedAt, expiresAt, windowDays } = await h.app.withTenant(tenant, async (tx) => {
      const [type] = await tx
        .insert(signalTypes)
        .values({
          tenantId: tenant,
          code: 'employer.rto_mandate',
          label: 'Employer return to office mandate',
          category: 'employer_trigger',
          strength: 'high',
          points: 4,
          recencyWindowDays: 30,
          sourceCitation: 'Gartner (May 2024)',
        })
        .returning({ id: signalTypes.id, days: signalTypes.recencyWindowDays });

      const [org] = await tx
        .insert(organizations)
        .values({ tenantId: tenant, name: 'Watched Employer' })
        .returning({ id: organizations.id });

      const ledger = new Ledger(tx, { type: 'system', id: 'watcher' });
      const sourceId = await ledger.registerSource(recruiterManualEntry);
      const evidenceId = await ledger.recordEvidence({
        sourceId,
        collectionMethod: 'public_evidence',
        collectedAt: new Date('2026-09-01T00:00:00Z'),
        lawfulBasis: 'publicly_available_exemption',
        jurisdiction: 'CA',
        confidence: 0.9,
      });
      const observed = new Date('2026-09-01T00:00:00Z');
      await ledger.recordSignal({
        subjectType: 'organization',
        subjectId: org!.id,
        signalTypeId: type!.id,
        observedAt: observed,
        evidenceId,
      });

      const res = (await tx.execute(sql`
        SELECT observed_at, expires_at FROM signals LIMIT 1
      `)) as unknown as { rows: { observed_at: string; expires_at: string }[] };
      return {
        observedAt: new Date(res.rows[0]!.observed_at),
        expiresAt: new Date(res.rows[0]!.expires_at),
        windowDays: type!.days,
      };
    });

    const days = (expiresAt.getTime() - observedAt.getTime()) / 86_400_000;
    expect(days).toBe(windowDays);
  });

  it('refuses an incomplete conspicuous publication consent record', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
        const sourceId = await ledger.registerSource(recruiterManualEntry);
        const evidenceId = await ledger.recordEvidence({
          sourceId,
          collectionMethod: 'public_evidence',
          collectedAt: new Date(),
          lawfulBasis: 'publicly_available_exemption',
          jurisdiction: 'CA',
          confidence: 0.7,
        });
        await ledger.recordConsent({
          personId,
          basis: 'implied_conspicuous_publication',
          capturedAt: new Date(),
          evidenceId,
          // The three conditions and the source URL are deliberately absent.
        });
      }),
      /conspicuous_publication|conspicuous publication/i,
      'an incomplete conspicuous publication record must be refused',
    );
  });

  it('ingests from a persisting connector', async () => {
    const directory = createPublicEvidenceDirectory([
      {
        entity: 'person',
        payload: { headline: 'Principal Cloud Architect' },
        citation: 'https://example.org/kubecon-2026',
        observedAt: new Date('2026-08-15T00:00:00Z'),
      },
    ]);

    const result = await h.app.withTenant(tenant, async (tx) => {
      const ledger = new Ledger(tx, { type: 'connector', id: directory.id });
      return ledger.ingest(directory, await directory.fetch({ terms: ['kubernetes'] }), {
        jurisdiction: 'CA',
        personIdFor: () => personId,
      });
    });

    expect(result.evidenceIds).toHaveLength(1);
    expect(result.attributeIds).toHaveLength(1);
  });

  it('requires a human actor for a manual entry surface', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const ledger = new Ledger(tx, { type: 'system', id: 'automation' });
        await ledger.recordManualEntry(
          linkedInRecruiterSeat,
          { personId, key: 'spotlight', value: 'open_to_work', observedAt: new Date() },
          { jurisdiction: 'CA' },
        );
      }),
      /requires a human actor/i,
      'automation must not write through a manual entry surface',
    );
  });
});
