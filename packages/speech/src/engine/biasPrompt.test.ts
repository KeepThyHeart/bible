import { promptFor } from './biasPrompt';

describe('promptFor', () => {
  it('is empty without bias, phrases or at level none', () => {
    expect(promptFor()).toBe('');
    expect(promptFor({ phrases: [] })).toBe('');
    expect(promptFor({ phrases: ['Nicodemus'], level: 'none' })).toBe('');
  });
  it('joins phrases in order and de-duplicates case-insensitively', () => {
    expect(promptFor({ phrases: ['Nicodemus', ' begotten ', 'nicodemus', '', 'Capernaum'], level: 'names' })).toBe(
      'Nicodemus, begotten, Capernaum',
    );
  });
});
