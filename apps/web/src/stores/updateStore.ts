import { Store } from './Store';

/**
 * Whether a newer app version has been activated behind the running page.
 *
 * Only ever set when the deployment's update mode is `prompt`; in `silent` mode
 * `appUpdate.ts` reloads by itself and nothing needs to be shown.
 */
class UpdateStore extends Store {
  available = false;

  setAvailable(value: boolean): void {
    if (this.available === value) return;
    this.available = value;
    this.notify();
  }
}

export const updateStore = new UpdateStore();
