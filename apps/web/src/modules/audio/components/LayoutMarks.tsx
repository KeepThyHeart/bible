/**
 * The audio UI is laid out per form factor (`audioStore.layout`): the desktop transport bar docks
 * under the toolbar, the phone has a full-screen player and a mini-player. These render nothing; mounted by
 * the Study layout they belong to (`studyLayoutItems`), they tell the store which one is showing.
 */
import { useEffect } from 'preact/hooks';
import { audioStore } from '../audioStore';

export function DesktopLayoutMark() {
  useEffect(() => { audioStore.setLayout('desktop'); }, []);
  return null;
}

export function PhoneLayoutMark() {
  useEffect(() => { audioStore.setLayout('phone'); }, []);
  return null;
}
