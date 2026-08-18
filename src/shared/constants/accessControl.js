// access control model for tennisexplore (TENISE-15 / E3-09).
//
// the whole model in one sentence: every chunk is tagged with WHAT KIND of data
// it is (domain) and HOW SENSITIVE it is (sensitivity) and WHICH PROGRAM it
// belongs to, and every person holds a role that grants a set of those. access
// is the intersection.
//
// why two axes and not one flat list of groups
// --------------------------------------------
// a single group list cannot express "a coach may see their squad's performance
// data, but not if it is classified restricted". with two axes you can. tennis
// australia's own information security policy already works this way -- it
// defines classification levels and requires need-to-know access authorised by
// the information owner -- so this mirrors the partner's governance instead of
// inventing a parallel one.
//
// how it is actually enforced
// ---------------------------
// evaluating a policy per document at query time would be far too slow. instead
// at INGEST time we flatten (domain, sensitivity, program) into a list of opaque
// grant strings on the chunk, in `acl_groups`. a role expands to the set of
// grant strings it holds. the filter is then a plain set-intersection test that
// runs BEFORE either retrieval arm produces a ranked list.
//
// this is why acl_groups has to exist in schema version 1 rather than being
// bolted on later: adding an indexed field after the corpus is embedded means
// re-embedding all of it.

// ---------------------------------------------------------------------------
// axis 1 -- what kind of data is this
// ---------------------------------------------------------------------------
export const DOMAINS = Object.freeze([
  "performance", // match results, rankings, shot data, hawk-eye
  "physiological", // wearables, training load, heart rate. monitoring, not clinical
  "clinical", // injury diagnosis, treatment notes, medical records
  "personal", // names, contact details, membership records (PII)
  "research", // published literature and internal research reports
  "administrative", // policies, scheduling, operational documents
]);

// ---------------------------------------------------------------------------
// axis 2 -- how sensitive is it.
// these four labels are taken from tennis australia's information security
// policy vocabulary rather than invented, so a reviewer can trace each one back
// to the partner's own document. order matters: index position is the ceiling.
// ---------------------------------------------------------------------------
export const SENSITIVITY_ORDER = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

export function sensitivityRank(level) {
  const rank = SENSITIVITY_ORDER.indexOf(level);

  if (rank === -1) {
    // an unknown sensitivity label must not quietly become "public".
    throw new Error(
      `unknown sensitivity ${JSON.stringify(level)}. known levels: ${SENSITIVITY_ORDER.join(", ")}`,
    );
  }

  return rank;
}

// ---------------------------------------------------------------------------
// axis 3 -- scoping. which program does this document belong to.
//
// this registry has to exist because the filter is exact string matching with
// no concept of a wildcard. a role that is NOT restricted to one program must
// be expanded into a grant for every program we know about, plus the NO_PROGRAM
// grant for documents that belong to no program at all (published research,
// policy documents).
//
// a note worth keeping: the first version of this model scoped by gender --
// squad-mens and squad-womens. that was wrong. gender is not an access
// boundary. a men's squad coach is not denied women's data because of gender,
// they are denied it because those athletes are not theirs. the real boundary in
// high performance sport is which program you work in, and scoping permissions
// by a protected attribute instead is both arbitrary and a bad look in a
// governance document.
//
// the program names come from the partner's own language (the perri papers
// reference the national academy program, the catapult deck discusses squad
// transitions). this axis is still the least certain part of the model --
// domain and sensitivity are traceable to the security policy, the program list
// is inferred. confirm it with the partner.
// ---------------------------------------------------------------------------
export const PROGRAMS = Object.freeze([
  "national-academy",
  "pro-tour",
  "junior-development",
  "wheelchair-program",
]);

export const NO_PROGRAM = "*";

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------
function defineRole({
  roleId,
  displayName,
  domains,
  maxSensitivity,
  programs = [],
  note = "",
}) {
  return Object.freeze({ roleId, displayName, domains, maxSensitivity, programs, note });
}

export const ROLES = Object.freeze({
  academy_coach: defineRole({
    roleId: "academy_coach",
    displayName: "National Academy Coach",
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "confidential",
    programs: ["national-academy"],
    note: "sees training load because that is performance monitoring, not clinical data",
  }),
  tour_coach: defineRole({
    roleId: "tour_coach",
    displayName: "Professional Tour Coach",
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "confidential",
    programs: ["pro-tour"],
    note: "same permissions as the academy coach, different athletes",
  }),
  analyst: defineRole({
    roleId: "analyst",
    displayName: "Performance Analyst",
    domains: ["performance", "research"],
    maxSensitivity: "internal",
    note:
      "deliberately has NO physiological access. this is the contrast case that " +
      "proves the filter actually works rather than merely existing",
  }),
  strength_conditioning: defineRole({
    roleId: "strength_conditioning",
    displayName: "Strength & Conditioning Coach",
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "confidential",
    note: "works across programs, so no program restriction",
  }),
  physiotherapist: defineRole({
    roleId: "physiotherapist",
    displayName: "Physiotherapist",
    domains: ["physiological", "clinical", "performance", "research"],
    maxSensitivity: "restricted",
    note: "the only role with clinical access",
  }),
  member_services: defineRole({
    roleId: "member_services",
    displayName: "Member Services Officer",
    // research is in this list for a reason worth writing down. the first draft
    // left it out on need-to-know grounds, and a test then caught that member
    // services could not read a published journal article -- one that anyone can
    // download from the publisher's website. refusing it inside the tool
    // protects nothing and just makes the assistant useless to that role. the
    // access boundary is the ATHLETE data, not the literature.
    domains: ["personal", "administrative", "research"],
    maxSensitivity: "confidential",
    note: "sees member contact details and published research, but no performance or medical data",
  }),
  athlete: defineRole({
    roleId: "athlete",
    displayName: "Athlete",
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "internal",
    note: "in production this would additionally be filtered to athlete_id == self",
  }),
  admin: defineRole({
    roleId: "admin",
    displayName: "Platform Administrator",
    domains: [...DOMAINS],
    maxSensitivity: "restricted",
    note: "sees everything. exists so the eval harness can measure the unfiltered ceiling",
  }),
});

/**
 * expands a role into the set of grant strings it holds.
 *
 * a grant string looks like `performance:internal:national-academy`. it is
 * deliberately opaque -- nothing downstream parses it, the filter only tests for
 * overlap, which keeps enforcement to one cheap set operation.
 */
export function grantsForRole(roleId) {
  const role = ROLES[roleId];

  if (!role) {
    // an unknown role raises instead of defaulting to anything. a system that
    // fails open on an unrecognised user is not an access control system.
    throw new Error(
      `unknown role ${JSON.stringify(roleId)}. known roles: ${Object.keys(ROLES).sort().join(", ")}`,
    );
  }

  const ceiling = sensitivityRank(role.maxSensitivity);

  // a role restricted to specific programs gets only those. a role with no
  // program restriction gets every program we know about.
  const programs = role.programs.length > 0 ? [...role.programs] : [...PROGRAMS];

  // every role also gets NO_PROGRAM, because research papers and policies are
  // tagged with it and would otherwise be unreachable by everyone.
  programs.push(NO_PROGRAM);

  const grants = new Set();

  for (const domain of role.domains) {
    // everything up to and including the ceiling: a confidential role also sees
    // public and internal.
    for (const level of SENSITIVITY_ORDER.slice(0, ceiling + 1)) {
      for (const program of programs) {
        grants.add(`${domain}:${level}:${program}`);
      }
    }
  }

  return grants;
}

/**
 * the ingest-time half of the model: turn a document's classification into the
 * acl_groups list that gets written onto every one of its chunks.
 *
 * a document produces exactly one grant string. it is not a list of things the
 * document can be -- it is the single label that says what it is.
 */
export function grantsForDocument({ domain, sensitivity, program = NO_PROGRAM }) {
  if (!DOMAINS.includes(domain)) {
    throw new Error(
      `unknown data domain ${JSON.stringify(domain)}. known domains: ${DOMAINS.join(", ")}`,
    );
  }

  // validates, and throws on a typo like "Public" or "secret".
  sensitivityRank(sensitivity);

  if (program !== NO_PROGRAM && !PROGRAMS.includes(program)) {
    throw new Error(
      `unknown program ${JSON.stringify(program)}. known programs: ${PROGRAMS.join(", ")}`,
    );
  }

  return [`${domain}:${sensitivity}:${program}`];
}

/**
 * the query-time test. one set intersection, nothing clever.
 */
export function isPermitted(chunkAclGroups, grants) {
  if (!Array.isArray(chunkAclGroups) || chunkAclGroups.length === 0) {
    // a chunk with no acl_groups is a bug in ingestion, not a public document.
    // treating it as public would mean any future ingestion bug silently opens
    // the corpus, so we treat it as unreachable instead.
    return false;
  }

  return chunkAclGroups.some((group) => grants.has(group));
}

export const ROLE_IDS = Object.freeze(Object.keys(ROLES).sort());
