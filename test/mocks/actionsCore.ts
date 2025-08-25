import { vi } from "vitest";

const getInput = vi.fn((name: string): string => {
  if (name === "v_prefix") return "true";
  if (name === "token") return "TEST_TOKEN";
  return "";
});

export default {
  info: vi.fn(),
  setFailed: vi.fn(),
  getInput
};