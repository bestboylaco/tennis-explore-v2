import session from "express-session";

import {
  buildKey,
  deleteItem,
  getItem,
  putItem,
  ttlAttributeName,
} from "../dynamodb/dynamoTable.service.js";

/*
 * TENISE-63: express-session store backed by the one DynamoDB table this
 * project has, replacing connect-mongo/ResilientMongoStore.
 *
 * connect-dynamodb (the closest off-the-shelf equivalent) was checked first
 * and rejected: its last release targets the aws-sdk v2 callback client, not
 * the v3 DocumentClient everything else here now uses, and it has had no
 * meaningful maintenance in years. A ~60-line store against the SDK we
 * already depend on is less risk than wiring in an unmaintained dependency.
 *
 * On the read-after-write retry wrapper (app.js's old ResilientMongoStore):
 * NOT carried over, and this was verified rather than assumed -- see
 * test/integration/dynamoSessionStore.test.js, which regenerates and reads a
 * session back-to-back many times in a tight loop against DynamoDB Local and
 * asserts zero "not found" reads. The Atlas M0 bug this worked around was
 * free-tier *replica* read lag: the primary accepted the write, but a read
 * could be served from a secondary that had not replicated it yet. DynamoDB
 * has no equivalent failure mode for a single region/table: GetItem supports
 * ConsistentRead, which reads from the leader storage replica and is
 * guaranteed to reflect all prior successful writes. get() below always sets
 * it. The trade-off is the standard one (consistent reads cost 2x the RCU of
 * eventually consistent ones, and are marginally slower) -- acceptable here
 * since a session read is one small item, not a table scan.
 *
 * What this store does NOT reproduce from DynamoDB's native TTL: AWS
 * documents TTL deletion as "usually within 48 hours" of expiry, not
 * immediate. A session a background sweep has not yet collected would
 * otherwise look valid indefinitely after its cookie expired, so get() also
 * checks the stored expiry itself and treats a logically-expired item as
 * absent -- the ttl attribute is there so DynamoDB eventually reclaims the
 * storage, not as the only expiry check.
 */

const ENTITY_TYPE = "SESSION";
const SESSION_SK = "SESSION";

function sessionPk(sid) {
  return `SESSION#${sid}`;
}

function resolveExpiresAtMs(sessionData, defaultTtlSeconds) {
  const cookieExpires = sessionData?.cookie?.expires;

  if (cookieExpires) {
    const parsed = new Date(cookieExpires).getTime();

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now() + defaultTtlSeconds * 1000;
}

export class DynamoSessionStore extends session.Store {
  constructor({ ttlSeconds = 8 * 60 * 60 } = {}) {
    super();
    this.defaultTtlSeconds = ttlSeconds;
  }

  get(sid, callback) {
    getItem(sessionPk(sid), SESSION_SK, { consistentRead: true })
      .then((item) => {
        if (!item) {
          return callback(null, undefined);
        }

        if (typeof item.expiresAtMs === "number" && item.expiresAtMs <= Date.now()) {
          // Logically expired but not yet swept by DynamoDB's background TTL
          // deletion -- see the class comment. Treated as absent, same as a
          // real miss.
          return callback(null, undefined);
        }

        try {
          return callback(null, JSON.parse(item.data));
        } catch (error) {
          return callback(error);
        }
      })
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback) {
    const expiresAtMs = resolveExpiresAtMs(sessionData, this.defaultTtlSeconds);

    const item = {
      ...buildKey(sessionPk(sid), SESSION_SK),
      entityType: ENTITY_TYPE,
      sid,
      data: JSON.stringify(sessionData),
      expiresAtMs,
      [ttlAttributeName()]: Math.floor(expiresAtMs / 1000),
    };

    putItem(item)
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  // express-session calls touch() on every request to slide an idle
  // expiry forward without rewriting the session body; a plain set() does
  // that (and more) correctly, just with one extra attribute write.
  touch(sid, sessionData, callback) {
    this.set(sid, sessionData, callback);
  }

  destroy(sid, callback) {
    deleteItem(sessionPk(sid), SESSION_SK)
      .then(() => callback(null))
      .catch((error) => callback(error));
  }
}
