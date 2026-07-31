import type { D1Database } from './d1-types.js';
import { D1MessageRepository } from './repository.js';
import { PilotService } from './service.js';

export interface Env {
  readonly DB: D1Database;
  readonly ZUNGUN_PILOT_TOKEN: string;
}

export function createPilotService(env: Env): PilotService {
  return new PilotService(new D1MessageRepository(env.DB), env.ZUNGUN_PILOT_TOKEN);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createPilotService(env).handle(request);
  },
};
