import { beforeEach, describe, expect, it, vi } from "vitest";

export default {
  info: vi.fn(),
  setFailed: vi.fn(),
  getInput: vi.fn((name: string) => {
    if (name === "v_prefix") return "true";
    if (name === "token") return "TEST_TOKEN";
    return "";
  })
};