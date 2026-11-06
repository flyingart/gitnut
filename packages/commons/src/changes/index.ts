// Ported from IntelliJ IDEA Community Edition: platform/vcs-impl/src/com/intellij/openapi/vcs/changes/committed/
// CommittedChangesTreeBrowser.java (zipChanges), Apache-2.0.
import type { ChangeStatus, FileChange, FileSide } from "../protocol";

/** Change(before, after) type: NEW, DELETED, MOVED or MODIFICATION. */
export function changeStatus(before: FileSide | null, after: FileSide | null): ChangeStatus {
  if (!before) return "added";
  if (!after) return "deleted";
  return before.path !== after.path ? "renamed" : "modified";
}

/** A merged change `new Change(before, after)`; copies keep their status while the copy source is the before side. */
function mergedChange(old: FileChange, before: FileSide | null, after: FileSide | null): FileChange {
  let status = changeStatus(before, after);
  if (old.status === "copied" && status === "renamed") status = "copied";
  const path = (after ?? before)!.path;
  const c: FileChange = { path, status, before, after };
  if (before && after && before.path !== after.path) c.oldPath = before.path;
  return c;
}

/**
 * Combine the changes of several commits, ordered oldest first, into one change per file:
 * before = state before the first commit touching it, after = state after the last one.
 * Renames chain (a→b, b→c = a→c), add then delete cancels. Unmerged changes are returned as they are.
 *
 * IntelliJ keys changes by after path in a linked multimap; a change whose before path matches a bucket replaces the
 * oldest change there. Collisions ("new a" twice, "a→b" then "new b") give IntelliJ's "good enough" result: both stay.
 */
export function zipChanges(perCommitOldestFirst: FileChange[][]): FileChange[] {
  // key: after path (null for deletions); emptied buckets keep their key position, like MultiMap
  const map = new Map<string | null, FileChange[]>();
  const putValue = (key: string | null, c: FileChange) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(c);
    else map.set(key, [c]);
  };

  for (const changes of perCommitOldestFirst) {
    for (const change of changes) {
      const bRev = change.before;
      const aRev = change.after;
      // a copy keeps its source, so it does not continue the source's history
      if (bRev == null || change.status === "copied") {
        putValue(aRev?.path ?? null, change);
        continue;
      }
      const bucket = map.get(bRev.path);
      if (!bucket || bucket.length === 0) {
        putValue(aRev?.path ?? null, change);
        continue;
      }
      const oldChange = bucket.shift()!;
      const oldRevision = oldChange.before;
      if (oldRevision != null || aRev != null) putValue(aRev?.path ?? null, mergedChange(oldChange, oldRevision, aRev));
    }
  }

  // put deletions into appropriate place in list
  const deleted = map.get(null);
  if (deleted) {
    map.delete(null);
    for (const c of deleted) putValue(c.before!.path, c);
  }
  return [...map.values()].flat();
}
