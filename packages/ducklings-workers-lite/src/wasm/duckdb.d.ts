import type { EmscriptenModule } from '../../../ducklings-workers-shared/src/index';

declare const factory: (
  config: Record<string, unknown>,
) => Promise<EmscriptenModule>;

export default factory;
