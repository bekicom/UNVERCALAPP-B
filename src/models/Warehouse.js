import mongoose from "mongoose";

const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: {
      type: String,
      enum: ["asosiy", "kichik"],
      required: true
    },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

export const Warehouse = mongoose.model("Warehouse", warehouseSchema);