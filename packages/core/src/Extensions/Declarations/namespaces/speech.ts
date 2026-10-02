/**
 * `api.speech` - listen and speak (task 0071). Methods only, no events.
 */

import type { ISpeechApi } from '../../../speech/apiTypes';
import { defineApiNamespace } from '../defineApiNamespace';

export const speechNamespace = defineApiNamespace<ISpeechApi>()({
  name: 'speech',
  description: 'Listen to the microphone (transcripts only, never audio) and speak text aloud.',
  since: '0.2.0',
  optional: true,
  permissions: [
    {
      id: 'speech:listen',
      // The microphone: a focused decision rather than a buried checkbox.
      grant: 'separate',
      consent: {
        key: 'extensionConsent.permission.speechListen',
        text: 'Listen to your microphone while you recite. Audio stays on this device.',
      },
      since: '0.2.0',
    },
    {
      id: 'speech:speak',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.speechSpeak',
        text: 'Speak text aloud and play short sounds.',
      },
      since: '0.2.0',
    },
  ],
  methods: {
    // Ungated: reports what is granted and available.
    status: { permission: null },
    speak: { permission: 'speech:speak' },
    earcon: { permission: 'speech:speak' },
    startListening: { permission: 'speech:listen' },
    nextUtterance: { permission: 'speech:listen' },
    stopListening: { permission: 'speech:listen' },
    // Ungated: stopping speech or listening never needs a grant.
    cancel: { permission: null },
  },
});
