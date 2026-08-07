import { qdrantClient } from "../../config/qdrant.client.js";

/**
 * Ensure a Qdrant collection exists.
 *
 * @param {string} collectionName
 * @param {number} dimensions
 *
 * @returns {Promise<{
 *   collectionName: string,
 *   created: boolean
 * }>}
 */
export async function ensureVectorCollection(
  collectionName,
  dimensions
) {
  if (
    typeof collectionName !== "string" ||
    collectionName.trim().length === 0
  ) {
    throw new TypeError(
      "Collection name must be a non-empty string."
    );
  }

  if (
    !Number.isInteger(dimensions) ||
    dimensions <= 0
  ) {
    throw new TypeError(
      "Vector dimensions must be a positive integer."
    );
  }

  const normalisedCollectionName =
    collectionName.trim();

  try {
    const collections =
      await qdrantClient.getCollections();

    const exists =
      Array.isArray(collections?.collections) &&
      collections.collections.some(
        (collection) =>
          collection.name === normalisedCollectionName
      );

    if (exists) {
      return {
        collectionName: normalisedCollectionName,
        created: false,
      };
    }

    await qdrantClient.createCollection(
      normalisedCollectionName,
      {
        vectors: {
          size: dimensions,
          distance: "Cosine",
        },
      }
    );

    console.log(
      `✅ Created Qdrant collection "${normalisedCollectionName}".`
    );

    return {
      collectionName: normalisedCollectionName,
      created: true,
    };
  } catch (error) {
    throw new Error(
      `Failed to ensure Qdrant collection "${normalisedCollectionName}": ${
        error instanceof Error
          ? error.message
          : "Unknown Qdrant error."
      }`,
      {
        cause: error,
      }
    );
  }
}

/**
 * Store vector points in Qdrant.
 *
 * @param {string} collectionName
 * @param {import("../../modules/ingestion/vector/vector.types.js").VectorPoint[]} points
 *
 * @returns {Promise<{
 *   collectionName: string,
 *   totalRequested: number,
 *   totalStored: number
 * }>}
 */
export async function storeVectorPoints(
  collectionName,
  points
) {
  if (
    typeof collectionName !== "string" ||
    collectionName.trim().length === 0
  ) {
    throw new TypeError(
      "Collection name must be a non-empty string."
    );
  }

  if (!Array.isArray(points)) {
    throw new TypeError(
      "Points must be an array."
    );
  }

  const normalisedCollectionName =
    collectionName.trim();

  if (points.length === 0) {
    return {
      collectionName:
        normalisedCollectionName,

      totalRequested: 0,

      totalStored: 0,
    };
  }

  const containsInvalidPoint =
    points.some(
      (point) =>
        !point ||
        typeof point !== "object" ||
        !point.id ||
        !Array.isArray(point.vector)
    );

  if (containsInvalidPoint) {
    throw new TypeError(
      "Every vector point must contain an id and vector array."
    );
  }

  try {
    await qdrantClient.upsert(
      normalisedCollectionName,
      {
        wait: true,
        points,
      }
    );

    return {
      collectionName:
        normalisedCollectionName,

      totalRequested:
        points.length,

      totalStored:
        points.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to store ${points.length} vector points in Qdrant collection "${normalisedCollectionName}": ${
        error instanceof Error
          ? error.message
          : "Unknown Qdrant error."
      }`,
      {
        cause: error,
      }
    );
  }
}

/**
 * Search Qdrant for vector points similar to a query vector.
 *
 * @param {Object} options
 * @param {string} options.collectionName
 * @param {number[]} options.queryVector
 * @param {number} [options.limit=5]
 * @param {string[]} [options.sourceTypes=[]]
 *
 * @returns {Promise<Object[]>}
 */
export async function searchVectorPoints({
  collectionName,
  queryVector,
  limit = 5,
  sourceTypes = [],
} = {}) {
  if (
    typeof collectionName !== "string" ||
    collectionName.trim().length === 0
  ) {
    throw new TypeError(
      "Collection name must be a non-empty string."
    );
  }

  if (
    !Array.isArray(queryVector) ||
    queryVector.length === 0
  ) {
    throw new TypeError(
      "Query vector must be a non-empty array."
    );
  }

  if (
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new TypeError(
      "Search limit must be a positive integer."
    );
  }

  if (!Array.isArray(sourceTypes)) {
    throw new TypeError(
      "Source types must be an array."
    );
  }

  const hasInvalidSourceType =
    sourceTypes.some(
      (sourceType) =>
        typeof sourceType !== "string" ||
        sourceType.trim().length === 0
    );

  if (hasInvalidSourceType) {
    throw new TypeError(
      "Every source type must be a non-empty string."
    );
  }

  const normalisedCollectionName =
    collectionName.trim();

  const normalisedSourceTypes =
    sourceTypes.map(
      (sourceType) =>
        sourceType.trim()
    );

  const searchRequest = {
    vector: queryVector,
    limit,
    with_payload: true,
    with_vector: false,
  };

  if (
    normalisedSourceTypes.length > 0
  ) {
    searchRequest.filter = {
      must: [
        {
          key: "sourceType",
          match: {
            any:
              normalisedSourceTypes,
          },
        },
      ],
    };
  }

  try {
    const results =
      await qdrantClient.search(
        normalisedCollectionName,
        searchRequest
      );

    return Array.isArray(results)
      ? results
      : [];
  } catch (error) {
    throw new Error(
      `Failed to search Qdrant collection "${normalisedCollectionName}": ${
        error instanceof Error
          ? error.message
          : "Unknown Qdrant error."
      }`,
      {
        cause: error,
      }
    );
  }
}