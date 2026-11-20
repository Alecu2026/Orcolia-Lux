/**
 * pm2:  pm2 start ecosystem.config.js   (prima dată)   |   pm2 status   |   pm2 logs <nume>   |   pm2 save
 *
 * Două aplicații:
 *  1. aplicația Next (un SINGUR proces, fork — intenționat: limitarea cererilor, cache-urile listelor și cronurile din proces (instrumentation.ts)
 *     sunt per proces; în cluster ar rula de mai multe ori);
 *  2. „<nume>-autodeploy”: un proces care rulează permanent (deploy/auto-deploy.sh), verifică GitHub-ul o dată pe minut și, dacă există commit nou pe
 *     branch, face deploy (deploy/deploy.sh: git pull, npm ci doar dacă s-au schimbat dependențele, prisma generate, build, reload, verificare;
 *     la build eșuat sau aplicație care nu pornește revine la commit-ul anterior). Nu are nevoie de webhook sau SSH dinspre GitHub.
 *
 * Valorile se citesc din .env.local, apoi din .env (ca în Next): PM2_NAME (implicit „crm”), PORT (implicit 3000) și PM2_HEAP_MB (implicit 2048).
 * Next NU citește PORT din fișierele .env (serverul HTTP pornește înainte să se încarce), de aceea îl dăm noi explicit cu `-p`.
 * Restul variabilelor (DATABASE_URL, SESSION_SECRET…) le citește Next singur din .env.
 */
const fs = require("node:fs");
const path = require("node:path");

function fromEnvFile(key, fallback) {
  for (const file of [".env.local", ".env"]) {
    try {
      // String.raw: într-un șablon obișnuit „\s” ar deveni „s” și expresia n-ar mai potrivi spațiile
      const re = new RegExp(String.raw`^\s*${key}\s*=\s*"?([^"\r\n#]+?)"?\s*$`, "m");
      const m = fs.readFileSync(path.join(__dirname, file), "utf8").match(re);
      if (m) return m[1];
    } catch {}
  }
  return process.env[key] || fallback;
}
const NAME = fromEnvFile("PM2_NAME", "crm");
const PORT = fromEnvFile("PORT", "3000");
// Memoria: listele mari (plătitori, contoare, facturi, sarcini) stau comprimate în proces, plus generarea PDF-urilor și a pozelor.
const HEAP = Math.max(512, Number(fromEnvFile("PM2_HEAP_MB", "2048")) || 2048);

module.exports = {
  apps: [
    {
      name: NAME,
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${PORT}`,
      exec_mode: "fork",
      instances: 1,
      watch: false, // în producție fișierele nu se urmăresc: deploy-ul face reload controlat
      node_args: `--max-old-space-size=${HEAP}`,
      env: { NODE_ENV: "production", PORT, NODE_OPTIONS: `--max-old-space-size=${HEAP}` },
      autorestart: true,
      max_memory_restart: `${HEAP + 512}M`,
      min_uptime: "10s",
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 20000, // o trimitere către 1C sau un export în curs are timp să se termine
      time: true,
      merge_logs: true,
      out_file: "logs/out.log",
      error_file: "logs/error.log",
    },
    {
      name: `${NAME}-autodeploy`,
      cwd: __dirname,
      script: "deploy/auto-deploy.sh",
      interpreter: "bash",
      exec_mode: "fork",
      instances: 1,
      // Rulează permanent (bucla de o dată pe minut e în script). NU folosi cron_restart: pm2 ar opri procesul și în mijlocul unui deploy
      // (un build durează câteva minute) și l-ar lăsa neterminat.
      autorestart: true,
      restart_delay: 10000,
      watch: false,
      time: true,
      merge_logs: true,
      out_file: "logs/auto-deploy.log",
      error_file: "logs/auto-deploy.log",
    },
  ],
};
