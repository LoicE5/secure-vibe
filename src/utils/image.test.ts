import { describe, expect, test } from "bun:test"
import { PROJECT_DIR } from "../constants"
import { createBuildCommand, runBuild } from "./image"

const DOCKERFILE = "/project/docker/provider.dockerfile"
const TAG = "example.test/provider:latest"

describe("local image build commands", () => {
  test("loads Docker builds without provenance", () => {
    expect(createBuildCommand("docker", DOCKERFILE, TAG, false)).toEqual([
      "docker", "build",
      "-f", DOCKERFILE,
      "-t", TAG,
      "--load", "--provenance=false",
      PROJECT_DIR
    ])
  })

  test("preserves no-cache alongside Docker output flags", () => {
    expect(createBuildCommand("docker", DOCKERFILE, TAG, true)).toEqual([
      "docker", "build",
      "-f", DOCKERFILE,
      "-t", TAG,
      "--no-cache",
      "--load", "--provenance=false",
      PROJECT_DIR
    ])
  })

  test("preserves build arguments alongside Docker output flags", () => {
    expect(createBuildCommand("docker", DOCKERFILE, TAG, false, {
      BASE_IMAGE: "example.test/provider:base"
    })).toEqual([
      "docker", "build",
      "-f", DOCKERFILE,
      "-t", TAG,
      "--build-arg", "BASE_IMAGE=example.test/provider:base",
      "--load", "--provenance=false",
      PROJECT_DIR
    ])
  })

  test("leaves Podman build arguments unchanged", () => {
    expect(createBuildCommand("podman", DOCKERFILE, TAG, true, {
      BASE_IMAGE: "example.test/provider:base"
    })).toEqual([
      "podman", "build",
      "-f", DOCKERFILE,
      "-t", TAG,
      "--build-arg", "BASE_IMAGE=example.test/provider:base",
      "--no-cache",
      PROJECT_DIR
    ])
  })

  test("rejects a successful build when the target tag is not inspectable", async () => {
    const commands: string[][] = []
    const outputs: string[] = []
    const exitCodes = [0, 1]
    const commandRunner = async (command: string[], output: "inherit" | "ignore"): Promise<number> => {
      commands.push(command)
      outputs.push(output)
      return exitCodes.shift() ?? 1
    }

    await expect(runBuild("docker", DOCKERFILE, TAG, false, {}, commandRunner))
      .rejects.toThrow(`target tag "${TAG}" is unavailable`)
    expect(commands).toEqual([
      createBuildCommand("docker", DOCKERFILE, TAG, false),
      ["docker", "image", "inspect", TAG]
    ])
    expect(outputs).toEqual(["inherit", "ignore"])
  })
})
