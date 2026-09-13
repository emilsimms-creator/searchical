import type { Connector } from './contract';

export class ConnectorRegistry {
  readonly #byId = new Map<string, Connector>();

  register(connector: Connector): this {
    if (this.#byId.has(connector.id)) {
      throw new Error(`connector already registered: ${connector.id}`);
    }
    this.#byId.set(connector.id, connector);
    return this;
  }

  get(id: string): Connector {
    const found = this.#byId.get(id);
    if (!found) throw new Error(`unknown connector: ${id}`);
    return found;
  }

  all(): readonly Connector[] {
    return [...this.#byId.values()];
  }

  /** Coverage confidence for a region across every registered source. */
  coverageFor(region: string): number {
    const entries = this.all()
      .flatMap((c) => c.coverage.filter((e) => e.region === region))
      .map((e) => e.confidence);
    return entries.length === 0 ? 0 : Math.max(...entries);
  }
}
