import mongoose from "mongoose";

const warehouseSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["asosiy", "kichik"],
      required: true
    },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

warehouseSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const Warehouse = mongoose.model("Warehouse", warehouseSchema);
