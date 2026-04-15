import bcrypt from "bcryptjs";
import TelegramBot from "node-telegram-bot-api";
import { Tenant } from "../models/Tenant.js";
import { User } from "../models/User.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { Purchase } from "../models/Purchase.js";
import { Sale } from "../models/Sale.js";
import { Customer } from "../models/Customer.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { Supplier } from "../models/Supplier.js";
import { SupplierPayment } from "../models/SupplierPayment.js";
import { Expense } from "../models/Expense.js";
import { Warehouse } from "../models/Warehouse.js";
import { AppSettings } from "../models/AppSettings.js";

const ROLES = new Set(["admin", "cashier"]);
const BTN = {
  TENANTS: "🏢 Tenantlar",
  CREATE_TENANT: "➕ Tenant yaratish",
  CREATE_ADMIN: "👤 Admin yaratish",
  LIST_ADMINS: "📋 Adminlar ro'yxati",
  DISABLE_TENANT: "⛔ Tenant bloklash",
  ENABLE_TENANT: "✅ Tenant yoqish",
  DELETE_TENANT: "🗑 Tenant o'chirish",
  HELP: "ℹ️ Yordam",
  MENU: "🏠 Menu",
};

function menuMarkup() {
  return {
    keyboard: [
      [BTN.TENANTS, BTN.CREATE_TENANT],
      [BTN.CREATE_ADMIN, BTN.LIST_ADMINS],
      [BTN.DISABLE_TENANT, BTN.ENABLE_TENANT],
      [BTN.DELETE_TENANT],
      [BTN.HELP, BTN.MENU],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function sendMainMenu(bot, chatId, text = "Amalni tanlang:") {
  await bot.sendMessage(chatId, text, { reply_markup: menuMarkup() });
}

function panelText() {
  return [
    "🛠 SUPER ADMIN PANEL",
    "",
    "Pastdagi tugmalardan foydalaning:",
    "• Tenant yaratish / boshqarish",
    "• Admin yaratish / ko'rish",
    "• Tenantni bloklash yoki yoqish",
    "",
    "Bekor qilish: /cancel",
  ].join("\n");
}

function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseArgs(text) {
  const body = String(text || "").trim();
  const firstSpace = body.indexOf(" ");
  if (firstSpace < 0) return [];
  return body
    .slice(firstSpace + 1)
    .split("|")
    .map((p) => p.trim());
}

function helpText() {
  return [
    "ℹ️ Yordam",
    "Asosan pastdagi tugmalar bilan ishlang.",
    "",
    "Qo'shimcha buyruqlar:",
    "/myid",
    "/cancel (joriy jarayonni bekor qilish)",
    "/help",
  ].join("\n");
}

async function tenantBySlug(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;
  return Tenant.findOne({ slug });
}

function canUseBot(msg, allowedIds) {
  const id = String(msg?.from?.id || "");
  if (!id) return false;
  return allowedIds.has(id);
}

async function listTenants(bot, chatId) {
  const tenants = await Tenant.find().sort({ createdAt: 1 }).lean();
  if (tenants.length < 1) {
    await bot.sendMessage(chatId, "Tenantlar topilmadi.");
    return;
  }
  const text = tenants
    .map((t, i) => `${i + 1}. ${t.isActive ? "🟢" : "🔴"} ${t.slug} | ${t.name}`)
    .join("\n");
  await bot.sendMessage(chatId, `🏢 Tenantlar ro'yxati\n\n${text}`);
}

async function createTenant(bot, chatId, args) {
  const [slugRaw, nameRaw] = args;
  const slug = normalizeSlug(slugRaw);
  const name = String(nameRaw || "").trim();
  if (!slug || !name) {
    await bot.sendMessage(chatId, "Format: /create_tenant slug|Nomi");
    return;
  }

  const exists = await Tenant.exists({ slug });
  if (exists) {
    await bot.sendMessage(chatId, "Bu slug band.");
    return;
  }

  const tenant = await Tenant.create({ slug, name, isActive: true });
  await AppSettings.create({ tenantId: tenant._id });
  await bot.sendMessage(chatId, `✅ Tenant yaratildi\n\n🏢 ${tenant.name}\n🔹 slug: ${tenant.slug}`);
}

async function editTenant(bot, chatId, args) {
  const [slugRaw, newNameRaw, activeRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  if (!tenant) {
    await bot.sendMessage(chatId, "Tenant topilmadi.");
    return;
  }

  const newName = String(newNameRaw || "").trim();
  if (newName) tenant.name = newName;
  if (activeRaw != null && String(activeRaw).trim() !== "") {
    const v = String(activeRaw).trim().toLowerCase();
    tenant.isActive = v === "1" || v === "true" || v === "active" || v === "yes";
  }
  await tenant.save();
  await bot.sendMessage(chatId, `✅ Tenant yangilandi\n\n🏢 ${tenant.name}\n🔹 slug: ${tenant.slug}\n🔸 holat: ${tenant.isActive ? "active" : "inactive"}`);
}

async function setTenantStatus(bot, chatId, args, isActive) {
  const [slugRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  if (!tenant) {
    await bot.sendMessage(chatId, "Tenant topilmadi.");
    return;
  }
  tenant.isActive = isActive;
  await tenant.save();
  await bot.sendMessage(chatId, `${isActive ? "✅" : "⛔"} ${tenant.slug} => ${isActive ? "active" : "inactive"}`);
}

async function deleteTenant(bot, chatId, args) {
  const [slugRaw, forceRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  if (!tenant) {
    await bot.sendMessage(chatId, "Tenant topilmadi.");
    return;
  }

  const force = String(forceRaw || "").trim().toLowerCase() === "yes";
  const tid = tenant._id;
  const [users, categories, suppliers, products, purchases, sales, customers, customerPayments, supplierPayments, expenses, warehouses] = await Promise.all([
    User.countDocuments({ tenantId: tid }),
    Category.countDocuments({ tenantId: tid }),
    Supplier.countDocuments({ tenantId: tid }),
    Product.countDocuments({ tenantId: tid }),
    Purchase.countDocuments({ tenantId: tid }),
    Sale.countDocuments({ tenantId: tid }),
    Customer.countDocuments({ tenantId: tid }),
    CustomerPayment.countDocuments({ tenantId: tid }),
    SupplierPayment.countDocuments({ tenantId: tid }),
    Expense.countDocuments({ tenantId: tid }),
    Warehouse.countDocuments({ tenantId: tid }),
  ]);

  const totalData = categories + suppliers + products + purchases + sales + customers + customerPayments + supplierPayments + expenses + warehouses;
  if (!force && (users > 0 || totalData > 0)) {
    await bot.sendMessage(
      chatId,
      `Tenant ichida ma'lumot bor.\nUsers=${users}, Data=${totalData}\nAgar o'chirish aniq bo'lsa: /delete_tenant ${tenant.slug}|yes`,
    );
    return;
  }

  await Promise.all([
    User.deleteMany({ tenantId: tid }),
    Category.deleteMany({ tenantId: tid }),
    Supplier.deleteMany({ tenantId: tid }),
    Product.deleteMany({ tenantId: tid }),
    Purchase.deleteMany({ tenantId: tid }),
    Sale.deleteMany({ tenantId: tid }),
    Customer.deleteMany({ tenantId: tid }),
    CustomerPayment.deleteMany({ tenantId: tid }),
    SupplierPayment.deleteMany({ tenantId: tid }),
    Expense.deleteMany({ tenantId: tid }),
    Warehouse.deleteMany({ tenantId: tid }),
    AppSettings.deleteMany({ tenantId: tid }),
  ]);
  await Tenant.deleteOne({ _id: tid });
  await bot.sendMessage(chatId, `🗑 Tenant o'chirildi: ${tenant.slug}`);
}

async function listAdmins(bot, chatId, args) {
  const [slugRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  if (!tenant) {
    await bot.sendMessage(chatId, "Tenant topilmadi.");
    return;
  }

  const users = await User.find({ tenantId: tenant._id }).select("username role createdAt").sort({ createdAt: 1 }).lean();
  if (users.length < 1) {
    await bot.sendMessage(chatId, "Foydalanuvchi topilmadi.");
    return;
  }

  const text = users.map((u, i) => `${i + 1}. ${u.username} (${u.role})`).join("\n");
  await bot.sendMessage(chatId, `📋 ${tenant.slug} userlar:\n\n${text}`);
}

async function createAdmin(bot, chatId, args) {
  const [slugRaw, usernameRaw, passwordRaw, roleRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  const username = String(usernameRaw || "").trim();
  const password = String(passwordRaw || "");
  const role = String(roleRaw || "admin").trim().toLowerCase();

  if (!tenant) {
    await bot.sendMessage(chatId, "Tenant topilmadi.");
    return;
  }
  if (!username || !password) {
    await bot.sendMessage(chatId, "Format: /create_admin slug|username|password|role");
    return;
  }
  if (password.length < 4) {
    await bot.sendMessage(chatId, "Parol kamida 4 ta belgi bo'lishi kerak.");
    return;
  }
  if (!ROLES.has(role)) {
    await bot.sendMessage(chatId, "Role faqat admin yoki cashier bo'lishi kerak.");
    return;
  }

  const exists = await User.exists({ tenantId: tenant._id, username });
  if (exists) {
    await bot.sendMessage(chatId, "Bu username shu tenantda band.");
    return;
  }

  await User.create({
    tenantId: tenant._id,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
  });
  await bot.sendMessage(chatId, `✅ User yaratildi\n\n🏢 ${tenant.slug}\n👤 ${username}\n🔸 ${role}`);
}

async function editAdmin(bot, chatId, args) {
  const [slugRaw, usernameRaw, newUsernameRaw, newPasswordRaw, roleRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  const username = String(usernameRaw || "").trim();
  if (!tenant || !username) {
    await bot.sendMessage(chatId, "Format: /edit_admin slug|username|newUsername(-)|newPassword(-)|role(admin/cashier/-)");
    return;
  }

  const user = await User.findOne({ tenantId: tenant._id, username });
  if (!user) {
    await bot.sendMessage(chatId, "User topilmadi.");
    return;
  }

  const newUsername = String(newUsernameRaw || "").trim();
  const newPassword = String(newPasswordRaw || "");
  const role = String(roleRaw || "").trim().toLowerCase();

  if (newUsername && newUsername !== "-") {
    const duplicate = await User.exists({ tenantId: tenant._id, username: newUsername, _id: { $ne: user._id } });
    if (duplicate) {
      await bot.sendMessage(chatId, "Yangi username band.");
      return;
    }
    user.username = newUsername;
  }

  if (newPassword && newPassword !== "-") {
    if (newPassword.length < 4) {
      await bot.sendMessage(chatId, "Yangi parol kamida 4 ta belgi bo'lishi kerak.");
      return;
    }
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
  }

  if (role && role !== "-") {
    if (!ROLES.has(role)) {
      await bot.sendMessage(chatId, "Role faqat admin yoki cashier bo'lishi kerak.");
      return;
    }
    if (user.role === "admin" && role !== "admin") {
      const adminCount = await User.countDocuments({ tenantId: tenant._id, role: "admin", _id: { $ne: user._id } });
      if (adminCount < 1) {
        await bot.sendMessage(chatId, "Kamida bitta admin qolishi kerak.");
        return;
      }
    }
    user.role = role;
  }

  await user.save();
  await bot.sendMessage(chatId, `✅ User yangilandi\n\n🏢 ${tenant.slug}\n👤 ${user.username}\n🔸 ${user.role}`);
}

async function deleteAdmin(bot, chatId, args) {
  const [slugRaw, usernameRaw] = args;
  const tenant = await tenantBySlug(slugRaw);
  const username = String(usernameRaw || "").trim();
  if (!tenant || !username) {
    await bot.sendMessage(chatId, "Format: /delete_admin slug|username");
    return;
  }

  const user = await User.findOne({ tenantId: tenant._id, username });
  if (!user) {
    await bot.sendMessage(chatId, "User topilmadi.");
    return;
  }

  if (user.role === "admin") {
    const adminCount = await User.countDocuments({ tenantId: tenant._id, role: "admin", _id: { $ne: user._id } });
    if (adminCount < 1) {
      await bot.sendMessage(chatId, "Bu oxirgi admin, o'chirib bo'lmaydi.");
      return;
    }
  }

  await User.deleteOne({ _id: user._id });
  await bot.sendMessage(chatId, `🗑 User o'chirildi: ${tenant.slug} -> ${username}`);
}

export function startSuperAdminBot() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    console.log("Telegram bot: TELEGRAM_BOT_TOKEN topilmadi, bot o'chirilgan.");
    return null;
  }

  const allowedIds = new Set(parseList(process.env.SUPERADMIN_TELEGRAM_IDS));
  if (allowedIds.size < 1) {
    console.log("Telegram bot: SUPERADMIN_TELEGRAM_IDS bo'sh, bot buyruqlari bloklangan.");
  }

  const bot = new TelegramBot(token, { polling: true });
  const sessions = new Map();
  bot.setMyCommands([
    { command: "myid", description: "Telegram ID ko'rish" },
    { command: "help", description: "Yordam" },
    { command: "list_tenants", description: "Tenantlar ro'yxati" },
    { command: "create_tenant", description: "Tenant yaratish" },
    { command: "edit_tenant", description: "Tenantni tahrirlash" },
    { command: "disable_tenant", description: "Tenantni bloklash" },
    { command: "enable_tenant", description: "Tenantni yoqish" },
    { command: "delete_tenant", description: "Tenantni o'chirish" },
    { command: "list_admins", description: "Tenant userlari" },
    { command: "create_admin", description: "User yaratish" },
    { command: "edit_admin", description: "Userni tahrirlash" },
    { command: "delete_admin", description: "Userni o'chirish" },
  ]).catch(() => {});

  function setSession(chatId, state) {
    sessions.set(String(chatId), state);
  }

  function getSession(chatId) {
    return sessions.get(String(chatId));
  }

  function clearSession(chatId) {
    sessions.delete(String(chatId));
  }

  async function handleSessionInput(chatId, text) {
    const state = getSession(chatId);
    if (!state) return false;

    if (state.flow === "create_tenant_slug") {
      const slug = normalizeSlug(text);
      if (!slug) {
        await bot.sendMessage(chatId, "Slug noto'g'ri. Masalan: mini-market");
        return true;
      }
      setSession(chatId, { flow: "create_tenant_name", data: { slug } });
      await bot.sendMessage(chatId, "Tenant nomini yuboring:");
      return true;
    }

    if (state.flow === "create_tenant_name") {
      await createTenant(bot, chatId, [state.data.slug, text]);
      clearSession(chatId);
      await sendMainMenu(bot, chatId, "Tayyor.");
      return true;
    }

    if (state.flow === "create_admin_tenant") {
      const slug = normalizeSlug(text);
      if (!slug) {
        await bot.sendMessage(chatId, "Tenant slug noto'g'ri.");
        return true;
      }
      setSession(chatId, { flow: "create_admin_username", data: { slug } });
      await bot.sendMessage(chatId, "Loginni yuboring:");
      return true;
    }

    if (state.flow === "create_admin_username") {
      const username = String(text || "").trim();
      if (!username) {
        await bot.sendMessage(chatId, "Login bo'sh bo'lmasin.");
        return true;
      }
      setSession(chatId, { flow: "create_admin_password", data: { ...state.data, username } });
      await bot.sendMessage(chatId, "Parolni yuboring (kamida 4 ta belgi):");
      return true;
    }

    if (state.flow === "create_admin_password") {
      const password = String(text || "");
      if (password.length < 4) {
        await bot.sendMessage(chatId, "Parol kamida 4 ta belgi bo'lsin.");
        return true;
      }
      setSession(chatId, { flow: "create_admin_role", data: { ...state.data, password } });
      await bot.sendMessage(chatId, "Rol yuboring: admin yoki cashier");
      return true;
    }

    if (state.flow === "create_admin_role") {
      const role = String(text || "").trim().toLowerCase();
      if (!ROLES.has(role)) {
        await bot.sendMessage(chatId, "Rol noto'g'ri. admin yoki cashier yozing.");
        return true;
      }
      await createAdmin(bot, chatId, [state.data.slug, state.data.username, state.data.password, role]);
      clearSession(chatId);
      await sendMainMenu(bot, chatId, "Tayyor.");
      return true;
    }

    if (state.flow === "list_admins_tenant") {
      await listAdmins(bot, chatId, [text]);
      clearSession(chatId);
      await sendMainMenu(bot, chatId);
      return true;
    }

    if (state.flow === "disable_tenant_slug") {
      await setTenantStatus(bot, chatId, [text], false);
      clearSession(chatId);
      await sendMainMenu(bot, chatId);
      return true;
    }

    if (state.flow === "enable_tenant_slug") {
      await setTenantStatus(bot, chatId, [text], true);
      clearSession(chatId);
      await sendMainMenu(bot, chatId);
      return true;
    }

    if (state.flow === "delete_tenant_slug") {
      const slug = normalizeSlug(text);
      if (!slug) {
        await bot.sendMessage(chatId, "Slug noto'g'ri.");
        return true;
      }
      setSession(chatId, { flow: "delete_tenant_confirm", data: { slug } });
      await bot.sendMessage(chatId, `Tasdiqlang: '${slug}' tenantini o'chirish uchun YES deb yozing.`);
      return true;
    }

    if (state.flow === "delete_tenant_confirm") {
      const ok = String(text || "").trim().toLowerCase();
      if (ok !== "yes") {
        clearSession(chatId);
        await sendMainMenu(bot, chatId, "Bekor qilindi.");
        return true;
      }
      await deleteTenant(bot, chatId, [state.data.slug, "yes"]);
      clearSession(chatId);
      await sendMainMenu(bot, chatId);
      return true;
    }

    return false;
  }

  bot.on("message", async (msg) => {
    try {
      const chatId = msg.chat.id;
      const text = String(msg.text || "").trim();
      if (!text) return;

      if (text === "/myid") {
        await bot.sendMessage(chatId, `Sizning Telegram ID: ${msg.from?.id}`);
        return;
      }

      if (!canUseBot(msg, allowedIds)) {
        await bot.sendMessage(chatId, "Sizda ruxsat yo'q. Adminga Telegram ID yuboring.");
        return;
      }

      if (text === "/cancel") {
        clearSession(chatId);
        await sendMainMenu(bot, chatId, "Joriy jarayon bekor qilindi.");
        return;
      }

      const handledSession = await handleSessionInput(chatId, text);
      if (handledSession) return;

      if (text === BTN.MENU) {
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text === BTN.HELP || text === "/help") {
        await bot.sendMessage(chatId, panelText());
        await sendMainMenu(bot, chatId, "👇 Tugmalardan birini bosing:");
        return;
      }
      if (text === "/start") {
        await bot.sendMessage(chatId, helpText());
        await sendMainMenu(bot, chatId, panelText());
        return;
      }
      if (text === BTN.TENANTS) {
        await listTenants(bot, chatId);
        await sendMainMenu(bot, chatId, panelText());
        return;
      }
      if (text === BTN.CREATE_TENANT) {
        setSession(chatId, { flow: "create_tenant_slug", data: {} });
        await bot.sendMessage(chatId, "Tenant slug yuboring (masalan: mini-market):");
        return;
      }
      if (text === BTN.CREATE_ADMIN) {
        setSession(chatId, { flow: "create_admin_tenant", data: {} });
        await bot.sendMessage(chatId, "Qaysi tenant uchun? slug yuboring:");
        return;
      }
      if (text === BTN.LIST_ADMINS) {
        setSession(chatId, { flow: "list_admins_tenant", data: {} });
        await bot.sendMessage(chatId, "Tenant slug yuboring:");
        return;
      }
      if (text === BTN.DISABLE_TENANT) {
        setSession(chatId, { flow: "disable_tenant_slug", data: {} });
        await bot.sendMessage(chatId, "Bloklash uchun tenant slug yuboring:");
        return;
      }
      if (text === BTN.ENABLE_TENANT) {
        setSession(chatId, { flow: "enable_tenant_slug", data: {} });
        await bot.sendMessage(chatId, "Yoqish uchun tenant slug yuboring:");
        return;
      }
      if (text === BTN.DELETE_TENANT) {
        setSession(chatId, { flow: "delete_tenant_slug", data: {} });
        await bot.sendMessage(chatId, "O'chirish uchun tenant slug yuboring:");
        return;
      }

      if (!text.startsWith("/")) {
        await sendMainMenu(bot, chatId, "Buttonlardan foydalaning yoki /help ni bosing.");
        return;
      }
      if (text.startsWith("/list_tenants")) {
        await listTenants(bot, chatId);
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/create_tenant")) {
        await createTenant(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/edit_tenant")) {
        await editTenant(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/disable_tenant")) {
        await setTenantStatus(bot, chatId, parseArgs(text), false);
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/enable_tenant")) {
        await setTenantStatus(bot, chatId, parseArgs(text), true);
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/delete_tenant")) {
        await deleteTenant(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/list_admins")) {
        await listAdmins(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/create_admin")) {
        await createAdmin(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/edit_admin")) {
        await editAdmin(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }
      if (text.startsWith("/delete_admin")) {
        await deleteAdmin(bot, chatId, parseArgs(text));
        await sendMainMenu(bot, chatId);
        return;
      }

      await sendMainMenu(bot, chatId, "Noma'lum buyruq. /help ni bosing.");
    } catch (error) {
      await bot.sendMessage(msg.chat.id, `Xatolik: ${error?.message || "noma'lum xatolik"}`);
    }
  });

  bot.on("polling_error", (err) => {
    console.error("Telegram bot polling xatosi:", err?.message || err);
  });

  console.log("Telegram super-admin bot ishga tushdi.");
  return bot;
}
