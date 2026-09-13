import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { harness, seedTenant, type Harness } from './helpers/db';
import { expectRejection } from './helpers/errors';
import {
  ConnectorRegistry,
  ConnectorPersistenceError,
  assertPersistable,
  createPublicEvidenceDirectory,
  linkedInRecruiterSeat,
  recruiterManualEntry,
} from '@/connectors';
import { Ledger } from '@/ledger';
import { persons } from '@/db/schema';

/**
 * Phase 0 exit criterion: a connector that declares
 * `persistence: 'manual_entry_only'` cannot be made to persist by any code path.
 *
 * The primary control is the type system. `Ledger.ingest` accepts only a
 * `PersistingConnector`, so the LinkedIn seat connector is rejected at compile
 * time, which `npm run typecheck` proves via the @ts-expect-error below. The
 * runtime guard covers the case where a connector arrives from a registry
 * lookup typed as the union.
 *
 * See architecture.md decision record entry 1.
 */
describe('connector persistence is enforced, not documented', () => {
  let h: Harness;
  let tenant: string;
  let personId: string;

  beforeAll(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Persistence Test')).id;
    personId = await h.app.withTenant(tenant, async (tx) => {
      const [row] = await tx
        .insert(persons)
        .values({ tenantId: tenant, displayName: 'Subject' })
        .returning({ id: persons.id });
      return row!.id;
    });
  });

  afterAll(async () => h?.close());

  it('the LinkedIn seat connector exposes no method that returns records', () => {
    // If someone adds a fetch() to this connector in future, this fails.
    expect('fetch' in linkedInRecruiterSeat).toBe(false);
    expect('view' in linkedInRecruiterSeat).toBe(false);
    expect(linkedInRecruiterSeat.persistence).toBe('manual_entry_only');
  });

  it('does not compile when a manual entry connector is passed to ingest', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
      // @ts-expect-error ingest accepts PersistingConnector only. Removing this
      // directive must break `npm run typecheck`; that failure is the proof.
      const promise = ledger.ingest(linkedInRecruiterSeat, [], {
        jurisdiction: 'CA',
        personIdFor: () => personId,
      });
      await expectRejection(promise, /reaches the ledger only through a human/);
    });
  });

  it('throws at runtime when the connector came from a registry lookup', () => {
    const registry = new ConnectorRegistry()
      .register(linkedInRecruiterSeat)
      .register(recruiterManualEntry)
      .register(createPublicEvidenceDirectory());

    // Typed as the union, so the compile time guarantee does not apply here.
    const fromRegistry = registry.get('linkedin-recruiter-seat');
    expect(() => assertPersistable(fromRegistry)).toThrow(ConnectorPersistenceError);
    expect(() => assertPersistable(fromRegistry)).toThrow(/reaches the ledger only through a human/);

    expect(() => assertPersistable(registry.get('public-evidence-directory'))).not.toThrow();
  });

  it('admits a manual entry surface only through a named human', async () => {
    const attributeId = await h.app.withTenant(tenant, async (tx) => {
      const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
      return ledger.recordManualEntry(
        linkedInRecruiterSeat,
        {
          personId,
          key: 'recruiter_note',
          value: 'Surfaced by the Active talent spotlight; tenure above average for the role.',
          citation: 'LinkedIn Recruiter seat, Spotlight: Active talent',
          observedAt: new Date('2026-09-10T00:00:00Z'),
        },
        { jurisdiction: 'CA' },
      );
    });
    expect(attributeId).toBeTruthy();
  });

  it('reports coverage confidence per region rather than implying completeness', () => {
    const registry = new ConnectorRegistry()
      .register(linkedInRecruiterSeat)
      .register(createPublicEvidenceDirectory());

    expect(registry.coverageFor('CA')).toBeGreaterThan(0.9);
    // The honest answer for mainland China is that the data is not there.
    expect(registry.coverageFor('CN')).toBeLessThan(0.2);
    expect(registry.coverageFor('AQ')).toBe(0);
  });
});
