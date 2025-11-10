import fs from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const HEAD_MARKER = "HEAD";

// Configuración de MongoDB
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "tdd_tracking";

const client = new MongoClient(MONGO_URI);

async function connectDB() {
  await client.connect();
  return client.db(DB_NAME);
}

// Obtener información del commit
function getCommitInfo(sha) {
  let commitMessage, commitDate, author;
  const isHeadCommit = sha === HEAD_MARKER;
  const gitSha = isHeadCommit ? "HEAD" : sha;

  try {
    commitMessage = execSync(`git log -1 --pretty=%B ${gitSha}`).toString().trim();
    commitDate = new Date(execSync(`git log -1 --format=%cd ${gitSha}`).toString()).toISOString();
    author = execSync(`git log -1 --pretty=format:%an ${gitSha}`).toString().trim();
  } catch (error) {
    console.error(`Error al obtener información del commit ${gitSha}:`, error);
    return null;
  }

  let repoUrl = "";
  try {
    repoUrl = execSync("git config --get remote.origin.url").toString().trim().replace(/\.git$/, "");
    if (repoUrl.startsWith("git@")) {
      repoUrl = repoUrl.replace(/^git@([^:]+):(.+)$/, "https://$1/$2");
    }
  } catch {
    console.warn("No se encontró un repositorio remoto.");
  }

  // Estadísticas de líneas añadidas y eliminadas
  let additions = 0, deletions = 0;
  try {
    const parentRef = `${gitSha}~1`;
    const diffStats = execSync(`git diff --stat ${parentRef} ${gitSha}`).toString();
    const additionsMatch = diffStats.match(/(\d+) insertion/);
    const deletionsMatch = diffStats.match(/(\d+) deletion/);
    additions = additionsMatch ? parseInt(additionsMatch[1]) : 0;
    deletions = deletionsMatch ? parseInt(deletionsMatch[1]) : 0;
  } catch {}

  // Resultados de tests con Jest
  let testCount = 0, coverage = 0, failedTests = 0, conclusion = "neutral";
  if (fs.existsSync("package.json")) {
    const tempDir = tmpdir();
    const randomId = crypto.randomBytes(8).toString("hex");
    const outputPath = path.join(tempDir, `jest-results-${randomId}.json`);
    try {
      execSync(`npx jest --coverage --json --outputFile=${outputPath} --passWithNoTests`, { stdio: "pipe" });
    } catch {}
    if (fs.existsSync(outputPath)) {
      const jestResults = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      testCount = jestResults.numTotalTests || 0;
      failedTests = jestResults.numFailedTests || 0;

      if (jestResults.coverageMap) {
        let covered = 0, total = 0;
        for (const file of Object.values(jestResults.coverageMap)) {
          const s = file.s;
          total += Object.keys(s).length;
          covered += Object.values(s).filter(v => v > 0).length;
        }
        coverage = total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;
      }

      if (testCount > 0) conclusion = failedTests > 0 ? "failure" : "success";

      try { fs.unlinkSync(outputPath); } catch {}
    }
  }

  return {
    sha: isHeadCommit ? HEAD_MARKER : sha,
    author,
    commit: {
      date: commitDate,
      message: commitMessage,
      url: !isHeadCommit ? `${repoUrl}/commit/${sha}` : `${repoUrl}/commit/HEAD`,
    },
    stats: { total: additions + deletions, additions, deletions, date: commitDate.split("T")[0] },
    coverage,
    test_count: testCount,
    failed_tests: failedTests,
    conclusion
  };
}

// Guardar commit en MongoDB
async function saveCommitToDB(commitData, branchName = "main") {
  const db = await connectDB();

  // Crear o recuperar desarrollador
  let author = await db.collection("developers").findOne({ full_name: commitData.author });
  if (!author) {
    const result = await db.collection("developers").insertOne({ full_name: commitData.author });
    author = { _id: result.insertedId };
  }

  // Crear o recuperar repo
  const repoUrl = commitData.commit.url.split("/commit/")[0];
  let repo = await db.collection("repositories").findOne({ url: repoUrl });
  if (!repo) {
    const result = await db.collection("repositories").insertOne({ name: repoUrl.split("/").pop(), url: repoUrl });
    repo = { _id: result.insertedId };
  }

  // Crear o recuperar branch
  let branch = await db.collection("branches").findOne({ repository_id: repo._id, name: branchName });
  if (!branch) {
    const result = await db.collection("branches").insertOne({ repository_id: repo._id, name: branchName, last_commit_sha: commitData.sha });
    branch = { _id: result.insertedId };
  } else {
    await db.collection("branches").updateOne({ _id: branch._id }, { $set: { last_commit_sha: commitData.sha } });
  }

  // Guardar commit
  const existing = await db.collection("commits").findOne({ sha: commitData.sha, branch_id: branch._id });
  if (!existing) {
    await db.collection("commits").insertOne({
      sha: commitData.sha,
      branch_id: branch._id,
      author_id: author._id,
      message: commitData.commit.message,
      url: commitData.commit.url,
      timestamp: new Date(commitData.commit.date),
      stats: commitData.stats,
      coverage: commitData.coverage,
      test_count: commitData.test_count,
      failed_tests: commitData.failed_tests,
      conclusion: commitData.conclusion
    });
  } else {
    await db.collection("commits").updateOne({ _id: existing._id }, { $set: {
      stats: commitData.stats,
      coverage: commitData.coverage,
      test_count: commitData.test_count,
      failed_tests: commitData.failed_tests,
      conclusion: commitData.conclusion
    }});
  }

  console.log(`Commit ${commitData.sha} guardado en MongoDB.`);
}

// Ejecutar
(async () => {
  try {
    const commitData = getCommitInfo(HEAD_MARKER);
    if (commitData) {
      await saveCommitToDB(commitData);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
})();
