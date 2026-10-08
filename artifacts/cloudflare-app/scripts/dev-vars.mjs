// Writes a local .dev.vars file (gitignored) for `wrangler dev`, sourced
// from this Repl's environment secrets. Never commit .dev.vars.
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const keys = [
  "BAAS_API_KEY",
  "BAAS_BASE_URL",
  "DEEPAI_API_KEY",
  "VIRUSTOTAL_API_KEY",
];

const lines = keys
  .filter((k) => process.env[k])
  .map((k) => {
    // Strip stray whitespace without printing any credential values.
    const value = process.env[k].replace(/\s+/g, "");
    return `${k}=${value}`;
  });

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;
if (firebaseProjectId) {
  lines.push(`FIREBASE_PROJECT_ID=${firebaseProjectId.replace(/\s+/g, "")}`);
}

writeFileSync(path.join(__dirname, "../.dev.vars"), lines.join("\n") + "\n");
console.log(`Wrote .dev.vars with ${lines.length} runtime settings present.`);
