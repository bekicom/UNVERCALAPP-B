import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    username: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "cashier"], default: "admin" }
  },
  { timestamps: true }
);

userSchema.index({ tenantId: 1, username: 1 }, { unique: true });

export const User = mongoose.model("User", userSchema);
