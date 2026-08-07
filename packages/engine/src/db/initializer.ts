import { pool } from "./connection.js";

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Skills
    await client.query(`
      CREATE TABLE IF NOT EXISTS skills (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      DO $$
      BEGIN
        ALTER TABLE skills ADD COLUMN description TEXT;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Secrets & Variables
    await client.query(`
      CREATE TABLE IF NOT EXISTS secrets (
        id VARCHAR(255) PRIMARY KEY,
        key VARCHAR(255) NOT NULL UNIQUE,
        value TEXT NOT NULL,
        is_secret BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Files/Artifacts
    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        path TEXT NOT NULL,
        mime_type VARCHAR(255),
        size_bytes INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Notebooks
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        runtime VARCHAR(20) NOT NULL DEFAULT 'node',
        document TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Deployed snapshots. A notebook's row holds the draft you edit; a version holds
    // what production runs, so editing at 2pm no longer changes what the webhook does
    // at 2:01. Kept as a table rather than a column so a deploy can be rolled back to.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebook_versions (
        id VARCHAR(255) PRIMARY KEY,
        notebook_id VARCHAR(255) NOT NULL,
        document TEXT NOT NULL,
        deployed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS notebook_versions_notebook_idx
      ON notebook_versions (notebook_id, created_at DESC);
    `);

    // Adding the column and backfilling in one block, so the backfill happens exactly
    // once: every notebook that existed before deploys came along keeps running what it
    // was already running. Notebooks made afterwards must be deployed deliberately.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebooks ADD COLUMN deployed_version_id VARCHAR(255);

        INSERT INTO notebook_versions (id, notebook_id, document, deployed_by)
        SELECT md5(random()::text || clock_timestamp()::text), id, document, 'migration'
        FROM notebooks;

        UPDATE notebooks n
        SET deployed_version_id = v.id
        FROM notebook_versions v
        WHERE v.notebook_id = n.id;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Tags, indexed beside the document for the same reason triggers are: the list
    // filters on them, and filtering by parsing twenty-nine documents is a scan. The
    // document stays the source of truth — `save` writes this column from it, so the
    // column can be rebuilt and never has to be believed over the document itself.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebooks ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Notebook triggers, indexed rather than discovered by scanning documents —
    // the scheduler queries this table instead of parsing every notebook each minute.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebook_triggers (
        id VARCHAR(255) PRIMARY KEY,
        notebook_id VARCHAR(255) NOT NULL,
        kind VARCHAR(20) NOT NULL,
        cron VARCHAR(255),
        slug VARCHAR(255) UNIQUE,
        secret_key VARCHAR(255),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS notebook_triggers_notebook_idx
      ON notebook_triggers (notebook_id);
    `);

    // Notebook run history. jsonb rather than the TEXT used by older tables so
    // per-cell results can be written atomically with jsonb_set — parallel lanes
    // finish concurrently within one run, and read-modify-write would lose results.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebook_runs (
        id VARCHAR(255) PRIMARY KEY,
        notebook_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL,
        trigger_source VARCHAR(50) NOT NULL DEFAULT 'manual',
        cell_id VARCHAR(255),
        error TEXT,
        cell_results JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP
      );
    `);

    // A run started by another notebook records who asked for it.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebook_runs ADD COLUMN parent_run_id VARCHAR(255);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS notebook_runs_notebook_started_idx
      ON notebook_runs (notebook_id, started_at DESC);
    `);

    // Agent credentials for MCP — separate from the browser session so one can be
    // revoked without touching the other.
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        id VARCHAR(255) PRIMARY KEY,
        label VARCHAR(255) NOT NULL,
        scope VARCHAR(32) NOT NULL DEFAULT 'reader',
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP
      );
    `);

    // A page handed to someone without an account.
    //
    // The token is the credential, like a webhook's slug, so it is unguessable and
    // hashed at rest — a leaked database row must not become a working link. Revoking
    // is a timestamp rather than a delete, so "who could reach this, and when did it
    // stop" stays answerable.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebook_shares (
        id VARCHAR(255) PRIMARY KEY,
        notebook_id VARCHAR(255) NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(255),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP,
        run_count INTEGER NOT NULL DEFAULT 0,
        revoked_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS notebook_shares_notebook_idx
      ON notebook_shares (notebook_id, created_at DESC);
    `);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add role column to users table
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'viewer';
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Add active column to users table
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);


    // The canvas's tables — `flows` and `triggers` — are no longer created, and nothing
    // reads them. They are deliberately not dropped here: an install that has them holds
    // someone's old work, and a migration that deletes data without being asked is not a
    // migration. Drop them by hand when you are sure:
    //
    //   DROP TABLE IF EXISTS triggers; DROP TABLE IF EXISTS flows;

    await client.query("COMMIT");
    console.log("✅ Database initialized successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Failed to initialize database:", err);
    throw err;
  } finally {
    client.release();
  }
}
