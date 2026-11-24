import { GAME_MATCHES } from '@/core/messages';
import { applyMobileSpoof } from '@/core/spoof/mobile';

export default defineContentScript({
  matches: GAME_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  registration: 'runtime',
  main() {
    applyMobileSpoof(window);
  },
});
