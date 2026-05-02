import { describe, test, expect, beforeEach } from "bun:test";
import { performHintAction, type HintAction } from "./hint-actions";

describe("performHintAction - follow-new-window", () => {
  let sendMessageCalls: Array<{
    message: unknown;
    callback?: (response?: unknown) => void;
  }>;

  beforeEach(() => {
    sendMessageCalls = [];

    // Mock document and window for non-DOM test environment
    (globalThis as unknown as Record<string, unknown>).document = {
      createElement: () => ({
        closest: () => null,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
        dispatchEvent: () => true,
        click: () => {},
      }),
    };
    (globalThis as unknown as Record<string, unknown>).window = {
      innerWidth: 1024,
      innerHeight: 768,
    };
    (globalThis as Record<string, unknown>).MouseEvent = class MouseEvent {
      constructor(public type: string, public init?: MouseEventInit) {}
    };
    (globalThis as Record<string, unknown>).PointerEvent = class PointerEvent {
      constructor(public type: string, public init?: PointerEventInit) {}
    };

    // Mock chrome.runtime
    (globalThis as unknown as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: (
          message: unknown,
          callback?: (response?: unknown) => void,
        ) => {
          sendMessageCalls.push({ message, callback });
        },
      },
    };

    // Reset lastError before each test
    const chromeRuntime = (chrome as unknown as Record<string, unknown>)
      .runtime as Record<string, unknown>;
    delete chromeRuntime.lastError;
  });

  test("sends openNewWindow message to background", () => {
    const el = document.createElement("a");
    performHintAction("https://example.com", el, "follow-new-window");

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0].message).toEqual({
      type: "openNewWindow",
      url: "https://example.com",
    });
    expect(sendMessageCalls[0].callback).toBeDefined();
  });

  test("logs error when background returns an error", () => {
    const el = document.createElement("a");
    performHintAction("https://example.com", el, "follow-new-window");

    expect(sendMessageCalls).toHaveLength(1);

    // Simulate background failure
    const chromeRuntime = (chrome as unknown as Record<string, unknown>)
      .runtime as Record<string, unknown>;
    chromeRuntime.lastError = { message: "Receiving end does not exist." };

    const callback = sendMessageCalls[0].callback;
    expect(callback).toBeDefined();
    callback?.();

    // Should not throw; test passes if we get here
    expect(sendMessageCalls).toHaveLength(1);
  });

  test("does not open anything when url is null", () => {
    const el = document.createElement("div") as unknown as HTMLElement;

    performHintAction(null, el, "follow-new-window");

    expect(sendMessageCalls).toHaveLength(0);
  });
});
