import mongoose from "mongoose";

/**
 * One Quick Question displayed in the right-side Explore panel.
 *
 * title:
 * Short label shown on the card.
 *
 * description:
 * Small supporting text shown below the title.
 *
 * prompt:
 * The actual natural-language question copied into the AI Coach input.
 */
const quickQuestionItemSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 60,
        },

        description: {
            type: String,
            default: "",
            trim: true,
            maxlength: 120,
        },

        prompt: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
        },
    },
    {
        _id: false,
    },
);

/**
 * Stores one user's Quick Question configuration.
 *
 * userId comes from the authenticated session on the backend.
 * The frontend is never allowed to choose which user's settings
 * are being read or updated.
 */
const quickQuestionSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        quickQuestions: {
            type: [quickQuestionItemSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    },
);

export const QuickQuestion =
    mongoose.models.QuickQuestion ||
    mongoose.model(
        "QuickQuestion",
        quickQuestionSchema,
    );