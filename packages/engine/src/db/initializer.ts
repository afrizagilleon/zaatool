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
