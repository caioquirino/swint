/** A conditional write failed because the record changed (or did not exist) since it was read. */
export class StaleWriteError extends Error {
  constructor(message = 'Record changed since it was read') {
    super(message);
    this.name = 'StaleWriteError';
  }
}
