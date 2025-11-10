// db.js
import { MongoClient } from "mongodb";

dotenv.config(); // <-- esto carga tu .env

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let dbInstance = null;

export async function getDb() {
  if (!dbInstance) {
    await client.connect();
    dbInstance = client.db("tdd_learning");
    console.log("✅ Conectado a MongoDB");
  }
  return dbInstance;
}