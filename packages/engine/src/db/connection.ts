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
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "zaa_tool",
});

