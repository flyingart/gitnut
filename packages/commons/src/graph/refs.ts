// Ported from IntelliJ IDEA Community Edition: plugins/git4idea/backend/src/log/GitRefManager.kt (GitBranchLayoutComparator,
// GitRefComparator), platform/vcs-log/impl/src/com/intellij/vcs/log/graph/HeadCommitsComparator.java,
// platform/vcs-log/impl/src/com/intellij/vcs/log/data/RefsModel.kt (getRefForHeadCommit),
// platform/util/base/src/com/intellij/openapi/util/text/NaturalComparator.java (GitReference.REFS_NAMES_COMPARATOR), Apache-2.0.

import type { RefInfo } from "../protocol";

const enumOrder = <T extends string>(...values: T[]) => Object.fromEntries(values.map((v, i) => [v, i])) as Record<T, number>;

type RefType = "HEAD" | "CURRENT_BRANCH" | "TAG" | "LOCAL_BRANCH" | "MASTER" | "REMOTE_BRANCH" | "ORIGIN_MASTER" | "OTHER";

/**
 * GitBranchLayoutComparator.orderedTypes: the left-most branches of the graph. Note IntelliJ puts origin/master and other
 * remote branches first and HEAD last; CURRENT_BRANCH is never produced by this comparator (only by the labels one).
 */
const BRANCH_LAYOUT_ORDER = enumOrder<RefType>(
  "ORIGIN_MASTER",
  "REMOTE_BRANCH",
  "MASTER",
  "LOCAL_BRANCH",
  "TAG",
  "CURRENT_BRANCH",
  "HEAD",
  "OTHER",
);

function refType(ref: RefInfo): RefType {
  switch (ref.kind) {
    case "head":
      return "HEAD";
    case "tag":
      return "TAG";
    case "local":
      return ref.name === "master" || ref.name === "main" ? "MASTER" : "LOCAL_BRANCH";
    case "remote":
      return ref.name === "origin/master" || ref.name === "origin/main" ? "ORIGIN_MASTER" : "REMOTE_BRANCH";
    default:
      return "OTHER";
  }
}

const isDecimalDigit = (c: string) => c >= "0" && c <= "9";

/** StringUtilRt.compare(char, char, ignoreCase) */
function compareCharsRt(c1: string, c2: string, ignoreCase: boolean): number {
  let d = c1.charCodeAt(0) - c2.charCodeAt(0);
  if (d === 0 || !ignoreCase) return d;
  const u1 = c1.toUpperCase();
  const u2 = c2.toUpperCase();
  d = u1.charCodeAt(0) - u2.charCodeAt(0);
  if (d !== 0) d = u1.toLowerCase().charCodeAt(0) - u2.toLowerCase().charCodeAt(0);
  return d;
}

function compareChars(ch1: string, ch2: string, ignoreCase: boolean): number {
  // transitivity fix, otherwise can fail when comparing strings with characters between ' ' and '0' (e.g. '#')
  if (ch1 === " " && ch2 > " " && ch2 < "0") return 1;
  if (ch2 === " " && ch1 > " " && ch1 < "0") return -1;
  return compareCharsRt(ch1, ch2, ignoreCase);
}

const skipDigits = (s: string, start: number, end: number) => {
  while (start < end && isDecimalDigit(s[start])) start++;
  return start;
};
const skipChar = (s: string, start: number, end: number, c: string) => {
  while (start < end && s[start] === c) start++;
  return start;
};
const compareCharRange = (s1: string, s2: string, offset1: number, offset2: number, end1: number) => {
  for (let i = offset1, j = offset2; i < end1; i++, j++) {
    const diff = s1.charCodeAt(i) - s2.charCodeAt(j);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** NaturalComparator.INSTANCE ("Sorting for Humans"): case-insensitive, numbers compared by value. */
export function naturalCompare(s1: string, s2: string, ignoreCase = true): number {
  const length1 = s1.length;
  const length2 = s2.length;
  let i = 0;
  let j = 0;
  for (; i < length1 && j < length2; i++, j++) {
    const ch1 = s1[i];
    const ch2 = s2[j];
    if ((isDecimalDigit(ch1) || ch1 === " ") && (isDecimalDigit(ch2) || ch2 === " ")) {
      const start1 = skipChar(s1, skipChar(s1, i, length1, " "), length1, "0");
      const start2 = skipChar(s2, skipChar(s2, j, length2, " "), length2, "0");
      const end1 = skipDigits(s1, start1, length1);
      const end2 = skipDigits(s2, start2, length2);
      // numbers with more digits are always greater than shorter numbers
      const lengthDiff = end1 - start1 - (end2 - start2);
      if (lengthDiff !== 0) return lengthDiff;
      const numberDiff = compareCharRange(s1, s2, start1, start2, end1);
      if (numberDiff !== 0) return numberDiff;
      const fullLengthDiff = end1 - i - (end2 - j);
      if (fullLengthDiff !== 0) return fullLengthDiff;
      const leadingDiff = compareCharRange(s1, s2, i, j, start1);
      if (leadingDiff !== 0) return leadingDiff;
      i = end1 - 1;
      j = end2 - 1;
    } else {
      const diff = compareChars(ch1, ch2, ignoreCase);
      if (diff !== 0) return diff;
    }
  }
  if (i < length1) return 1;
  if (j < length2) return -1;
  if (length1 !== length2) return length1 - length2;
  return ignoreCase ? naturalCompare(s1, s2, false) : 0;
}

/** GitRefManager.getBranchLayoutComparator() */
export function compareRefsForLayout(ref1: RefInfo, ref2: RefInfo): number {
  const p = BRANCH_LAYOUT_ORDER[refType(ref1)] - BRANCH_LAYOUT_ORDER[refType(ref2)];
  return p !== 0 ? p : naturalCompare(ref1.name, ref2.name);
}

/** RefsModel.getRefForHeadCommit: the best ref of each commit by the branch layout comparator. */
export function bestRefPerCommit(refs: readonly RefInfo[]): Map<number, RefInfo> {
  const best = new Map<number, RefInfo>();
  for (const ref of refs) {
    const cur = best.get(ref.commit);
    if (!cur || compareRefsForLayout(ref, cur) < 0) best.set(ref.commit, ref);
  }
  return best;
}

/**
 * Commits with refs ordered by HeadCommitsComparator (their best refs by GitBranchLayoutComparator). Earlier heads are
 * laid out further left and keep their colour below fork points.
 */
export function sortHeadsForLayout(refs: readonly RefInfo[]): number[] {
  return [...bestRefPerCommit(refs).entries()].sort(([c1, r1], [c2, r2]) => compareRefsForLayout(r1, r2) || c1 - c2).map(([c]) => c);
}

/** RefsModel.branches: commits of branch refs (VcsRefType.isBranch: HEAD, local and remote branches, not tags). */
export function branchCommits(refs: readonly RefInfo[]): number[] {
  return [...new Set(refs.filter((r) => r.kind !== "tag").map((r) => r.commit))];
}
