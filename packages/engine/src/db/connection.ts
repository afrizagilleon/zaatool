import pg from "pg";

const { Pool } = pg;

// OID 1114: TIMESTAMP WITHOUT TIME ZONE
// Parse as UTC by appending 'Z' to avoid Node process local timezone offset shift
pg.types.setTypeParser(1114, (strVal) => {
  return new Date(strVal.replace(" ", "T") + "Z");
});

export const pool = new Pool({
  user: process.env.POSTGRES_USER || "zaa_user",
  password: process.env.POSTGRES_PASSWORD || "zaa_password",
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number.parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "zaa_tool",
});

/**
 * The listener that keeps a database restart from being an engine restart.
 *
 * `Pool` emits `'error'` when a client dies while idle — nobody is awaiting it, so there
 * is no promise to reject and the event is all there is. An `EventEmitter` with no
 * `'error'` listener rethrows, uncaught, and Node ends the process. That is why stopping
 * postgres used to kill the engine outright instead of failing the next request.
 *
 * Logging is the whole handler on purpose. `Pool` opens a fresh client for the next query
 * by itself, so a retry loop here would duplicate what it already does and hide the
 * outage while doing it.
 */
pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err);
});
