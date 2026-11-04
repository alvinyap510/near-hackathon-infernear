/** A failure the UI shows to the user as-is, with a code it can branch on. */
export class DataError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
