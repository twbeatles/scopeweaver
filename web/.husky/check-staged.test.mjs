import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const web = resolve(import.meta.dirname, "..");
const theme = "web/src/lib/preferences/theme.ts";
const preset = "web/src/styles/presets/brutalist.css";
const environments = execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).trim().split(/\r?\n/);

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "scopeweaver-hook-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of environments) delete env[key];
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: join(root, ".empty-global-config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Hook fixture",
    GIT_AUTHOR_EMAIL: "hook@example.invalid",
    GIT_COMMITTER_NAME: "Hook fixture",
    GIT_COMMITTER_EMAIL: "hook@example.invalid",
    HUSKY: "1",
  });
  const options = { cwd: root, env, encoding: "utf8" };
  const git = (...args) => execFileSync("git", args, options);
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const read = (path) => readFileSync(join(root, path), "utf8");

  git("init", "--quiet", "--template=");
  for (const path of [
    ".gitignore",
    ".husky/check-staged.mjs",
    ".husky/pre-commit",
    "biome.json",
    "package.json",
    "src/scripts/generate-theme-presets.ts",
    "tsconfig.json",
    "tsconfig.scripts.json",
  ]) {
    const destination = join(root, "web", path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(web, path), destination);
  }
  write(".gitignore", "web/node_modules/\n");
  for (const [path, content] of Object.entries(files)) write(path, content);
  symlinkSync(join(web, "node_modules"), join(root, "web/node_modules"), "junction");
  git("add", ".");
  git("commit", "--quiet", "-m", "Initialize the hook fixture");
  const prepared = spawnSync("npm", ["run", "prepare"], {
    ...options,
    cwd: join(root, "web"),
    shell: process.platform === "win32",
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(git("config", "--get", "core.hooksPath").trim(), "web/.husky/_");
  return {
    git,
    write,
    read,
    commit: (...paths) => spawnSync("git", ["commit", "--quiet", "-m", "Run the pre-commit hook", ...paths], options),
  };
}

test("the hook formats only supported staged files and preserves overlapping worktree edits", (t) => {
  const deleted = "web/src/deleted.ts";
  const invalid = "export const invalid = missing;\n";
  const { git, write, read, commit } = fixture(t, { [deleted]: invalid });
  const directory = process.platform === "win32" ? "space [한글]" : "space [한글]\nnext";
  const staged = `web/src/${directory}/sample.ts`;
  const nonWeb = "sample.ts";
  const unsupported = "web/src/sample.mts";
  const ignored = "web/src/components/ui/sample.ts";
  const fullyStaged = `web/src/${directory}/fully-staged.js`;
  const partial = "web/src/partial.ts";
  const unchangedLines = [1, 2, 3, 4, 5].map((index) => `export const kept${index} = ${index};\n`).join("");
  const stagedPartial = `export const formatted=2\n${unchangedLines}`;
  const unstagedPartial = `${stagedPartial}export const worktree = true;\n`;
  write(partial, stagedPartial);
  write(staged, "export const sample=2\n");
  write(fullyStaged, "export const fullyStaged=2\n");
  for (const path of [nonWeb, unsupported, ignored]) write(path, invalid);
  git("add", "--", staged, fullyStaged, nonWeb, unsupported, ignored, partial);
  write(partial, unstagedPartial);
  git("rm", "--quiet", "--", deleted);
  write(deleted, "export const untracked = true;\n");
  const unstaged = "export const sample=3\n";
  write(staged, unstaged);

  const result = commit();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git("show", `HEAD:${staged}`), "export const sample = 2;\n");
  assert.equal(git("show", `HEAD:${fullyStaged}`), "export const fullyStaged = 2;\n");
  assert.equal(read(fullyStaged), "export const fullyStaged = 2;\n");
  assert.equal(git("diff", "--", fullyStaged), "");
  for (const path of [nonWeb, unsupported, ignored]) assert.equal(git("show", `HEAD:${path}`), invalid);
  assert.equal(git("ls-files", "--", deleted), "");
  assert.equal(read(deleted), "export const untracked = true;\n");
  assert.equal(read(staged), unstaged);
  assert.equal(git("show", `HEAD:${partial}`), `export const formatted = 2;\n${unchangedLines}`);
  assert.equal(read(partial), unstagedPartial);
});

test("path-limited commits requiring fixes leave the original index and worktree intact", (t) => {
  const path = "web/src/sample.ts";
  const { git, write, read, commit } = fixture(t, { [path]: "export const sample = 1;\n" });
  const unstaged = "export const sample=2\n";
  write(path, unstaged);
  const index = git("ls-files", "--stage");

  const result = commit("--", path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stage the paths and run git commit without paths/);
  assert.equal(git("ls-files", "--stage"), index);
  assert.equal(read(path), unstaged);

  git("add", "--", path);
  const retried = commit();
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(read(path), "export const sample = 2;\n");
  assert.equal(git("status", "--short"), "");
});

test("a staged lint error aborts the commit and leaves all staged and unstaged content intact", (t) => {
  const { git, write, read, commit } = fixture(t);
  const fixable = "web/src/fixable.ts";
  const invalid = "web/src/invalid.ts";
  write(fixable, "export const fixable=1\n");
  write(invalid, "export const invalid = missing;\n");
  git("add", "--", fixable, invalid);
  const index = git("ls-files", "--stage");
  const worktree = "export const invalid = 4;\n";
  write(invalid, worktree);

  const result = commit();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /noUndeclaredVariables/);
  assert.equal(git("ls-files", "--stage"), index);
  assert.equal(read(fixable), "export const fixable=1\n");
  assert.equal(read(invalid), worktree);
});

test("theme generation reads staged CSS and protects unstaged theme changes", (t) => {
  const originalTheme = `
const swt = (key: string) => key;
// --- generated:themePresets:start ---
// --- generated:themePresets:end ---
`;
  const colors = (color) =>
    `/*\nlabel: Brutalist\nvalue: brutalist\n*/\n:root[data-theme-preset="brutalist"] { --primary: ${color}; }\n.dark:root[data-theme-preset="brutalist"] { --primary: black; }\n`;
  const { git, write, read, commit } = fixture(t, {
    [theme]: originalTheme,
    [preset]: colors("red"),
    "web/src/app/globals.css": ":root { --primary: white; }\n.dark { --primary: gray; }\n",
  });
  write(preset, colors("green"));
  git("add", "--", preset);
  write(preset, colors("purple"));
  const generator = "web/src/scripts/generate-theme-presets.ts";
  const config = "web/tsconfig.scripts.json";
  write(generator, "throw new Error('unstaged generator');\n");
  write(config, "invalid unstaged TypeScript options");
  const unstagedTheme = `${originalTheme}export const worktree = true;\n`;
  write(theme, unstagedTheme);

  const result = commit();
  assert.equal(result.status, 0, result.stderr);
  const generated = git("show", `HEAD:${theme}`);
  assert.match(generated, /light: "green"/);
  assert.match(generated, /swt\("english\.e188"\)/);
  assert.match(generated, /swt\("english\.e189"\)/);
  assert.doesNotMatch(generated, /purple|worktree/);
  assert.equal(read(theme), unstagedTheme);
  assert.equal(read(preset), colors("purple"));
  assert.equal(read(generator), "throw new Error('unstaged generator');\n");
  assert.equal(read(config), "invalid unstaged TypeScript options");
  assert.equal(git("show", "--name-only", "--format=", "HEAD"), `${theme}\n${preset}\n`);
});
