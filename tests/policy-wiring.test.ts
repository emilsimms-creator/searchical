import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from './helpers/db';
import { causeOfType, errorChain } from './helpers/errors';
import { Ledger } from '@/ledger';
import { createPublicEvidenceDirectory, recruiterManualEntry } from '@/connectors';
import { EngagementService, MESSAGE_TEMPLATES, type EvidenceFact } from '@/engagement';
import { PolicyViolation, classify } from '@/policy';

const START = new Date('2026-09-01T09:00:00Z');
const RECORD = { entity: 'person' as const, observedAt: START, payload: { title: 'VP Engineering' } };
type Tx = Parameters<Parameters<Harness['app']['withTenant']>[1]>[0];

const violation = (e: unknown): PolicyViolation | null => causeOfType(e, PolicyViolation);

async function expectBlocked(p: Promise<unknown>, rule: string, why: string) {
  try {
    await p;
    throw new Error(`expected the ${rule} rule to block this. ${why}`);
  } catch (e) {
    const v = violation(e);
    if (!v) throw new Error(`expected a PolicyViolation carrying ${rule}. Got: ${errorChain(e)}`);
    const blocked = v.decision.reasons.filter((r) => !r.allowed).map((r) => r.rule);
    expect(blocked, why).toContain(rule);
    return v;
  }
}

async function person(tx: Tx, tenantId: string, name = 'A Candidate') {
  const r = (await tx.execute(sql`
    INSERT INTO persons (tenant_id, display_name) VALUES (${tenantId}::uuid, ${name}) RETURNING id
  `)) as unknown as { rows: { id: string }[] };
  return r.rows[0]!.id;
}

describe('the collection gate runs at the ledger, not only in tests', () => {
  let h: Harness;
  let tenant: string;
  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Wiring Test')).id;
  });
  afterEach(async () => h?.close());

  /**
   * This rule existed from phase zero and was enforced nowhere. A connector
   * licensed for Canada could be used to collect in Germany and nothing in the
   * system would have said a word.
   */
  it('refuses a connector collecting outside the jurisdiction it is licensed for', async () => {
    // The directory connector declares CA, US, GB, EU and AU. Japan is plainly
    // outside that, and nothing in the system checked before this wiring.
    await expectBlocked(
      h.app.withTenant(tenant, async (tx) =>
        new Ledger(tx, { type: 'user', id: 'emil' }).ingest(
          createPublicEvidenceDirectory(), [RECORD],
          { jurisdiction: 'JP', personIdFor: () => undefined })),
      'connector.jurisdiction',
      'a licence is per jurisdiction and nothing checked it before',
    );
  });

  it('allows the same connector inside its licence', async () => {
    const out = await h.app.withTenant(tenant, async (tx) =>
      new Ledger(tx, { type: 'user', id: 'emil' }).ingest(
        createPublicEvidenceDirectory(), [RECORD],
        { jurisdiction: 'CA', personIdFor: () => undefined }));
    expect(out.evidenceIds).toHaveLength(1);
  });

  /**
   * The persistence rule says a manual entry surface reaches the ledger "only
   * through a human". Wiring the gate showed it blocking that very path, so it
   * now declares that `recruiter_entered` collection is the route it leaves open.
   */
  it('still admits a named human typing what they read on their own seat', async () => {
    const attributeId = await h.app.withTenant(tenant, async (tx) => {
      const personId = await person(tx, tenant);
      return new Ledger(tx, { type: 'user', id: 'emil' }).recordManualEntry(
        recruiterManualEntry,
        { personId, key: 'current_title', value: 'VP Engineering', observedAt: START },
        { jurisdiction: 'CA' },
      );
    });
    expect(attributeId).toBeTruthy();
  });

  it('writes the decision to the audit trail whichever way it goes', async () => {
    const rows = await h.app.withTenant(tenant, async (tx) => {
      await new Ledger(tx, { type: 'user', id: 'emil' }).ingest(
        createPublicEvidenceDirectory(), [RECORD],
        { jurisdiction: 'CA', personIdFor: () => undefined });
      const r = (await tx.execute(sql`
        SELECT action, detail FROM audit_log WHERE action LIKE 'policy.%' ORDER BY id
      `)) as unknown as { rows: { action: string; detail: { allowed: boolean } }[] };
      return r.rows;
    });
    // "On what basis did you proceed" is the question, and an audit trail that
    // holds only refusals cannot answer it.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.action).toBe('policy.collection');
    expect(rows[0]!.detail.allowed).toBe(true);
  });
});

describe('the enrichment gate classifies, it does not ask', () => {
  let h: Harness;
  let tenant: string;
  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Sensitivity Test')).id;
  });
  afterEach(async () => h?.close());

  const write = async (key: string, sensitive?: boolean) =>
    h.app.withTenant(tenant, async (tx) => {
      const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
      const sourceId = await ledger.registerSource(recruiterManualEntry);
      const evidenceId = await ledger.recordEvidence({
        sourceId, collectionMethod: 'recruiter_entered', collectedAt: START,
        lawfulBasis: 'legitimate_interest', jurisdiction: 'CA', confidence: 0.9,
      });
      const personId = await person(tx, tenant);
      await ledger.recordAttribute({
        personId, key, value: 'x', evidenceId,
        ...(sensitive === undefined ? {} : { sensitive }),
      });
      const r = (await tx.execute(sql`
        SELECT (SELECT count(*)::int FROM attributes WHERE key = ${key}) AS ordinary,
               (SELECT count(*)::int FROM sensitive_attributes WHERE key = ${key}) AS quarantined
      `)) as unknown as { rows: { ordinary: number; quarantined: number }[] };
      return r.rows[0]!;
    });

  it('knows a protected ground when it sees one, whatever the caller says', () => {
    for (const key of ['date_of_birth', 'dateOfBirth', 'Date Of Birth', 'ethnicity', 'disability_status',
                       'marital_status', 'criminal_record', 'citizenship', 'salary_history']) {
      expect(classify(key).sensitive, key).toBe(true);
    }
    for (const key of ['current_title', 'employer', 'city', 'github_url', 'years_experience']) {
      expect(classify(key).sensitive, key).toBe(false);
    }
  });

  /** The control this replaces was a boolean the caller supplied. */
  it('refuses a caller that submits a protected ground as ordinary', async () => {
    await expectBlocked(
      write('date_of_birth', false),
      'sensitive.quarantine',
      'a caller passing sensitive:false for a date of birth used to defeat this entirely',
    );
  });

  it('refuses it just as firmly when the caller says nothing at all', async () => {
    const v = await expectBlocked(
      write('ethnicity'),
      'sensitive.quarantine',
      'silence is the commonest way a sensitive attribute arrives',
    );
    expect(v.message).toMatch(/race, ethnicity or Indigenous identity/);
  });

  it('quarantines a protected ground the caller correctly declared', async () => {
    const counts = await write('date_of_birth', true);
    expect(counts).toEqual({ ordinary: 0, quarantined: 1 });
  });

  it('lets an ordinary attribute through to the ordinary table', async () => {
    expect(await write('current_title')).toEqual({ ordinary: 1, quarantined: 0 });
  });

  /** The list is a floor, not a ceiling: a recruiter who knows better is right. */
  it('honours a caller who declares something the list does not recognise', async () => {
    expect(await write('call_notes', true)).toEqual({ ordinary: 0, quarantined: 1 });
  });
});

describe('the send gate runs before a draft reaches the queue', () => {
  let h: Harness;
  let tenant: string;
  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Send Gate Test')).id;
  });
  afterEach(async () => h?.close());

  async function scaffold(tx: Tx, opts: { consent: boolean; suppress?: string } = { consent: true }) {
    const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
    const sourceId = await ledger.registerSource(recruiterManualEntry);
    const citation = 'https://example.org/kubecon-2026-talk';
    const evidenceId = await ledger.recordEvidence({
      sourceId, collectionMethod: 'public_evidence', collectedAt: START,
      lawfulBasis: 'publicly_available_exemption', jurisdiction: 'CA', confidence: 0.8, citation,
    });
    const one = (r: unknown) => (r as { rows: { id: string }[] }).rows[0]!.id;
    const mandateId = one(await tx.execute(sql`
      INSERT INTO mandates (tenant_id, title, segment, function_domain, status, created_by, confirmed_by, confirmed_at)
      VALUES (${tenant}::uuid, 'VP Engineering', 'senior_executive', 'Engineering', 'live', 'emil', 'emil', now())
      RETURNING id`));
    const personId = await person(tx, tenant);
    if (opts.consent) {
      await ledger.recordConsent({
        personId, basis: 'implied_conspicuous_publication', capturedAt: START, evidenceId,
        conspicuousPublication: {
          publishedBySubject: true, noRefusalNotice: true, relevantToRole: true, sourceUrl: citation,
        },
      });
    }
    if (opts.suppress) {
      await tx.execute(sql`
        INSERT INTO suppressions (tenant_id, subject_hash, reason)
        VALUES (${tenant}::uuid, ${opts.suppress}, 'asked to be forgotten')`);
    }
    const prospectId = one(await tx.execute(sql`
      INSERT INTO prospects (tenant_id, mandate_id, person_id)
      VALUES (${tenant}::uuid, ${mandateId}::uuid, ${personId}::uuid) RETURNING id`));
    return { personId, prospectId, evidenceId, citation };
  }

  const hooksFor = (code: string, evidenceId: string, citation: string) =>
    (MESSAGE_TEMPLATES.find((t) => t.code === code)?.hookTokens ?? []).map((token) => ({
      token, evidenceId, citation, value: 'their KubeCon talk on multi-cluster failover',
    }));

  async function queue(tx: Tx, built: Awaited<ReturnType<typeof scaffold>>, touch: number, body: string) {
    const svc = new EngagementService(tx, tenant, { id: 'emil' });
    const { sequenceId } = await svc.startSequence({
      prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
    });
    const step = ((await tx.execute(sql`
      SELECT id, template_code FROM sequence_steps
       WHERE sequence_id = ${sequenceId}::uuid AND touch = ${touch}`)) as unknown as
      { rows: { id: string; template_code: string }[] }).rows[0]!;
    return svc.queueMessage({
      sequenceStepId: step.id, body,
      hooks: hooksFor(step.template_code, built.evidenceId, built.citation),
      evidence: new Map<string, EvidenceFact>([[built.evidenceId, {
        id: built.evidenceId, live: true, aboutThisPerson: true, citation: built.citation,
      }]]),
    });
  }

  const GOOD = 'Hi, your KubeCon talk stood out. Emil Simms, CDW Canada Consulting Services.';

  /**
   * CASL puts the burden of proving consent on the sender. Wiring the gate made
   * this bind for the first time, and it immediately blocked every email draft
   * to a prospect with no recorded basis. That is the rule working.
   */
  it('refuses an email draft to someone with no recorded consent basis', async () => {
    await expectBlocked(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, { consent: false });
        return queue(tx, built, 2, GOOD);
      }),
      'send.consent_basis',
      'the burden of proving consent is on the sender',
    );
  });

  it('allows the same draft once the basis is on record', async () => {
    const out = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, { consent: true });
      return queue(tx, built, 2, GOOD);
    });
    expect(out.messageId).toBeTruthy();
  });

  /** Forgetting must hold across channels, not only the one they replied on. */
  it('refuses any draft to a person suppressed on any identifier they hold', async () => {
    await expectBlocked(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, { consent: true });
        const hash = ((await tx.execute(sql`
          SELECT encode(sha256(convert_to('person:' || ${built.personId}::text, 'UTF8')), 'hex') AS h
        `)) as unknown as { rows: { h: string }[] }).rows[0]!.h;
        await tx.execute(sql`
          INSERT INTO suppressions (tenant_id, subject_hash, reason)
          VALUES (${tenant}::uuid, ${hash}, 'asked to be forgotten')`);
        return queue(tx, built, 1, GOOD);
      }),
      'send.suppression',
      'a suppression keyed to one identifier must stop contact on all of them',
    );
  });

  it('refuses a draft that never says who wrote it', async () => {
    await expectBlocked(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, { consent: true });
        return queue(tx, built, 1, 'Hi, your KubeCon talk stood out. [Your name]');
      }),
      'send.identifies_sender',
      'a message going out with an unfilled signature token is the failure that matters',
    );
  });

  it('refuses a draft that quotes money, which no state of the mandate permits', async () => {
    await expectBlocked(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, { consent: true });
        return queue(tx, built, 1, 'Hi, your KubeCon talk stood out. The base is $210,000. Emil Simms.');
      }),
      'send.no_compensation_in_outreach',
      'pay is raised once the conversation has earned it',
    );
  });

  /**
   * The mailing address and unsubscribe are added by the sending layer, so they
   * bind at send and not at draft. Running them here would block every draft
   * forever and teach a recruiter to ignore the gate.
   */
  it('does not hold a draft to the elements the sending layer adds', async () => {
    const out = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, { consent: true });
      return queue(tx, built, 2, GOOD);
    });
    expect(out.messageId).toBeTruthy();
  });

  it('records the send decision against the person', async () => {
    const detail = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, { consent: true });
      await queue(tx, built, 1, GOOD);
      const r = (await tx.execute(sql`
        SELECT detail FROM audit_log WHERE action = 'policy.send' ORDER BY id DESC LIMIT 1
      `)) as unknown as { rows: { detail: { allowed: boolean; reasons: { rule: string }[] } }[] };
      return r.rows[0]!.detail;
    });
    expect(detail.allowed).toBe(true);
    expect(detail.reasons.map((r) => r.rule)).toContain('send.personalisation_gate');
  });
});
