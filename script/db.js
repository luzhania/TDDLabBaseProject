// db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config(); // <-- esto carga tu .env

const uri = process.env.MONGO_URI;
export const client = new MongoClient(uri);

let dbInstance = null;

export async function getDb() {
  if (!dbInstance) {
    await client.connect();
    dbInstance = client.db("tdd_learning");
    console.log("✅ Conectado a MongoDB");
  }
  return dbInstance;
}