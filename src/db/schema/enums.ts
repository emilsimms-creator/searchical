import { pgEnum } from 'drizzle-orm/pg-core';

export const collectionMethod = pgEnum('collection_method', [
  'provider_licensed',
  'public_evidence',
  'recruiter_entered',
  'candidate_provided',
  'inferred',
]);

export const lawfulBasis = pgEnum('lawful_basis', [
  'legitimate_interest',
  'consent',
  'contract',
  'legal_obligation',
  'publicly_available_exemption',
]);

export const subjectType = pgEnum('subject_type', ['person', 'organization']);

export const actorType = pgEnum('actor_type', ['user', 'system', 'connector']);

export const signalCategory = pgEnum('signal_category', [
  'linkedin_platform',
  'linkedin_behaviour',
  'career_stage',
  'employer_trigger',
  'compensation_cycle',
  'personal',
  'personal_brand',
  'engagement_data',
  'relationship',
]);

export const signalStrength = pgEnum('signal_strength', ['low', 'medium', 'medium_high', 'high']);

export const consentBasis = pgEnum('consent_basis', [
  'express',
  'implied_conspicuous_publication',
  'implied_existing_business_relationship',
  'implied_inquiry',
  'implied_non_business_relationship',
]);
