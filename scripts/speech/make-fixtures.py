#!/usr/bin/env python3
"""Generate the speech test fixtures with the OS espeak-ng library (no CLI needed).

Needs libespeak-ng (Debian: `apt install libespeak-ng1`) and ffmpeg on PATH (or FFMPEG=...).
Writes packages/speech/test/fixtures/*.wav (16 kHz mono s16) and fixtures.json.
Real recordings can replace these: keep the same fixtures.json shape.
"""
import ctypes, json, os, shutil, subprocess, sys, wave, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'packages', 'speech', 'test', 'fixtures')

PASSAGES = {
    'john-3-16': ('John 3:16', 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
                  'For God so loved the world, that whosoever believeth in him should not perish, but have everlasting life.',
                  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not die, but have eternal joy.'),
    'psalm-23-1-3': ('Psalm 23:1-3', 'The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths of righteousness for his name\'s sake.',
                     'The LORD is my shepherd; I shall not want. He restoreth my soul: he leadeth me in the paths of righteousness for his name\'s sake.',
                     'The LORD is my shepherd; I shall not fear. He maketh me to lie down in green meadows: he leadeth me beside the quiet streams. He restoreth my soul: he leadeth me in the paths of righteousness for his name\'s sake.'),
    'romans-8-28': ('Romans 8:28', 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.',
                    'And we know that all things work together for good to them who are the called according to his purpose.',
                    'And we know that all things work together for evil to them that hate God, to them who are the called according to his purpose.'),
    'genesis-1-1-3': ('Genesis 1:1-3', 'In the beginning God created the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters. And God said, Let there be light: and there was light.',
                      'In the beginning God created the heaven and the earth. And God said, Let there be light: and there was light.',
                      'In the beginning God made the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the sea. And the Spirit of God moved upon the face of the waters. And God said, Let there be light: and there was light.'),
    '1-john-1-9': ('1 John 1:9', 'If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness.',
                   'If we confess our sins, he is faithful and just to cleanse us from all unrighteousness.',
                   'If we confess our sins, he is faithful and kind to forgive us our sins, and to cleanse us from all wickedness.'),
}
VOICES = {'a': 'en-us', 'b': 'en-gb+f3'}

lib = ctypes.CDLL('libespeak-ng.so.1')
chunks = []
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
def _cb(wav, n, ev):
    if wav and n > 0:
        chunks.append(ctypes.string_at(wav, n * 2))
    return 0
cb = CB(_cb)
rate = lib.espeak_Initialize(1, 0, None, 0)  # AUDIO_OUTPUT_SYNCHRONOUS
lib.espeak_SetSynthCallback(cb)

def synth(text, voice, path22):
    chunks.clear()
    lib.espeak_SetVoiceByName(voice.encode())
    lib.espeak_SetParameter(1, int(os.environ.get("ESPEAK_WPM", "125")), 0)  # rate wpm
    b = text.encode()
    lib.espeak_Synth(b, len(b) + 1, 0, 0, 0, 1, None, None)  # espeakCHARS_UTF8
    lib.espeak_Synchronize()
    with wave.open(path22, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(chunks))

ffmpeg = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
if not ffmpeg:
    sys.exit('ffmpeg not found')
os.makedirs(OUT, exist_ok=True)
manifest = []
with tempfile.TemporaryDirectory() as tmp:
    for slug, (ref, correct, skip, swap) in PASSAGES.items():
        for vkey, voice in VOICES.items():
            for kind, text in (('correct', correct), ('skip', skip), ('swap', swap)):
                if vkey == 'b' and kind != 'correct':
                    continue  # incorrect variants: first voice only (keeps the repo small)
                name = f'{slug}.{vkey}.{kind}.wav'
                t = os.path.join(tmp, name)
                synth(text, voice, t)
                subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', t, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', os.path.join(OUT, name)], check=True)
                manifest.append({'file': name, 'ref': ref, 'voice': voice, 'text': text, 'kind': kind,
                                 'expected': correct})
with open(os.path.join(OUT, 'fixtures.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print(len(manifest), 'fixtures written to', OUT)
