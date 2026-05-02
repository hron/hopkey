import { describe, test, expect } from "bun:test";
import { formatKeyEvent } from "./keys";

function mockEvent(init: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent;
}

describe("formatKeyEvent", () => {
  test("single printable character", () => {
    expect(formatKeyEvent(mockEvent({ key: "f" }))).toBe("f");
  });

  test("shifted letter uses uppercase, no shift prefix", () => {
    expect(formatKeyEvent(mockEvent({ key: "F", shiftKey: true }))).toBe("F");
  });

  test("ctrl modifier", () => {
    expect(formatKeyEvent(mockEvent({ key: "f", ctrlKey: true }))).toBe("ctrl-f");
  });

  test("alt modifier", () => {
    expect(formatKeyEvent(mockEvent({ key: "f", altKey: true }))).toBe("alt-f");
  });

  test("meta modifier", () => {
    expect(formatKeyEvent(mockEvent({ key: "f", metaKey: true }))).toBe("meta-f");
  });

  test("ctrl+shift printable", () => {
    expect(formatKeyEvent(mockEvent({ key: "F", ctrlKey: true, shiftKey: true }))).toBe("ctrl-shift-F");
  });

  test("alt+shift printable", () => {
    expect(formatKeyEvent(mockEvent({ key: "F", altKey: true, shiftKey: true }))).toBe("alt-shift-F");
  });

  test("shift with non-printable key includes shift prefix", () => {
    expect(formatKeyEvent(mockEvent({ key: "Enter", shiftKey: true }))).toBe("shift-Enter");
  });

  test("ctrl+Enter", () => {
    expect(formatKeyEvent(mockEvent({ key: "Enter", ctrlKey: true }))).toBe("ctrl-Enter");
  });

  test("alt+Tab", () => {
    expect(formatKeyEvent(mockEvent({ key: "Tab", altKey: true }))).toBe("alt-Tab");
  });

  test("lone modifier keys return null", () => {
    expect(formatKeyEvent(mockEvent({ key: "Control" }))).toBeNull();
    expect(formatKeyEvent(mockEvent({ key: "Alt" }))).toBeNull();
    expect(formatKeyEvent(mockEvent({ key: "Shift" }))).toBeNull();
    expect(formatKeyEvent(mockEvent({ key: "Meta" }))).toBeNull();
  });

  test("Escape without modifiers", () => {
    expect(formatKeyEvent(mockEvent({ key: "Escape" }))).toBe("Escape");
  });

  test("ctrl+Escape", () => {
    expect(formatKeyEvent(mockEvent({ key: "Escape", ctrlKey: true }))).toBe("ctrl-Escape");
  });

  test("ctrl+alt+comma", () => {
    expect(formatKeyEvent(mockEvent({ key: ",", ctrlKey: true, altKey: true }))).toBe("ctrl-alt-,");
  });
});
