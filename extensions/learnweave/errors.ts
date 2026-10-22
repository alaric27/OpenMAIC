/** Errors the agent must resolve by changing its input, rather than blind retries. */
export class ActivityInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
    readonly nextAction = 'Correct the indicated input before calling lw_upsert_activity again. Do not retry unchanged arguments or change activityId to bypass this error.',
  ) {
    super(message);
  }
}
