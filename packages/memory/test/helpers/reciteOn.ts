// Existing recite / hands-free tests exercise the engine, which ships behind
// the RECITE_ENABLED flag (src/core/features.ts, off for 1.0). Turn it on here;
// reciteHidden.test.ts turns it off to check the 1.0 behaviour.
import { setReciteEnabledForTests } from '../../src/core/features';

setReciteEnabledForTests(true);
