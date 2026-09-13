export * from './types';
export { SIGNAL_TYPE_SEED } from './signal-types';
export { SCORE_MODEL_V1, assertModelIsCoherent } from './scoring-model';
export { scoreProspect, evaluateStacking, deriveSignalFactor, type ScoreInput } from './scoring';
export { ReceptivityService, seedSignalTypes, installScoreModel } from './service';
