import { vi } from "vitest";

const getInput = vi.fn((name: string): string => {
  if (name === "v_prefix") return "true";
  if (name === "token") return "TEST_TOKEN";
  if (name === "create_release") return "true";
  if (name === "mark_release_as_latest") return "true";
  if (name === "generate_release_notes") return "true";
  return "";
});

export default {
  info: vi.fn(),
  setFailed: vi.fn(),
  getInput
};