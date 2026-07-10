import { describe, expect, it } from "vitest";

import { parseWebviewMessage } from "../src/webviewProtocol";

describe("parseWebviewMessage", () => {
  it("accepts the no-payload messages", () => {
    expect(parseWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseWebviewMessage({ type: "stop" })).toEqual({ type: "stop" });
    expect(parseWebviewMessage({ type: "newChat" })).toEqual({
      type: "newChat",
    });
    expect(parseWebviewMessage({ type: "restart" })).toEqual({
      type: "restart",
    });
    expect(parseWebviewMessage({ type: "retry" })).toEqual({
      type: "retry",
    });
  });

  it("accepts sendMessage with non-empty text", () => {
    expect(parseWebviewMessage({ type: "sendMessage", text: "hi" })).toEqual({
      type: "sendMessage",
      text: "hi",
    });
  });

  it("rejects sendMessage with missing, non-string, or blank text", () => {
    expect(parseWebviewMessage({ type: "sendMessage" })).toBeNull();
    expect(parseWebviewMessage({ type: "sendMessage", text: 42 })).toBeNull();
    expect(
      parseWebviewMessage({ type: "sendMessage", text: "   " }),
    ).toBeNull();
  });

  it("accepts setAutocomplete with a boolean and rejects other types", () => {
    expect(
      parseWebviewMessage({ type: "setAutocomplete", enabled: true }),
    ).toEqual({ type: "setAutocomplete", enabled: true });
    expect(
      parseWebviewMessage({ type: "setAutocomplete", enabled: false }),
    ).toEqual({ type: "setAutocomplete", enabled: false });
    expect(parseWebviewMessage({ type: "setAutocomplete" })).toBeNull();
    expect(
      parseWebviewMessage({ type: "setAutocomplete", enabled: "yes" }),
    ).toBeNull();
  });

  it("accepts onboardingAction with a known id and rejects others", () => {
    expect(
      parseWebviewMessage({ type: "onboardingAction", id: "getStarted" }),
    ).toEqual({ type: "onboardingAction", id: "getStarted" });
    expect(
      parseWebviewMessage({ type: "onboardingAction", id: "startCoding" }),
    ).toEqual({ type: "onboardingAction", id: "startCoding" });
    expect(
      parseWebviewMessage({ type: "onboardingAction", id: "bogus" }),
    ).toBeNull();
    expect(parseWebviewMessage({ type: "onboardingAction" })).toBeNull();
  });

  it("accepts openExternal only for https ollama.com URLs", () => {
    expect(
      parseWebviewMessage({
        type: "openExternal",
        url: "https://ollama.com/download",
      }),
    ).toEqual({ type: "openExternal", url: "https://ollama.com/download" });
    // https but a different host → rejected (host allowlist).
    expect(
      parseWebviewMessage({ type: "openExternal", url: "https://evil.test" }),
    ).toBeNull();
    // wrong protocol / not a URL / missing.
    expect(
      parseWebviewMessage({ type: "openExternal", url: "http://ollama.com" }),
    ).toBeNull();
    expect(
      parseWebviewMessage({ type: "openExternal", url: "file:///etc/passwd" }),
    ).toBeNull();
    expect(
      parseWebviewMessage({ type: "openExternal", url: "not a url" }),
    ).toBeNull();
    expect(parseWebviewMessage({ type: "openExternal" })).toBeNull();
  });

  it("rejects unknown types and non-object input", () => {
    expect(parseWebviewMessage({ type: "evil" })).toBeNull();
    expect(parseWebviewMessage(null)).toBeNull();
    expect(parseWebviewMessage("ready")).toBeNull();
    expect(parseWebviewMessage(undefined)).toBeNull();
  });
});
