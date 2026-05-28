import type { SaveMode } from "../types"
import { VALID_SAVE_MODES } from "../constants"

/** Type guard: narrows an arbitrary string to SaveMode if it matches a valid value. */
function isSaveMode(value: string): value is SaveMode {
  return (VALID_SAVE_MODES as readonly string[]).includes(value)
}

/**
 * Validates the --save CLI value. Null → "no" (with a hint about backups). Invalid → "no" + warning.
 * Returns the chosen mode without prompting.
 */
export async function selectSaveOption(preValue: string | null): Promise<SaveMode> {
  if(preValue === null) {
    console.info(`  Tip: pass --save=zip or --save=copy to back up this directory first, in case you need to roll back the CLI's changes.`)
    return "no"
  }

  const normalized = preValue.toLowerCase()
  if(isSaveMode(normalized)) {
    if(normalized !== "no") console.info(`  Save mode: ${normalized}`)
    return normalized
  }

  console.warn(`  ✗ Invalid save value "${preValue}". Expected: zip, copy, no. Skipping save.`)
  return "no"
}
