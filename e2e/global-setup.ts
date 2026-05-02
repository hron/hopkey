import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Playwright global setup — builds the extension once before any worker starts.
 */
export default function globalSetup() {
  execSync("bun run build", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });
}
