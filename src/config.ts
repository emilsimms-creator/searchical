import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url().optional(),
  DATABASE_APP_ROLE: z.string().default('searchical_app'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof Env>;

export const config: Config = Env.parse(process.env);
