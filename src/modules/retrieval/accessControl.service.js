// query-time access enforcement.
//
// there are exactly two things in here: build a predicate from a role, and
// assert afterwards that the predicate actually ran. the second one sounds
// redundant. it is not -- it is the check that catches a future refactor
// dropping the filter, which is the failure mode that matters, because a missing
// filter produces a perfectly plausible answer built on data the caller should
// never have seen.

import { grantsForRole, isPermitted } from "../../shared/constants/accessControl.js";

/**
 * turns a role id into a fast predicate over chunks.
 *
 * the grant set is built once per query, not once per chunk. resolving the role
 * inside the scoring loop would mean rebuilding a twenty-element set seven
 * thousand times.
 */
export function buildAccessFilter(roleId) {
  const grants = grantsForRole(roleId);

  return {
    roleId,
    grants,
    // used by the vector store, which has the chunk object to hand.
    isChunkAllowed: (chunk) => isPermitted(chunk.acl_groups, grants),
    // used by bm25, which works in positional indexes.
    isIndexAllowed: (chunks) => (index) => isPermitted(chunks[index]?.acl_groups, grants),
  };
}

/**
 * defensive check, run after fusion and before anything reaches the model.
 *
 * this throws instead of quietly dropping the offending chunk. dropping it would
 * hide the bug and still return an answer that looks fine, and a silent
 * access-control failure is the worst possible outcome here -- nobody would ever
 * find out. a loud crash in development is cheap; a leak in front of the partner
 * is not.
 */
export function assertAccessInvariant(candidates, filter) {
  for (const candidate of candidates) {
    const groups = candidate.acl_groups ?? [];

    if (groups.length === 0) {
      throw new Error(
        `chunk ${candidate.chunk_id} carries no acl_groups. every indexed chunk ` +
          `must carry one, or the filter has nothing to match against.`,
      );
    }

    if (!isPermitted(groups, filter.grants)) {
      throw new Error(
        `access invariant violated: chunk ${candidate.chunk_id} ` +
          `(groups ${groups.join(", ")}) reached fusion for role "${filter.roleId}". ` +
          `the pre-filter on one of the retrieval arms did not run.`,
      );
    }
  }

  return candidates;
}
