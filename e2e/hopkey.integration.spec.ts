import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Build (run once before all tests)
// ═══════════════════════════════════════════════════════════════════════════

const distDir = path.resolve(__dirname, "../dist");

test.beforeAll(() => {
  console.log("[e2e] Building extension...");
  execSync("bun run build", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chrome API stubs — minimal, not mocking behavior under test
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sets up the minimal chrome.* API surface the content script needs.
 * This is infrastructure, not behavior mocking.
 *
 * Returns `sendMessageCalls` — an array that captures calls to
 * `chrome.runtime.sendMessage` for the `followLinkNewWindow` path.
 */
async function installChromeStubs(page: Page): Promise<{ sendMessageCalls: unknown[] }> {
  const sendMessageCalls: unknown[] = [];

  await page.exposeFunction("__hopkeySendMessage", (msg: unknown) => {
    sendMessageCalls.push(msg);
  });

  await page.addInitScript(() => {
    // ── storage ──────────────────────────────────────────────────────────
    // Provide the settings the content script expects.
    // This is configuration, not behavior under test.
    const store: Record<string, unknown> = {
      followLink: "f",
      followLinkNewTab: "F",
      followLinkNewWindow: "ctrl-alt-,",
      copyLink: "k",
      focusInput: "i",
      nextFrame: "h",
      mainFrame: "H",
      searchLink: "l",
      hintChars: "sadfjklewcmpgh",
      hintUpperCase: false,
      inputCandidateColor: "#60a5fa",
      inputCurrentColor: "#f59e0b",
      linkSearchFuzzy: true,
      exclusionRules: [],
    };

    // ── chrome API ───────────────────────────────────────────────────────
    (window as any).chrome = {
      runtime: {
        sendMessage(msg: unknown, cb?: () => void) {
          // Forward to the test so we can assert on it for
          // followLinkNewWindow.  We do NOT call the real background
          // because we are not inside an extension context.
          (window as any).__hopkeySendMessage(msg);
          cb?.();
        },
      },
      storage: {
        sync: {
          get(_keys: unknown, callback: (result: unknown) => void) {
            callback(store);
          },
          set(_data: unknown, callback?: () => void) {
            callback?.();
          },
        },
        onChanged: {
          addListener: () => {},
          removeListener: () => {},
        },
      },
    };
  });

  return { sendMessageCalls };
}

// ═══════════════════════════════════════════════════════════════════════════
// Page helpers — serve test HTML via route interception (no local servers)
// ═══════════════════════════════════════════════════════════════════════════

// Using localhost makes the page a secure context so the Clipboard API
// (navigator.clipboard) is available.  page.route() intercepts
// requests, so no real server is ever started.
const TEST_HOST = "localhost";

function basicPage(extraBody = ""): string {
  return `<!DOCTYPE html>
<html>
<head><title>HopKey Test</title></head>
<body>
  <h1>Test Page</h1>
  <a href="https://example.com" id="link1">Example Link</a>
  <a href="https://github.com" id="link2">GitHub</a>
  <a href="http://localhost/page2" id="internal-link">Internal Page</a>
  <input type="text" id="input1" placeholder="text input" style="display:block;margin:10px 0;">
  <textarea id="textarea1" placeholder="textarea"></textarea>
  ${extraBody}
</body>
</html>`;
}

function page2Html(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Page 2</title></head>
<body><h1>Page 2</h1><p id="nav-ok">Navigation succeeded!</p></body>
</html>`;
}

function framedPage(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Frames</title></head>
<body>
  <h1>Main Frame</h1>
  <input type="text" id="main-input" placeholder="main input" style="display:block;margin:5px 0;">
  <iframe src="http://${TEST_HOST}/frame-a" id="frame-a" style="width:400px;height:150px;"></iframe>
  <iframe src="http://${TEST_HOST}/frame-b" id="frame-b" style="width:400px;height:150px;"></iframe>
</body>
</html>`;
}

function frameAHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Frame A</title></head>
<body>
  <h2>Frame A</h2>
  <a href="https://frame-a.example.com" id="fa-link">Frame A Link</a>
  <input type="text" id="fa-input" placeholder="frame A input">
</body>
</html>`;
}

function frameBHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Frame B</title></head>
<body>
  <h2>Frame B</h2>
  <a href="https://frame-b.example.com" id="fb-link">Frame B Link</a>
</body>
</html>`;
}

/**
 * Install routes on `page` so that every request to `hopkey.test` is
 * served from our inline templates instead of hitting the network.
 */
/**
 * Install context-level routes so that new tabs opened via window.open
 * (which create brand-new pages) are also intercepted.
 *
 * Called once per test.  Since tests run serially (workers:1), storing
 * the handler in a module-level variable is safe.
 */
let _routeHandler: ((route: { request: () => { url: () => string } }) => Promise<void>) | null = null;

async function setupRoutes(page: Page): Promise<void> {
  // Remove any previously installed handler (idempotent)
  if (_routeHandler) {
    await page.context().unroute("**/*", _routeHandler);
    _routeHandler = null;
  }

  const ctx = page.context();
  const handler = (route: any) => {
    const url = new URL(route.request().url());

    if (url.hostname === TEST_HOST) {
      if (url.pathname === "/page2") {
        return route.fulfill({ status: 200, contentType: "text/html", body: page2Html() });
      }
      if (url.pathname === "/frames") {
        return route.fulfill({ status: 200, contentType: "text/html", body: framedPage() });
      }
      if (url.pathname === "/frame-a") {
        return route.fulfill({ status: 200, contentType: "text/html", body: frameAHtml() });
      }
      if (url.pathname === "/frame-b") {
        return route.fulfill({ status: 200, contentType: "text/html", body: frameBHtml() });
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: basicPage() });
    }

    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<html><body><h1>${url.hostname}${url.pathname}</h1></body></html>`,
    });
  };

  await ctx.route("**/*", handler);
  _routeHandler = handler;
}

async function goToBasic(page: Page): Promise<void> {
  await setupRoutes(page);
  await page.goto(`http://${TEST_HOST}`, { waitUntil: "domcontentloaded" });
}

async function goToFramed(page: Page): Promise<void> {
  await setupRoutes(page);
  await page.goto(`http://${TEST_HOST}/frames`, { waitUntil: "domcontentloaded" });
}

// ═══════════════════════════════════════════════════════════════════════════
// Content-script injection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inject the production content.js bundle into the page so that all
 * keyboard shortcuts are handled identically to the real extension.
 */
async function injectContentScript(page: Page): Promise<void> {
  await page.addScriptTag({ path: path.join(distDir, "content.js") });
  // Let the async init() complete and event listeners be registered.
  await page.waitForTimeout(300);
}

// ═══════════════════════════════════════════════════════════════════════════
// Interaction helpers
// ═══════════════════════════════════════════════════════════════════════════

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
}

async function typeChars(page: Page, chars: string): Promise<void> {
  for (const ch of chars) {
    await page.keyboard.press(ch);
    await page.waitForTimeout(40);
  }
}

async function dismiss(page: Page): Promise<void> {
  await press(page, "Escape");
}

/** Returns the text content of visible hint badges, or empty array. */
async function visibleHintLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const c of Array.from(document.querySelectorAll("div"))) {
      if (!c.shadowRoot) continue;
      const badges = c.shadowRoot.querySelectorAll(".hopkey-hint-badge");
      for (const b of Array.from(badges)) {
        if ((b as HTMLElement).style.display !== "none") {
          out.push((b as HTMLElement).textContent ?? "");
        }
      }
    }
    return out;
  });
}

/** Returns true when at least one hint badge is visible. */
async function hintsAreVisible(page: Page): Promise<boolean> {
  const labels = await visibleHintLabels(page);
  return labels.length > 0;
}

/** Type the key sequence for the Nth visible hint (0-indexed). */
async function selectNthHint(page: Page, n: number): Promise<void> {
  const labels = await visibleHintLabels(page);
  if (n < labels.length && labels[n]) {
    await typeChars(page, labels[n]);
    await page.waitForTimeout(200);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe("HopKey keyboard shortcuts", () => {
  test.describe("followLink (f)", () => {
    test("activates hint mode and shows hint badges", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);
      expect(await hintsAreVisible(page)).toBe(false);

      await press(page, "f");
      expect(await hintsAreVisible(page)).toBe(true);
    });

    test("selecting a hint navigates to the link's href", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "f");
      expect(await hintsAreVisible(page)).toBe(true);

      // Select the third link (internal link to /page2)
      await selectNthHint(page, 2);

      // Navigation should happen synchronously via location.href=
      await page.waitForURL("**/page2", { timeout: 5000 });
      const body = await page.textContent("body");
      expect(body).toContain("Navigation succeeded");
    });

    test("Escape dismisses hints", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "f");
      expect(await hintsAreVisible(page)).toBe(true);

      await dismiss(page);
      expect(await hintsAreVisible(page)).toBe(false);
    });
  });

  // ── followLinkNewTab (F) ─────────────────────────────────────────────

  test.describe("followLinkNewTab (F)", () => {
    test("activates hint mode with Shift+F", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await page.keyboard.press("Shift+F");
      await page.waitForTimeout(200);
      expect(await hintsAreVisible(page)).toBe(true);
    });

    test("selecting a hint opens link in new tab via window.open", async ({ page, context }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      // Verify hints appear before trying to select
      await page.keyboard.press("Shift+F");
      await page.waitForTimeout(200);
      expect(await hintsAreVisible(page)).toBe(true);

      const newPagePromise = context.waitForEvent("page", { timeout: 5000 });

      await selectNthHint(page, 0);
      await page.waitForTimeout(300);

      const newPage = await newPagePromise;
      expect(newPage.url()).toContain("example.com");
      await newPage.close();
    });
  });

  // ── followLinkNewWindow (ctrl-alt-,) ─────────────────────────────────

  test.describe("followLinkNewWindow (ctrl-alt-,)", () => {
    test("activates hint mode and sends runtime message on selection", async ({ page }) => {
      const { sendMessageCalls } = await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await page.keyboard.press("Control+Alt+Comma");
      await page.waitForTimeout(200);
      expect(await hintsAreVisible(page)).toBe(true);

      await selectNthHint(page, 0);
      await page.waitForTimeout(300);

      expect(sendMessageCalls.length).toBe(1);
      expect(sendMessageCalls[0]).toMatchObject({
        type: "openNewWindow",
        url: expect.stringContaining("example.com"),
      });
    });
  });

  // ── copyLink (k) ────────────────────────────────────────────────────

  test.describe("copyLink (k)", () => {
    test("activates hint mode for copy", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "k");
      expect(await hintsAreVisible(page)).toBe(true);
    });

    test("selecting a hint copies the link URL to clipboard", async ({ page, context }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await context.grantPermissions(["clipboard-read", "clipboard-write"]);

      await press(page, "k");
      await page.waitForTimeout(200);
      await selectNthHint(page, 0);
      await page.waitForTimeout(500);

      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toContain("example.com");
    });
  });

  // ── focusInput (i) ──────────────────────────────────────────────────

  test.describe("focusInput (i)", () => {
    test("activates input mode and shows marker container", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      let has = await page.evaluate(() =>
        !!document.querySelector("#hopkey-input-marker-container"),
      );
      expect(has).toBe(false);

      await press(page, "i");
      has = await page.evaluate(() =>
        !!document.querySelector("#hopkey-input-marker-container"),
      );
      expect(has).toBe(true);
    });

    test("Enter focuses the highlighted input", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "i");
      await page.waitForTimeout(200);

      await press(page, "Enter");
      await page.waitForTimeout(200);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el as HTMLElement).tagName.toLowerCase() : "none";
      });
      expect(["input", "textarea"]).toContain(focused);
    });

    test("Tab cycles selection, Enter focuses next input", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "i");
      await page.waitForTimeout(200);

      // Tab to second input
      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);

      await press(page, "Enter");
      await page.waitForTimeout(200);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el as HTMLElement).id : "none";
      });
      // Second input in order: input1 then textarea1
      // Actually the sort order is top-to-bottom, left-to-right.
      // input1 is above textarea1, so first is input1, second is textarea1.
      expect(focused).toBe("textarea1");
    });

    test("Escape dismisses input mode", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "i");
      let has = await page.evaluate(() =>
        !!document.querySelector("#hopkey-input-marker-container"),
      );
      expect(has).toBe(true);

      await dismiss(page);
      has = await page.evaluate(() =>
        !!document.querySelector("#hopkey-input-marker-container"),
      );
      expect(has).toBe(false);
    });
  });

  // ── searchLink (l) ──────────────────────────────────────────────────

  test.describe("searchLink (l)", () => {
    test("activates link search mode and shows HUD", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      let hud = await page.evaluate(() =>
        !!document.querySelector("#hopkey-link-search-hud"),
      );
      expect(hud).toBe(false);

      await press(page, "l");
      hud = await page.evaluate(() =>
        !!document.querySelector("#hopkey-link-search-hud"),
      );
      expect(hud).toBe(true);
    });

    test("typing filters links, HUD shows query", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "l");
      await page.waitForTimeout(200);

      await typeChars(page, "exam");
      await page.waitForTimeout(200);

      const text = await page.evaluate(() => {
        const h = document.querySelector("#hopkey-link-search-hud");
        return h?.textContent ?? "";
      });
      expect(text).toContain("exam");
    });

    test("Enter navigates to selected link", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "l");
      await page.waitForTimeout(200);

      // Type something that matches the internal link
      await typeChars(page, "internal");
      await page.waitForTimeout(200);

      await press(page, "Enter");
      await page.waitForURL("**/page2", { timeout: 5000 });
      expect(await page.textContent("body")).toContain("Navigation succeeded");
    });

    test("Shift+Enter opens link in new tab", async ({ page, context }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "l");
      await page.waitForTimeout(200);
      // Verify HUD is visible
      expect(await page.evaluate(() => !!document.querySelector("#hopkey-link-search-hud"))).toBe(true);

      const newPagePromise = context.waitForEvent("page", { timeout: 5000 });

      await typeChars(page, "example");
      await page.waitForTimeout(200);

      await page.keyboard.press("Shift+Enter");
      await page.waitForTimeout(300);

      const newPage = await newPagePromise;
      expect(newPage.url()).toContain("example.com");
      await newPage.close();
    });

    test("Escape dismisses link search mode", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "l");
      expect(await page.evaluate(() => !!document.querySelector("#hopkey-link-search-hud"))).toBe(true);

      await dismiss(page);
      expect(await page.evaluate(() => !!document.querySelector("#hopkey-link-search-hud"))).toBe(false);
    });
  });

  // ── nextFrame (h) / mainFrame (H) ────────────────────────────────────

  test.describe("frame switching", () => {
    test("nextFrame (h) sends focus_self postMessage to first iframe", async ({ page }) => {
      await installChromeStubs(page);
      await goToFramed(page);
      await injectContentScript(page);

      // Collect postMessage calls that match the HopKey protocol.
      // The send() function calls nextWin.postMessage(), so we must
      // intercept on each iframe's contentWindow, not just window.
      const sentMessages: unknown[] = [];
      await page.exposeFunction("__captureHopkeyMsg", (msg: unknown) => {
        sentMessages.push(msg);
      });

      await page.evaluate(() => {
        function wrapPostMessage(win: Window | null) {
          if (!win) return;
          const orig = win.postMessage.bind(win);
          (win as any).postMessage = (msg: unknown, origin: string, transfer?: any) => {
            if (
              typeof msg === "object" &&
              msg !== null &&
              (msg as Record<string, unknown>).__hopkey__ === true
            ) {
              (window as any).__captureHopkeyMsg(msg);
            }
            return orig(msg, origin, transfer);
          };
        }

        // Wrap window.top's postMessage (for main_frame / next_frame)
        wrapPostMessage(window);

        // Wrap each iframe's contentWindow (for focus_self)
        for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
          wrapPostMessage(iframe.contentWindow);
        }
      });

      await press(page, "h");
      await page.waitForTimeout(300);

      // The top frame should have sent a focus_self message to the first iframe
      const focusMsgs = sentMessages.filter(
        (m) => (m as Record<string, unknown>).type === "focus_self",
      );
      expect(focusMsgs.length).toBeGreaterThan(0);
    });

    test("mainFrame (H) focuses a focusable element in the main frame", async ({ page }) => {
      await installChromeStubs(page);
      await goToFramed(page);
      await injectContentScript(page);

      // Press H to switch to main frame
      await page.keyboard.press("Shift+H");
      await page.waitForTimeout(300);

      // After mainFrame, focusSelf() should have focused something
      const activeEl = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "body";
        return (el as HTMLElement).id || (el as HTMLElement).tagName.toLowerCase();
      });

      // Should have focused a real element, not just body
      expect(activeEl).not.toBe("body");
    });
  });
});
