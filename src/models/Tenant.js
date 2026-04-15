import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true }
);

export const Tenant = mongoose.model("Tenant", tenantSchema);
