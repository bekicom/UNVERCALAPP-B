import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { initDb } from "./db.js";
import { initDisplayHub } from "./displayHub.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import salesRoutes from "./routes/salesRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import masterRoutes from "./routes/masterRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import shiftRoutes from "./routes/shiftRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import { startSuperAdminBot } from "./bot/superAdminBot.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const app = express();
const port = process.env.PORT || 4000;
const server = createServer(app);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/masters", masterRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/warehouses", warehouseRoutes);

initDb().then(() => {
  initDisplayHub(server);
  server.listen(port, () => {
    console.log(`API is running on http://localhost:${port}`);
  });
  startSuperAdminBot();
});
