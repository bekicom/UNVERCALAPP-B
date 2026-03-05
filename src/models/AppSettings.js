import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema(
  {
    lowStockThreshold: { type: Number, required: true, min: 0, default: 5 },
    keyboardEnabled: { type: Boolean, required: true, default: true },
    receipt: {
      title: { type: String, trim: true, default: "UY-DOKON CHEK" },
      footer: { type: String, trim: true, default: "Xaridingiz uchun rahmat!" },
      logoUrl: { type: String, trim: true, default: "" }
    }
  },
  { timestamps: true }
);

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);
