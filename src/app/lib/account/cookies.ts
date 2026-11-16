/** The sealed WorkOS session: httpOnly, read only by the account routes. */
export const SESSION_COOKIE = "eft_session";
/** OAuth state for the sign-in in progress. */
export const STATE_COOKIE = "eft_auth_state";
/**
 * Readable hint that this browser has a session, so static pages can show the account state
 * without a request. It carries nothing secret; the account API clears it whenever it finds
 * the session gone.
 */
export const SIGNED_IN_COOKIE = "eft_signed_in";
