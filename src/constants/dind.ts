import { join } from "path"
import { PROJECT_DIR } from "./paths"

/** Single dind layer, built over each finished provider image via the BASE_IMAGE build arg. */
export const DIND_DOCKERFILE_PATH = join(PROJECT_DIR, "docker", "shared", "dind.dockerfile")

/** Suffix appended to the image tag and the update-check cache of a dind variant. */
export const DIND_SUFFIX = "-dind"

/** Marks running dind containers so a second session can detect the first and step aside. */
export const DIND_LABEL = "secure-vibe.dind=1"

/** Data root of the nested rootless daemon. */
export const DIND_DATA_ROOT = "/home/viber/.local/share/docker"

/** Shared, resettable with `bun run prune:docker`. */
export const DIND_VOLUME_NAME = "secure-vibe-docker"
