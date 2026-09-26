import { create } from 'zustand';

/**
 * The one shared "which ambient popup is open" authority (task 0036, P0.1c;
 * design amendment A6).
 *
 * "Ambient" means hover-driven and non-modal - it opens as the pointer
 * lingers and closes on its own, unlike `ExtensionModal`
 * (`extensionUiStore.ts`), which blocks on an explicit user choice. Before
 * this store existed, every ambient popup in the app ran its own show/hide
 * timing and had no way to know another one had opened, so two could show at
 * once (a Strong's definition AND an extension hover, say) - visually
 * cluttered and, worse, ambiguous about which one the pointer is even over.
 *
 * Usage: a popup owner calls `claim(ownerId)` when it opens (`ownerId` a
 * value stable for that popup INSTANCE, not just its kind - two Study panes
 * each showing their own Strong's tooltip must not steal each other's
 * popup). It then subscribes to `owner` and closes itself the moment `owner`
 * is no longer its own id - that is the entire coordination protocol, no
 * message-passing needed. `release(ownerId)` clears the field, but only if
 * that owner still holds it (so an out-of-order close from a popup that was
 * already pre-empted can't clobber whoever claimed it next).
 */
interface AmbientPopupState {
  owner: string | null;
  claim(ownerId: string): void;
  release(ownerId: string): void;
}

export const useAmbientPopupStore = create<AmbientPopupState>((set, get) => ({
  owner: null,
  claim(ownerId) {
    set({ owner: ownerId });
  },
  release(ownerId) {
    if (get().owner === ownerId) set({ owner: null });
  },
}));
