/** Sync/password.ts: lazy zxcvbn-ts estimator and email-derived user inputs. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { emailUserInputs, passwordStrength } from '../../../Sync/password';

describe('passwordStrength', () => {
  it('scores common passwords low with feedback keys, passphrases high', async () => {
    const weak = await passwordStrength('password1');
    expect(weak.score).toBeLessThan(2);
    expect(weak.feedback).toContain('common');
    const strong = await passwordStrength('correct horse battery staple glow');
    expect(strong.score).toBe(4);
  });

  it('penalises user inputs', async () => {
    const pw = 'alicereader2024';
    const plain = await passwordStrength(pw);
    const withEmail = await passwordStrength(pw, emailUserInputs('Alice.Reader@Example.org'));
    expect(withEmail.score).toBeLessThan(plain.score);
    expect(withEmail.feedback).toContain('userInputs');
  });

  it('module source loads zxcvbn-ts only through dynamic import', () => {
    const src = readFileSync(join(__dirname, '../../../Sync/password.ts'), 'utf8');
    expect(src).not.toMatch(/^import .*@zxcvbn-ts/m);
    expect(src).toMatch(/import\('@zxcvbn-ts\/core'\)/);
  });
});

describe('emailUserInputs', () => {
  it('splits the address into words', () => {
    expect(emailUserInputs(' Alice.Reader+bible@Mail.Example.org ')).toEqual([
      'alice.reader+bible@mail.example.org', 'alice.reader+bible', 'alicereaderbible', 'alice', 'reader', 'bible',
      'mail', 'example',
    ]);
    expect(emailUserInputs('')).toEqual([]);
  });
});
