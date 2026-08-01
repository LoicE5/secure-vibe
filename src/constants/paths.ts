import { join } from "path"

/** Project root — used as the Docker build context so COPY paths resolve correctly. */
export const PROJECT_DIR = join(import.meta.dir, "..", "..")

/** Shared base image every provider Dockerfile builds `FROM`. */
export const BASE_DOCKERFILE_PATH = join(PROJECT_DIR, "docker", "base", "base.dockerfile")

/** Tag named in every provider `FROM`; a local build reuses it, so `--build` needs no registry. */
export const BASE_IMAGE_NAME = "ghcr.io/loice5/secure-vibe/base:latest"
