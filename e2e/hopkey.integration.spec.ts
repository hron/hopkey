import { test, expect, type Page } from "@playwright/test";
import { createServer } from "node:http";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Paths
// ═══════════════════════════════════════════════════════════════════════════

const distDir = path.resolve(__dirname, "../dist");

// ═══════════════════════════════════════════════════════════════════════════
// Test server — serves different HTML for each path
// ═══════════════════════════════════════════════════════════════════════════

let serverUrl = "";
let server: ReturnType<typeof createServer> | null = null;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    const p = req.url ?? "/";
    if (p === "/" || p === "/basic") res.end(basicPage());
    else if (p === "/page2") res.end(page2Html());
    else if (p === "/frames") res.end(framedPage());
    else if (p === "/frame-a") res.end(frameAHtml());
    else if (p === "/frame-b") res.end(frameBHtml());
    else res.end(`<html><body><h1>${p}</h1></body></html>`);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address() as { port: number } | null;
  if (!addr) throw new Error("Server failed to start");
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

test.afterAll(() => {
  server?.close();
  server = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// Chrome API stubs — only the extension-runtime surface the content script
// needs.  Not mocking behavior under test.
// ═══════════════════════════════════════════════════════════════════════════

async function installChromeStubs(page: Page): Promise<{
  sendMessageCalls: unknown[];
}> {
  const sendMessageCalls: unknown[] = [];
  await page.exposeFunction("__hopkeySendMessage", (msg: unknown) => {
    sendMessageCalls.push(msg);
  });

  await page.addInitScript(() => {
    (window as any).chrome = {
      runtime: {
        sendMessage(msg: unknown, cb?: () => void) {
          (window as any).__hopkeySendMessage(msg);
          cb?.();
        },
      },
      storage: {
        sync: {
          get(_keys: unknown, callback: (result: Record<string, unknown>) => void) {
            callback({
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
            });
          },
          set(_data: unknown, callback?: () => void) { callback?.(); },
        },
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
  });

  return { sendMessageCalls };
}

// ═══════════════════════════════════════════════════════════════════════════
// Page templates
// ═══════════════════════════════════════════════════════════════════════════

function basicPage(): string {
  return `<!DOCTYPE html>
<html>
<head><title>HopKey Test</title></head>
<body>
  <h1>Test Page</h1>
  <a href="https://example.com" id="link1">Example Link</a>
  <a href="https://github.com" id="link2">GitHub</a>
  <a href="${serverUrl}/page2" id="internal-link">Internal Page</a>
  <input type="text" id="input1" placeholder="text input" style="display:block;margin:10px 0;">
  <textarea id="textarea1" placeholder="textarea"></textarea>
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
  <iframe src="${serverUrl}/frame-a" id="frame-a" style="width:400px;height:150px;"></iframe>
  <iframe src="${serverUrl}/frame-b" id="frame-b" style="width:400px;height:150px;"></iframe>
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

// ═══════════════════════════════════════════════════════════════════════════
// Navigation + injection helpers
// ═══════════════════════════════════════════════════════════════════════════

async function injectContentScript(page: Page): Promise<void> {
  await page.addScriptTag({ path: path.join(distDir, "content.js") });
  await page.waitForTimeout(300);
}

async function goToBasic(page: Page): Promise<void> {
  await page.goto(`${serverUrl}/basic`, { waitUntil: "domcontentloaded" });
}

async function goToFramed(page: Page): Promise<void> {
  await page.goto(`${serverUrl}/frames`, { waitUntil: "domcontentloaded" });
}

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard helpers
// ═══════════════════════════════════════════════════════════════════════════

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
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

async function hintsAreVisible(page: Page): Promise<boolean> {
  return (await visibleHintLabels(page)).length > 0;
}

async function selectNthHint(page: Page, n: number): Promise<void> {
  const labels = await visibleHintLabels(page);
  if (n < labels.length && labels[n]) {
    await typeChars(page, labels[n]);
    await page.waitForTimeout(250);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe("HopKey keyboard shortcuts", () => {
  // ── followLink (f) ───────────────────────────────────────────────────

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

      await selectNthHint(page, 2);
      await page.waitForURL("**/page2", { timeout: 5000 });
      expect(await page.textContent("body")).toContain("Navigation succeeded");
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

    test("selecting a hint opens link in new tab", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await page.keyboard.press("Shift+F");
      await page.waitForTimeout(200);
      expect(await hintsAreVisible(page)).toBe(true);

      // Spy on window.open — the test can't resolve external URLs
      const openCalls: Array<{ url: string; target: string }> = [];
      await page.exposeFunction("__captureOpen", (url: string, target: string) => {
        openCalls.push({ url, target });
      });
      await page.evaluate(() => {
        const orig = window.open.bind(window);
        (window as any).open = (url: string, target: string) => {
          (window as any).__captureOpen(url, target);
          return null; // don't actually open
        };
      });

      await selectNthHint(page, 0);
      await page.waitForTimeout(300);

      expect(openCalls.length).toBe(1);
      expect(openCalls[0].url).toContain("example.com");
      expect(openCalls[0].target).toBe("_blank");
    });
  });

  // ── followLinkNewWindow (ctrl-alt-,) ─────────────────────────────────

  test.describe("followLinkNewWindow (ctrl-alt-,)", () => {
    test("activates hint mode with Ctrl+Alt+,", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await page.keyboard.press("Control+Alt+Comma");
      await page.waitForTimeout(200);
      expect(await hintsAreVisible(page)).toBe(true);
    });

    test("selecting a hint calls chrome.runtime.sendMessage", async ({ page }) => {
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

      // localhost is a secure context → clipboard API available
      await context.grantPermissions(
        ["clipboard-read", "clipboard-write"],
        { origin: serverUrl },
      );

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

      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);

      await press(page, "Enter");
      await page.waitForTimeout(200);

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el as HTMLElement).id : "none";
      });
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

      await typeChars(page, "internal");
      await page.waitForTimeout(200);

      await press(page, "Enter");
      await page.waitForURL("**/page2", { timeout: 5000 });
      expect(await page.textContent("body")).toContain("Navigation succeeded");
    });

    test("Shift+Enter opens link in new tab", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "l");
      await page.waitForTimeout(200);
      expect(
        await page.evaluate(() => !!document.querySelector("#hopkey-link-search-hud")),
      ).toBe(true);

      // Spy on window.open
      const openCalls: Array<{ url: string; target: string }> = [];
      await page.exposeFunction("__captureOpen2", (url: string, target: string) => {
        openCalls.push({ url, target });
      });
      await page.evaluate(() => {
        const orig = window.open.bind(window);
        (window as any).open = (url: string, target: string) => {
          (window as any).__captureOpen2(url, target);
          return null;
        };
      });

      await typeChars(page, "example");
      await page.waitForTimeout(200);

      await page.keyboard.press("Shift+Enter");
      await page.waitForTimeout(300);

      expect(openCalls.length).toBe(1);
      expect(openCalls[0].url).toContain("example.com");
      expect(openCalls[0].target).toBe("_blank");
    });

    test("Escape dismisses link search mode", async ({ page }) => {
      await installChromeStubs(page);
      await goToBasic(page);
      await injectContentScript(page);

      await press(page, "l");
      expect(
        await page.evaluate(() => !!document.querySelector("#hopkey-link-search-hud")),
      ).toBe(true);

      await dismiss(page);
      expect(
        await page.evaluate(() => !!document.querySelector("#hopkey-link-search-hud")),
      ).toBe(false);
    });
  });

  // ── nextFrame (h) / mainFrame (H) ────────────────────────────────────

  test.describe("frame switching", () => {
    test("nextFrame (h) sends focus_self postMessage to first iframe", async ({ page }) => {
      await installChromeStubs(page);
      await goToFramed(page);
      await injectContentScript(page);

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
        wrapPostMessage(window);
        for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
          wrapPostMessage(iframe.contentWindow);
        }
      });

      await press(page, "h");
      await page.waitForTimeout(300);

      const focusMsgs = sentMessages.filter(
        (m) => (m as Record<string, unknown>).type === "focus_self",
      );
      expect(focusMsgs.length).toBeGreaterThan(0);
    });

    test("mainFrame (H) focuses a focusable element in the main frame", async ({ page }) => {
      await installChromeStubs(page);
      await goToFramed(page);
      await injectContentScript(page);

      await page.keyboard.press("Shift+H");
      await page.waitForTimeout(300);

      const activeEl = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "body";
        return (el as HTMLElement).id || (el as HTMLElement).tagName.toLowerCase();
      });
      expect(activeEl).not.toBe("body");
    });
  });
});
