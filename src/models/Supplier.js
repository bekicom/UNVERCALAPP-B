import mongoose from "mongoose";

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    address: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true }
  },
  { timestamps: true }
);

export const Supplier = mongoose.model("Supplier", supplierSchema);