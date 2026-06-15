import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  user: process.env.POSTGRES_USER || "zaa_user",
  password: process.env.POSTGRES_PASSWORD || "zaa_password",
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "zaa_tool",
});
