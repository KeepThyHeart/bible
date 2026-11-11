/**
 * The book name to use in a reference to one chapter or verse: "Psalm 23", not
 * "Psalms 23". Book names come from the server in English and no singular form
 * exists in the catalogs, so only the exact English "Psalms" is mapped; other
 * names and languages are returned unchanged.
 */
export function refBookName<T extends string | undefined | null>(name: T): T | 'Psalm' {
  return name === 'Psalms' ? 'Psalm' : name;
}
