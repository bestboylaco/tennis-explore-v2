import mongoose from "mongoose";

import { ROLE_IDS } from "../../../shared/constants/accessControl.js";

// The account behind a role. Before this model existed, role was a request
// body field a caller could set to anything -- this is what closes that gap
// (threat model T-01): a session now has to resolve to one of these before
// any role-gated request runs at all.
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    // bcrypt hash only. The plaintext password is never stored, logged, or
    // returned -- see toSafeJSON below, and the same rule the threat model
    // already applies to telemetry: never write raw content this collection
    // doesn't need.
    passwordHash: { type: String, required: true },

    displayName: { type: String, required: true, trim: true },

    roleId: {
      type: String,
      required: true,
      enum: ROLE_IDS,
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

// The shape returned to a client after login/session-check. Never includes
// passwordHash -- a field added to the schema later still has to be added
// here explicitly to become visible, rather than leaking by default.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    email: this.email,
    displayName: this.displayName,
    roleId: this.roleId,
  };
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
