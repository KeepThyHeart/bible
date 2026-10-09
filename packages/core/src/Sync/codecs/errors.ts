/** Thrown by a codec's `decode` for a record whose payload is malformed (hostile or corrupt). Carries no record content. */
export class RecordDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordDecodeError';
  }
}
