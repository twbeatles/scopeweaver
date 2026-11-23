import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(import.meta.dirname, "..");
const root = resolve(webRoot, "..");
const theme = "web/src/lib/preferences/theme.ts";
const generator = "web/src/scripts/generate-theme-presets.ts";
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const forGit = (paths) => `${paths.join("\0")}\0`;

function run(command, args, { status = 0, ...options } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== status) throw new Error(`${command} ${args[0]} failed (${result.signal ?? result.status})`);
  return result.stdout;
}

function git(args, input) {
  return run("git", args, { input });
}

function records(output) {
  return text.decode(output).split("\0").slice(0, -1);
}

function indexedFiles() {
  return git(["ls-files", "--stage", "-z", "--", "web/", ".gitignore", ".editorconfig"]);
}

function isThemeInput(path) {
  return (
    path === theme ||
    path === generator ||
    path === "web/biome.json" ||
    path === "web/tsconfig.json" ||
    path === "web/tsconfig.scripts.json" ||
    path === "web/src/app/globals.css" ||
    /^web\/src\/styles\/presets\/[^/]+\.css$/.test(path)
  );
}

function checkCommitIndex() {
  if (!process.env.GIT_INDEX_FILE) return;
  const args = ["rev-parse", "--path-format=absolute", "--git-path", "index"];
  const { GIT_INDEX_FILE, ...env } = process.env;
  const active = git(args).toString().trimEnd();
  const normal = run("git", args, { env }).toString().trimEnd();
  // Git publishes index.lock for a normal tracked-files commit. Path-limited
  // commits instead publish a different index from the one the hook receives.
  if (active !== normal && active !== `${normal}.lock`) {
    throw new Error("Staged fixes need the normal Git index. Stage the paths and run git commit without paths.");
  }
}

function formattingPatch(snapshot, path, original) {
  const before = `before/${path}`;
  const after = `staged/${path}`;
  const file = join(snapshot, before);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, original, { mode: statSync(join(snapshot, after)).mode });
  return run(
    "git",
    [
      "diff",
      "--no-index",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--unified=1000000",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--",
      before,
      after,
    ],
    { cwd: snapshot, status: 1, maxBuffer: 32 * 1024 * 1024 },
  );
}

function worktreeMatches(path, original) {
  const file = join(root, path);
  try {
    return lstatSync(file).isFile() && readFileSync(file).equals(original);
  } catch {
    // Leave removed or inaccessible working files untouched.
    return false;
  }
}

function check() {
  const before = indexedFiles();
  const changed = records(git(["diff", "--cached", "--name-only", "--no-renames", "-z", "--", "web/"]));
  const regularFiles = new Map();
  for (const record of records(before)) {
    const entry = /^(100644|100755) [0-9a-f]+ 0\t/.exec(record);
    if (entry) regularFiles.set(record.slice(entry[0].length), entry[1]);
  }
  const targets = new Set(changed.filter((path) => /\.(js|jsx|ts|tsx)$/.test(path) && regularFiles.has(path)));
  const generateTheme = changed.some(isThemeInput) && regularFiles.has(theme);
  if (targets.size === 0 && !generateTheme) return;

  const snapshot = mkdtempSync(join(tmpdir(), "scopeweaver-staged-"));
  const stagedRoot = join(snapshot, "staged");
  try {
    // Project-aware Biome rules need real files and the rest of the staged web project.
    mkdirSync(join(stagedRoot, ".git"), { recursive: true });
    git(
      ["checkout-index", "--ignore-skip-worktree-bits", `--prefix=${stagedRoot}/`, "-z", "--stdin"],
      forGit([...regularFiles.keys()]),
    );
    if (generateTheme) targets.add(theme);
    const originals = new Map([...targets].map((path) => [path, readFileSync(join(stagedRoot, path))]));
    const stagedWeb = join(stagedRoot, "web");
    const runTool = (args) => run(process.execPath, args, { cwd: stagedWeb, stdio: "inherit" });

    if (generateTheme) {
      // Git has no directory entry when all preset CSS files have been deleted.
      mkdirSync(join(stagedWeb, "src/styles/presets"), { recursive: true });
      symlinkSync(join(webRoot, "node_modules"), join(stagedWeb, "node_modules"), "junction");
      runTool([
        fileURLToPath(import.meta.resolve("ts-node/dist/bin.js")),
        "-P",
        join(stagedWeb, "tsconfig.scripts.json"),
        join(stagedRoot, generator),
      ]);
      if (!changed.includes(theme) && readFileSync(join(stagedRoot, theme)).equals(originals.get(theme))) {
        targets.delete(theme);
      }
    }
    if (targets.size === 0) return;

    runTool([
      fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome")),
      "check",
      "--write",
      "--no-errors-on-unmatched",
      ...[...targets].map((path) => `./${path.slice("web/".length)}`),
    ]);

    const updates = [];
    const patches = new Map();
    for (const path of targets) {
      const content = readFileSync(join(stagedRoot, path));
      if (content.equals(originals.get(path))) continue;
      const object = git(["hash-object", "-w", `--path=${path}`, "--stdin"], content).toString().trim();
      updates.push(`${regularFiles.get(path)} ${object}\t${path}`);
      patches.set(path, formattingPatch(snapshot, path, originals.get(path)));
    }
    if (!indexedFiles().equals(before)) throw new Error("The Git index changed while checking staged files");
    if (updates.length === 0) return;
    checkCommitIndex();
    git(["update-index", "-z", "--index-info"], forGit(updates));

    // Sync only unchanged working copies. A patch hunk can match a different
    // location in an edited file, so leave partially staged files byte-for-byte.
    for (const [path, patch] of patches) {
      if (!worktreeMatches(path, originals.get(path))) continue;
      const applied = spawnSync("git", ["-c", "apply.ignoreWhitespace=false", "apply", "-p2", "--whitespace=nowarn"], {
        cwd: root,
        input: patch,
        stdio: "pipe",
      });
      if (applied.status !== 0) console.warn(`Could not apply staged fixes to the working copy of ${JSON.stringify(path)}.`);
    }
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

try {
  check();
} catch (error) {
  console.error(`Staged web checks failed: ${error.message}`);
  process.exitCode = 1;
}
