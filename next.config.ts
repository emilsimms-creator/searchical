import type { NextConfig } from 'next';

/**
 * The approval queue runs against the same Postgres the services use, through
 * the same tenant scoped client. `pg` is a native-ish driver and must stay on
 * the server side of the boundary rather than being bundled for the browser.
 */
const config: NextConfig = {
  serverExternalPackages: ['pg', 'pino'],
  typedRoutes: false,
};

export default config;
