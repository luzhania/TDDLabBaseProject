import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

console.log("🔍 DATABASE_URL:", process.env.DATABASE_URL); // <-- debug temporal

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // obligatorio en Neon
  },
});

export default pool;