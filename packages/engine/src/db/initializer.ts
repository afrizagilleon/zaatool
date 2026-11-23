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

    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebook_versions ADD COLUMN locked_packages TEXT[];
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
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

    // A counter that moves on every save, so two people (or a person and an agent) editing
    // the same notebook cannot silently overwrite each other: a save says which revision it
    // was made from, and one made from an older revision is refused. Existing rows start at 1.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebooks ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // The name the deployed version goes by, kept on the notebook so the database itself can
    // say "no two deployed notebooks share a name" with a unique index — the check made in
    // code reads and then writes, and two deploys in parallel both read "free". Written by
    // `deploy`, cleared by `undeploy` and `delete`. The backfill runs once, with the column.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebooks ADD COLUMN deployed_name VARCHAR(255);

        UPDATE notebooks n
        SET deployed_name = v.document::jsonb ->> 'name'
        FROM notebook_versions v
        WHERE v.id = n.deployed_version_id;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // An installation that already has two deployed notebooks under one name (the check used
    // to be racy) cannot take a unique index, and a migration must not refuse to start it or
    // delete somebody's notebook to make room. It warns and goes on: `deploy` still checks
    // the name under a lock, and the index appears once someone renames one of the two.
    await client.query(`
      DO $$
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS notebooks_deployed_name_idx
        ON notebooks (deployed_name) WHERE deployed_name IS NOT NULL;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE WARNING 'notebooks_deployed_name_idx not created: two deployed notebooks share a name. Rename one and restart.';
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

    // The id this account's notebooks' cells run under on Linux, handed out the first time
    // one of them runs. Since S-16 it is the owner's *gid* (every cell process has a uid of
    // its own); it was the owner's uid (FX-20), and keeps its name and numbers so an
    // existing installation keeps its owners and their folders. UNIQUE: two owners sharing
    // one would share everything the kernel keeps apart. Null until then, and always null
    // where cells do not change uid.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD COLUMN sandbox_uid INTEGER UNIQUE;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // The highest sandbox id ever handed out, per range. It never goes down: the highest id
    // still on `users` would drop when its account is deleted, and the next owner would then
    // get that id — and every file the old owner's cells left in its home folder.
    await client.query(`
      CREATE TABLE IF NOT EXISTS sandbox_uid_highwater (
        uid_base INTEGER PRIMARY KEY,
        last_uid INTEGER NOT NULL
      );
    `);

    // ── Who owns what (FX17) ─────────────────────────────────────────────────────
    //
    // Each block adds its column and backfills it in the same `DO`, so the backfill runs
    // exactly once, the way `deployed_version_id` does above. Deleting a user takes their
    // grants, secrets and tokens with them; it only *orphans* a notebook and a run, because
    // a notebook without an owner is recoverable (`transfer-owner`) and a deleted one is not.

    // D-1, D-8. The owner is whoever deployed the oldest version, if that account still
    // exists and is a creator; otherwise the first creator; with no creator at all, nobody.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebooks ADD COLUMN owner_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL;

        UPDATE notebooks n
        SET owner_id = COALESCE(
          (SELECT u.id FROM users u
           WHERE u.role = 'creator'
             AND u.username = (
               SELECT v.deployed_by FROM notebook_versions v
               WHERE v.notebook_id = n.id
               ORDER BY v.created_at ASC, v.id ASC
               LIMIT 1
             )),
          (SELECT u.id FROM users u WHERE u.role = 'creator' ORDER BY u.created_at ASC, u.id ASC LIMIT 1)
        );
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // D-4. `all` is what every notebook did before this existed.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebooks ADD COLUMN app_visibility VARCHAR(16) NOT NULL DEFAULT 'all'
          CHECK (app_visibility IN ('all', 'selected'));
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // The people a notebook was shared with, besides its owner: `editor` may change it,
    // `app` may use its deployed page when the notebook's visibility is `selected`.
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebook_access (
        notebook_id VARCHAR(255) NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission VARCHAR(16) NOT NULL CHECK (permission IN ('editor', 'app')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (notebook_id, user_id)
      );
    `);

    // D-6. A secret belongs to the account that made it. Before this every creator could
    // use every secret, so each existing one is copied to every creator: nobody gains
    // access and no deployed notebook loses a secret it was running with. The originals
    // are removed once copied — left behind they would be plaintext nobody can reach — but
    // only when there was a creator to copy them to, so an installation with none loses
    // nothing.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE secrets ADD COLUMN owner_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE secrets DROP CONSTRAINT IF EXISTS secrets_key_key;

        INSERT INTO secrets (id, key, value, is_secret, created_at, owner_id)
        SELECT md5(random()::text || clock_timestamp()::text || s.id || u.id),
               s.key, s.value, s.is_secret, s.created_at, u.id
        FROM secrets s CROSS JOIN users u
        WHERE s.owner_id IS NULL AND u.role = 'creator';

        DELETE FROM secrets s
        WHERE s.owner_id IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.role = 'creator');
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS secrets_owner_key_idx ON secrets (owner_id, key);
    `);

    // D-9. A token acts as the account that made it. Existing ones go to the first creator.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE agent_tokens ADD COLUMN user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE;

        UPDATE agent_tokens
        SET user_id = (SELECT u.id FROM users u WHERE u.role = 'creator' ORDER BY u.created_at ASC, u.id ASC LIMIT 1);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // D-11. Who started a run. NULL for cron, webhooks and share links, which no account
    // started.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebook_runs ADD COLUMN started_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Which share link started a run, so a socket opened with a link can follow only the runs
    // that link started and not any other run of the same notebook. NULL for everything that
    // was not started through a link. Not a foreign key: revoking a link must not rewrite
    // history, and a deleted link's runs should stay readable to the team.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebook_runs ADD COLUMN share_id VARCHAR(255);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // The notebook's declared outputs as the run ended, already redacted. Kept apart from
    // cell_results because it is the only part of a run that somebody who merely uses the
    // notebook (an app user, a share link, a webhook caller) is allowed to read back.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE notebook_runs ADD COLUMN outputs JSONB;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Add token_version to users: every session token carries the number it was minted
    // under, and raising it here is how all of a person's older sessions are ended at once.
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Test fixtures do not belong here, and two of them were briefly written into this
    // function during FX8. `initDb()` runs on every start of every installation: seeding
    // `zz-uji-rekam` and `zz-uji-prosa` from a schema migration put somebody else's test
    // notebooks into every workspace this tool will ever create, forever, with hand-picked
    // ids where every other notebook has a uuid. A fixture is made the way a person makes
    // one — through the API, on the machine that needs it.

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
