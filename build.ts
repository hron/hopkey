/**
 * Build script — produces a ready-to-load Chrome extension in ./dist
 *
 * Steps
 * ─────
 *  1. Clean dist/
 *  2. Compile content, options, popup scripts with Bun's bundler
 *  3. Copy manifest.json and static HTML/CSS assets
 *  4. Generate PNG icons
 */

import { build } from "bun";
import { rm, mkdir, copyFile } from "node:fs/promises";
import { solidPng } from "./scripts/generate-icons";

const DIST = "./dist";
const isWatch = process.argv.includes("--watch");

async function runBuild() {
  // 1. Clean
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST);
  await mkdir(`${DIST}/icons`);

  // 2. Bundle scripts
  //    Each entry point gets a flat output name via `naming`.
  //    `target: "browser"` + `format: "iife"` keeps globals accessible and
  //    ensures chrome.* APIs are left untouched (no Node polyfills injected).
  const entries: { in: string; out: string }[] = [
    { in: "./src/content.ts", out: "content" },
    { in: "./src/options.ts", out: "options" },
    { in: "./src/popup.ts", out: "popup" },
  ];

  for (const entry of entries) {
    const result = await build({
      entrypoints: [entry.in],
      outdir: DIST,
      naming: `${entry.out}.js`,
      target: "browser",
      format: "iife",
      minify: !isWatch,
      sourcemap: isWatch ? "inline" : "none",
    });

    if (!result.success) {
      console.error(`❌  Failed to build ${entry.in}`);
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
    console.log(`  ✓  ${entry.out}.js`);
  }

  // 3. Static assets
  await copyFile("./manifest.json", `${DIST}/manifest.json`);
  await copyFile("./public/options.html", `${DIST}/options.html`);
  await copyFile("./public/options.css", `${DIST}/options.css`);
  await copyFile("./public/popup.html", `${DIST}/popup.html`);
  await copyFile("./public/popup.css", `${DIST}/popup.css`);
  console.log("  ✓  manifest.json, options.html/css, popup.html/css");

  // 4. Icons (indigo #4f46e5 = R79 G70 B229)
  for (const size of [16, 48, 128] as const) {
    await copyFile(
      `./icons/icon-${size}.png`,
      `${DIST}/icons/icon-${size}.png`,
    );
  }
  console.log("  ✓  icons/icon-{16,48,128}.png");

  console.log("\n🎉  Build complete →", DIST);
}

// ── Watch mode ────────────────────────────────────────────────────────────

if (isWatch) {
  const { watch } = await import("node:fs");
  console.log("👀  Watching src/ and public/ …\n");
  await runBuild();

  let debounce: Timer | null = null;
  const trigger = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      console.log("\n🔄  Rebuilding…");
      try {
        await runBuild();
      } catch (e) {
        console.error(e);
      }
    }, 150);
  };

  watch("./src", { recursive: true }, trigger);
  watch("./public", { recursive: true }, trigger);
  watch("./manifest.json", trigger);
} else {
  await runBuild();
}
