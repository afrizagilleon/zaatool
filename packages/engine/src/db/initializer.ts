import { pool } from "./connection.js";

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Flow storage
    await client.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        graph_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

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

    await client.query(`
      CREATE INDEX IF NOT EXISTS notebook_runs_notebook_started_idx
      ON notebook_runs (notebook_id, started_at DESC);
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

    // Triggers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS triggers (
        id VARCHAR(255) PRIMARY KEY,
        flow_id VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        config TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add dashboard_layout column to flows table
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE flows ADD COLUMN dashboard_layout TEXT;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Add dashboard_password columns to flows table
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE flows ADD COLUMN dashboard_password_hash TEXT;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE flows ADD COLUMN dashboard_password_lock_until TIMESTAMP;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE flows ADD COLUMN dashboard_password_failed_attempts INTEGER DEFAULT 0;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
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

    // Add is_published column to flows table
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE flows ADD COLUMN is_published BOOLEAN DEFAULT TRUE;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

    // Add share_slug column to flows table
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE flows ADD COLUMN share_slug VARCHAR(255) UNIQUE;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);

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
