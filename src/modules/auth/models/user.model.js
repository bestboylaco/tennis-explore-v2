import mongoose from "mongoose";

import {
    ROLE_IDS,
} from "../../../shared/constants/accessControl.js";

/*
 * The account behind a role.
 *
 * The role is resolved from the authenticated account rather than accepted
 * from request input. This prevents a browser from granting itself another
 * role simply by changing a request body.
 */
const userSchema =
    new mongoose.Schema(
        {
            email: {
                type:
                    String,

                required:
                    true,

                /*
                 * `unique: true` already creates the email index.
                 *
                 * Do not also call userSchema.index({ email: 1 }) below, otherwise
                 * Mongoose reports a duplicate schema-index warning.
                 */
                unique:
                    true,

                trim:
                    true,

                lowercase:
                    true,
            },

            /*
             * bcrypt hash only.
             *
             * The plaintext password is never stored, logged or returned.
             */
            passwordHash: {
                type:
                    String,

                required:
                    true,
            },

            displayName: {
                type:
                    String,

                required:
                    true,

                trim:
                    true,
            },

            roleId: {
                type:
                    String,

                required:
                    true,

                enum:
                    ROLE_IDS,
            },

            isActive: {
                type:
                    Boolean,

                default:
                    true,
            },
        },
        {
            timestamps:
                true,
        },
    );

/*
 * Deliberately no second email index here.
 *
 * The schema-level `unique: true` definition above is the single source of
 * truth for the unique email index.
 */

/*
 * Safe account representation returned after login/session validation.
 *
 * passwordHash is deliberately omitted.
 */
userSchema.methods.toSafeJSON =
    function toSafeJSON() {
        return {
            id:
                String(
                    this._id,
                ),

            email:
                this.email,

            displayName:
                this.displayName,

            roleId:
                this.roleId,
        };
    };

const User =
    mongoose.models.User ||
    mongoose.model(
        "User",
        userSchema,
    );

export default User;