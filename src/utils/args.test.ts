import { describe, expect, test } from "bun:test"
import type { ParsedArgs } from "../types"
import { PROVIDER_IDS, resolveConfiguration, resolveProviderId } from "./args"

const EMPTY_ARGS = {
  directory: null,
  save: null,
  runtime: null,
  command: null,
  exclude: null,
  build: false,
  buildNoCache: false,
  pull: false,
  local: false,
  dind: false,
  provider: null
} satisfies ParsedArgs

describe("secure-vibe configuration", () => {
  test("defaults to claude and accepts every provider", () => {
    expect(resolveProviderId(null, {})).toBe("claude")
    for(const provider of PROVIDER_IDS) {
      expect(resolveProviderId(null, { SECURE_VIBE_PROVIDER: provider })).toBe(provider)
    }
  })

  test("an explicit provider overrides the environment", () => {
    expect(resolveProviderId("codex", { SECURE_VIBE_PROVIDER: "vibe" })).toBe("codex")
  })

  test("rejects invalid configured providers with every valid choice", () => {
    expect(() => resolveProviderId(null, { SECURE_VIBE_PROVIDER: "other" }))
      .toThrow(`Invalid SECURE_VIBE_PROVIDER value "other". Expected: ${PROVIDER_IDS.join(", ")}.`)
  })

  test("resolves every prefixed value and boolean", () => {
    const configuration = resolveConfiguration(EMPTY_ARGS, {
      SECURE_VIBE_DIRECTORY: "/workspace",
      SECURE_VIBE_SAVE: "copy",
      SECURE_VIBE_RUNTIME: "podman",
      SECURE_VIBE_COMMAND: "bash",
      SECURE_VIBE_EXCLUDE: ".env",
      SECURE_VIBE_BUILD: "true",
      SECURE_VIBE_BUILD_NO_CACHE: "1",
      SECURE_VIBE_PULL: "yes",
      SECURE_VIBE_LOCAL: "TRUE",
      SECURE_VIBE_DIND: "Yes",
      SECURE_VIBE_PROVIDER: "ccr"
    })

    expect(configuration).toEqual({
      directory: "/workspace",
      save: "copy",
      runtime: "podman",
      command: "bash",
      exclude: ".env",
      build: true,
      buildNoCache: true,
      pull: true,
      local: true,
      dind: true,
      provider: "ccr"
    })
  })

  test("ignores every old unprefixed control", () => {
    const environment = {
      DIRECTORY: "/old",
      SAVE: "zip",
      RUNTIME: "podman",
      COMMAND: "old",
      EXCLUDE: "secret",
      BUILD: "true",
      BUILD_NO_CACHE: "true",
      PULL: "true",
      LOCAL: "true",
      DIND: "true",
      PROVIDER: "vibe"
    }

    expect(resolveConfiguration(EMPTY_ARGS, environment)).toEqual({
      directory: null,
      save: null,
      runtime: null,
      command: null,
      exclude: null,
      build: false,
      buildNoCache: false,
      pull: false,
      local: false,
      dind: false,
      provider: "claude"
    })
  })

  test("CLI values override prefixed controls", () => {
    const args = {
      ...EMPTY_ARGS,
      directory: "/cli",
      save: "no",
      runtime: "docker",
      command: "zsh",
      exclude: "cli-secret",
      build: true,
      provider: "antigravity" as const
    }
    const configuration = resolveConfiguration(args, {
      SECURE_VIBE_DIRECTORY: "/env",
      SECURE_VIBE_SAVE: "zip",
      SECURE_VIBE_RUNTIME: "podman",
      SECURE_VIBE_COMMAND: "bash",
      SECURE_VIBE_EXCLUDE: "env-secret",
      SECURE_VIBE_PROVIDER: "vibe"
    })

    expect(configuration.directory).toBe("/cli")
    expect(configuration.save).toBe("no")
    expect(configuration.runtime).toBe("docker")
    expect(configuration.command).toBe("zsh")
    expect(configuration.exclude).toBe("cli-secret")
    expect(configuration.build).toBe(true)
    expect(configuration.provider).toBe("antigravity")
  })
})
