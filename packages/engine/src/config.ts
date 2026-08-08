/**
 * What the environment is allowed to decide, and what it must decide.
 *
 * Two rules hold this file together:
 *
 *  - **A default may be convenient, never a secret.** `JWT_SECRET` had a fallback written
 *    into the repository, which meant every checkout of this project could mint a valid
 *    session for every deployment of it. A development fallback is fine; carrying it into
 *    production is not, so production refuses to start instead.
 *  - **The permissive setting is the one you have to ask for.** Registration defaults to
 *    closed. A machine that is reachable from the internet before anyone has read this
 *    file should not be handing out accounts.
 *
 * Read at call time rather than frozen at import, so a test can set a variable and a
 * script can run under different settings without reloading modules.
 */

/** Obvious on sight, and long enough that nothing accidentally depends on its shape. */
const DEV_JWT_SECRET = "zaatool-development-secret-do-not-deploy";

/** Shortest secret worth having. 32 bytes of anything unguessable clears it. */
const MIN_SECRET_LENGTH = 32;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The key behind sessions, share links and storage signatures.
 *
 * One secret with three uses, separated by {@link signingKey}'s label rather than by
 * three variables to lose.
 */
export function jwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || DEV_JWT_SECRET;
}

export function usingDevSecret(): boolean {
  return jwtSecret() === DEV_JWT_SECRET;
}

/**
 * Closed unless told otherwise — with one exception the caller owns: an installation with
 * no users at all always accepts the first one, or there would be no way in.
 */
export function registrationOpen(): boolean {
  return (process.env.ALLOW_REGISTRATION ?? "").trim().toLowerCase() === "true";
}

/** Bytes. A limit that exists is the point; the number is a preference. */
export function maxUploadBytes(): number {
  const raw = Number(process.env.MAX_UPLOAD_MB);
  const megabytes = Number.isFinite(raw) && raw > 0 ? raw : 25;
  return Math.floor(megabytes * 1024 * 1024);
}

export function loginRateLimitWindowMs(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000;
}

export function loginRateLimitMax(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}


/**
 * Reasons this process should not be serving traffic.
 *
 * Returns them all rather than the first, so a deployment is fixed in one pass instead of
 * one restart per mistake.
 */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!isProduction()) return problems;

  if (usingDevSecret()) {
    problems.push(
      "JWT_SECRET is not set. In production the engine will not fall back to the " +
        "development secret, because that secret is in the repository — anyone holding a " +
        "copy could sign a session for this machine."
    );
  } else if (jwtSecret().length < MIN_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET is ${jwtSecret().length} characters; ${MIN_SECRET_LENGTH} is the minimum. ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  return problems;
}
