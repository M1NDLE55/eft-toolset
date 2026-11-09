/** An error caused by the caller's input. Its message is safe to show to the caller. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
