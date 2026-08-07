import { EXPECTED_VECTOR_DIMENSIONS } from "./vector.types.js";

/**
 * Validates one Qdrant-ready vector point.
 *
 * Ordinary validation failures are returned as structured errors
 * instead of being thrown.
 *
 * @param {Object} point
 * @returns {{
 *   isValid: boolean,
 *   dimensions: number,
 *   warnings: string[],
 *   errors: string[]
 * }}
 */
export function validateVectorPoint(point) {
    const warnings = [];
    const errors = [];

    if (!point || typeof point !== "object") {
        return {
            isValid: false,
            dimensions: 0,
            warnings,
            errors: ["Vector point must be a valid object."]
        };
    }

    if (
        point.id === undefined ||
        point.id === null ||
        String(point.id).trim() === ""
    ) {
        errors.push("Vector point id is required.");
    }

    const vector = point.vector;

    if (!Array.isArray(vector)) {
        errors.push("Vector must be an array.");
    }

    const dimensions = Array.isArray(vector) ? vector.length : 0;

    if (
        Array.isArray(vector) &&
        dimensions !== EXPECTED_VECTOR_DIMENSIONS
    ) {
        errors.push(
            `Vector must contain ${EXPECTED_VECTOR_DIMENSIONS} dimensions, but received ${dimensions}.`
        );
    }

    if (
        Array.isArray(vector) &&
        vector.some((value) => !Number.isFinite(value))
    ) {
        errors.push("Vector contains a non-finite numeric value.");
    }

    if (
        Array.isArray(vector) &&
        vector.length > 0 &&
        vector.every((value) => value === 0)
    ) {
        warnings.push("Vector contains only zero values.");
    }

    const payload = point.payload;

    if (!payload || typeof payload !== "object") {
        errors.push("Vector payload is required.");
    } else {
        if (
            payload.sourceId === undefined ||
            payload.sourceId === null ||
            String(payload.sourceId).trim() === ""
        ) {
            errors.push("Vector payload sourceId is required.");
        }

        if (
            typeof payload.text !== "string" ||
            payload.text.trim() === ""
        ) {
            errors.push("Vector payload text is required.");
        }

        if (
            !Number.isInteger(payload.chunkIndex) ||
            payload.chunkIndex < 0
        ) {
            errors.push(
                "Vector payload chunkIndex must be a non-negative integer."
            );
        }

        if (
            !payload.documentTitle ||
            String(payload.documentTitle).trim() === ""
        ) {
            warnings.push("Vector payload documentTitle is missing.");
        }

        if (
            !payload.sectionTitle ||
            String(payload.sectionTitle).trim() === ""
        ) {
            warnings.push("Vector payload sectionTitle is missing.");
        }

        if (
            !payload.sourceType ||
            String(payload.sourceType).trim() === ""
        ) {
            warnings.push("Vector payload sourceType is missing.");
        }
    }

    return {
        isValid: errors.length === 0,
        dimensions,
        warnings,
        errors
    };
}

/**
 * Validates a collection of vector points.
 *
 * Valid points and rejected points are returned separately so that
 * the ingestion pipeline can continue processing valid chunks.
 *
 * @param {Object[]} points
 * @returns {{
 *   isValid: boolean,
 *   totalRequested: number,
 *   totalValid: number,
 *   totalRejected: number,
 *   validPoints: Object[],
 *   rejectedPoints: Array<{
 *     point: Object,
 *     index: number,
 *     validation: Object
 *   }>
 * }}
 */
export function validateVectorPoints(points) {
    if (!Array.isArray(points)) {
        return {
            isValid: false,
            totalRequested: 0,
            totalValid: 0,
            totalRejected: 0,
            validPoints: [],
            rejectedPoints: [
                {
                    point: points,
                    index: -1,
                    validation: {
                        isValid: false,
                        dimensions: 0,
                        warnings: [],
                        errors: ["Vector points must be provided as an array."]
                    }
                }
            ]
        };
    }

    const validPoints = [];
    const rejectedPoints = [];

    points.forEach((point, index) => {
        const validation = validateVectorPoint(point);

        if (validation.isValid) {
            validPoints.push(point);
            return;
        }

        rejectedPoints.push({
            point,
            index,
            validation
        });
    });

    return {
        isValid: rejectedPoints.length === 0,
        totalRequested: points.length,
        totalValid: validPoints.length,
        totalRejected: rejectedPoints.length,
        validPoints,
        rejectedPoints
    };
}