import fs from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import { getDb, client } from "./db.js"; // conexión Mongo (ver más abajo)

// ===================
// CONFIGURACIÓN BASE
// ===================
const HEAD_MARKER = "HEAD";

async function getBranchName() {
  return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
}

async function getRepoName() {
  const url = execSync("git config --get remote.origin.url")
    .toString()
    .trim()
    .replace(/\.git$/, "");
  return path.basename(url);
}

// ===================
// CAPTURAR COMMIT
// ===================
function getCommitInfo(sha) {
  const isHeadCommit = sha === HEAD_MARKER;
  const gitSha = isHeadCommit ? "HEAD" : sha;

  let commitMessage, commitDate, author;
  try {
    commitMessage = execSync(`git log -1 --pretty=%B ${gitSha}`)
      .toString()
      .trim();
    commitDate = new Date(
      execSync(`git log -1 --format=%cd ${gitSha}`).toString()
    ).toISOString();
    author = execSync(`git log -1 --pretty=format:%an ${gitSha}`)
      .toString()
      .trim();
  } catch (error) {
    console.error(`❌ Error obteniendo info de commit ${gitSha}:`, error);
    return null;
  }

  let repoUrl = "";
  try {
    repoUrl = execSync("git config --get remote.origin.url")
      .toString()
      .trim()
      .replace(/\.git$/, "");
    if (repoUrl.startsWith("git@")) {
      repoUrl = repoUrl.replace(/^git@([^:]+):(.+)$/, "https://$1/$2");
    }
  } catch {
    console.warn("⚠️ No se encontró repositorio remoto.");
  }

  // =====================
  // OBTENER ESTADÍSTICAS
  // =====================
  let additions = 0,
    deletions = 0;
  try {
    const parentRef = `${gitSha}~1`;
    const diffStats = execSync(
      `git diff --stat ${parentRef} ${gitSha} -- ":!script/commit-history.json"`
    ).toString();

    const additionsMatch = diffStats.match(/(\d+) insertion/);
    const deletionsMatch = diffStats.match(/(\d+) deletion/);
    additions = additionsMatch ? parseInt(additionsMatch[1]) : 0;
    deletions = deletionsMatch ? parseInt(deletionsMatch[1]) : 0;
  } catch (err) {
    console.warn(`⚠️ No se pudo calcular diff para ${gitSha}: ${err.message}`);
  }

  // =====================
  // RESULTADOS DE TESTS
  // =====================
  let testCount = 0,
    failedTests = 0,
    coverage = 0,
    conclusion = "neutral";

  if (fs.existsSync("package.json")) {
    const tempDir = tmpdir();
    const randomId = crypto.randomBytes(8).toString("hex");
    const outputPath = path.join(tempDir, `jest-results-${randomId}.json`);

    try {
      execSync(
        `npx jest --coverage --json --outputFile=${outputPath} --passWithNoTests`,
        { stdio: "pipe" }
      );
      const jestResults = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      testCount = jestResults.numTotalTests || 0;
      failedTests = jestResults.numFailedTests || 0;

      if (jestResults.coverageMap) {
        const coverageMap = jestResults.coverageMap;
        let covered = 0,
          total = 0;
        for (const file of Object.values(coverageMap)) {
          const s = file.s;
          total += Object.keys(s).length;
          covered += Object.values(s).filter((v) => v > 0).length;
        }
        coverage = total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;
      }

      conclusion = testCount > 0 ? (failedTests > 0 ? "failure" : "success") : "neutral";
      fs.unlinkSync(outputPath);
    } catch (err) {
      console.warn("⚠️ Error ejecutando Jest:", err.message);
    }
  }

  return {
    sha: isHeadCommit ? HEAD_MARKER : sha,
    author,
    commit: {
      date: commitDate,
      message: commitMessage,
      url: `${repoUrl}/commit/${gitSha}`,
    },
    stats: {
      total: additions + deletions,
      additions,
      deletions,
      date: commitDate.split("T")[0],
    },
    coverage,
    test_count: testCount,
    failed_tests: failedTests,
    conclusion,
  };
}

// ===================
// GUARDAR EN MONGO
// ===================
async function saveCommitToMongo(userId, repoName, branchName, commitData) {
  const db = await getDb();
  const commitsCol = db.collection("commits");
  const branchesCol = db.collection("branches");

  const currentSha =
    commitData.sha === HEAD_MARKER
      ? execSync("git rev-parse HEAD").toString().trim()
      : commitData.sha;

  // Asegurarnos de que el campo sha del documento contiene el SHA real
  // (si venía como HEAD, lo reemplazamos por el SHA resuelto)
  commitData.sha = currentSha;

  // Insertar o actualizar commit
  await commitsCol.updateOne(
    { _id: currentSha },
    {
      $set: {
        ...commitData,
        _id: currentSha,
      },
    },
    { upsert: true }
  );

  // Actualizar rama (añadir commit si no está)
  await branchesCol.updateOne(
    { user_id: userId, repo_name: repoName, branch_name: branchName },
    {
      $addToSet: { commits: currentSha },
      $set: { last_commit: currentSha, updated_at: new Date() },
    },
    { upsert: true }
  );

  console.log(`✅ Commit ${currentSha} guardado en rama ${branchName}`);
}

// ===================
// MAIN EXECUTION
// ===================
(async () => {
  try {
    const userId = "usuario_demo_2";
    const repoName = await getRepoName();
    const branchName = await getBranchName();

    const currentCommitData = getCommitInfo(HEAD_MARKER);
    if (currentCommitData) {
      await saveCommitToMongo(userId, repoName, branchName, currentCommitData);
    }

    await client.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en el script:", err);
    await client.close();
    process.exit(1);
  }
})();