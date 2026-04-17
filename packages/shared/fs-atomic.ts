import { writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AtomicWriteOptions {
  /** File mode for the written file. Applied to the tmp file before rename. */
  mode?: number;
  /**
   * Mode for the parent directory when it has to be created. The helper always
   * calls `mkdirSync(..., { recursive: true })` defensively; callers that need
   * a specific mode on an existing directory must `mkdirSync` themselves first.
   */
  dirMode?: number;
}

/**
 * Atomic file write: writes to a sibling tmp file and renames into place.
 *
 * POSIX rename(2) is atomic within a filesystem, so readers see either the
 * previous content or the new content, never a half-written file. This is the
 * minimum discipline for any persisted state that survives restarts — spec
 * health, healed specs, team file, config, session handoff records — where a
 * torn write corrupts JSON and silently resets the caller's state on the next
 * read.
 *
 * This does not fsync the file before rename, so a power loss immediately
 * after the call can still lose the latest write. The guarantee is against
 * process crashes and concurrent readers, not against hardware failure.
 */
export function writeFileAtomicSync(
  target: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  const dir = dirname(target);
  mkdirSync(dir, {
    recursive: true,
    ...(options.dirMode !== undefined && { mode: options.dirMode }),
  });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, data, options.mode !== undefined ? { mode: options.mode } : undefined);
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp file may not exist if writeFileSync failed early; ignore.
    }
    throw err;
  }
}
