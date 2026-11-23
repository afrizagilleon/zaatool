import pg from "pg";
import { connectionOptions } from "../db/connection.js";
import { LOCK_KEYS } from "../core/advisory-locks.js";

/**
 * A key rotation is under way, so an engine may not start now.
 *
 * Its message says what to do, because the person reading it has just run `docker compose up`.
 */
export class RotationInProgressError extends Error {
  constructor() {
    super(
      "A SECRETS_KEY rotation is in progress, so the engine will not start. Wait for rotate-secrets-key to finish, " +
        "set the new SECRETS_KEY in .env, then start the engine again."
    );
    this.name = "RotationInProgressError";
  }
}

const RETRY_MS = 5000;

/**
 * Makes the engine's being alive visible to the database, for as long as the process lives.
 *
 * Re-encrypting every secret under a new key while an engine is running breaks that engine:
 * it keeps the old key in memory, so every secret it writes afterwards is sealed with a key
 * the database no longer agrees with. Nothing in a rotation can see the engine, but the
 * database can: an engine holds a *shared* advisory lock on a connection of its own, any
 * number of engines may hold it together, and a rotation needs the *exclusive* one, which it
 * cannot have while any engine does. The lock belongs to the connection, so it goes when the
 * process does and nobody has to clean it up.
 *
 * A dropped connection loses the lock, so it is taken again; if a rotation got in during
 * that gap the engine stops, because carrying on would be exactly what the lock prevents.
 */
export async function holdEngineLock(): Promise<void> {
  await acquire(true);
}

async function acquire(first: boolean): Promise<void> {
  const client = new pg.Client(connectionOptions());
  let lost = false;
  const onLost = (reason: string) => {
    if (lost) return;
    lost = true;
    console.error(`The engine's database lock was lost (${reason}); taking it again.`);
    client.end().catch(() => undefined);
    const retry = () => {
      acquire(false).catch(() => setTimeout(retry, RETRY_MS).unref());
    };
    setTimeout(retry, RETRY_MS).unref();
  };
  client.on("error", (err) => onLost(err.message));
  client.on("end", () => onLost("connection closed"));

  await client.connect();
  const { rows } = await client.query<{ got: boolean }>(
    "SELECT pg_try_advisory_lock_shared(hashtextextended($1, 0)) AS got",
    [LOCK_KEYS.engineAlive]
  );
  if (!rows[0]?.got) {
    lost = true;
    await client.end().catch(() => undefined);
    if (first) throw new RotationInProgressError();
    console.error(new RotationInProgressError().message);
    process.exit(1);
  }
}
