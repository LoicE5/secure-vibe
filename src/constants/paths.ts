import { join } from "path"

/** Project root — used as the Docker build context so COPY paths resolve correctly. */
export const PROJECT_DIR = join(import.meta.dir, "..", "..")
