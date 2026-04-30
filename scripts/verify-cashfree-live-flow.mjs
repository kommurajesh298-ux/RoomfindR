import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const currentFile = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(currentFile), "..");

const loadEnv = () => {
  const files = [
    path.join(ROOT_DIR, ".env.local"),
    path.join(ROOT_DIR, ".env"),
    path.join(ROOT_DIR, "supabase", ".env.remote"),
    path.join(ROOT_DIR, "supabase", ".env"),
    path.join(ROOT_DIR, "customer-app", ".env"),
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
};

loadEnv();

const isPlaceholderEnv = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized ||
    normalized.startsWith("your_") ||
    normalized.includes("your_supabase") ||
    normalized.includes("placeholder") ||
    normalized.includes("example");
};

const loadLinkedConfigFallback = () => {
  const projectRefPath = path.join(ROOT_DIR, "supabase", ".temp", "project-ref");
  if (!fs.existsSync(projectRefPath)) {
    return;
  }

  const query =
    "select key, value from public.config where key in ('supabase_url','supabase_service_role_key') order by key;";
  const queryFile = path.join(os.tmpdir(), "roomfindr-linked-config-cashfree.sql");
  fs.writeFileSync(queryFile, `${query}\n`, "utf8");
  const command = `npx supabase db query --linked -o json -f "${queryFile}"`;
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    })
    : spawnSync("sh", ["-lc", command], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    });

  fs.rmSync(queryFile, { force: true });

  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    return;
  }

  try {
    const payload = JSON.parse(result.stdout);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    for (const row of rows) {
      const key = String(row?.key || "").trim().toLowerCase();
      const value = String(row?.value || "").trim();
      if (!value) continue;

      if (key === "supabase_url" && isPlaceholderEnv(process.env.SUPABASE_URL)) {
        process.env.SUPABASE_URL = value;
      }

      if (
        key === "supabase_service_role_key" &&
        isPlaceholderEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
      ) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = value;
      }
    }
  } catch {
    // Ignore malformed CLI output and fall back to env files.
  }
};

loadLinkedConfigFallback();

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

const pickEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (!isPlaceholderEnv(value)) {
      return value;
    }
  }
  return "";
};

const requiredEnv = (label, ...names) => {
  const value = pickEnv(...names);
  if (!value) {
    throw new Error(`Missing env: ${label}`);
  }
  return value;
};

const optionalEnv = (...names) => pickEnv(...names);

const SUPABASE_URL = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_URL");
if (!isHttpUrl(SUPABASE_URL)) {
  throw new Error("Missing valid SUPABASE_URL");
}
const SUPABASE_ANON_KEY = requiredEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const CASHFREE_CLIENT_ID = optionalEnv("CASHFREE_CLIENT_ID");
const CASHFREE_CLIENT_SECRET = optionalEnv("CASHFREE_CLIENT_SECRET");
const CASHFREE_API_VERSION = (process.env.CASHFREE_API_VERSION || "2025-01-01").trim();
const CASHFREE_ENV = (process.env.CASHFREE_ENV || "TEST").trim().toUpperCase();
const CASHFREE_BASE_URL =
  CASHFREE_ENV === "PROD" || CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
const CASHFREE_PAYOUT_CLIENT_ID = optionalEnv("CASHFREE_PAYOUT_CLIENT_ID");
const CASHFREE_PAYOUT_CLIENT_SECRET =
  optionalEnv("CASHFREE_PAYOUT_CLIENT_SECRET") ||
  optionalEnv("CASHFREE_PAYOUT_SECRET") ||
  CASHFREE_CLIENT_SECRET;
const CASHFREE_PAYOUT_API_VERSION =
  (process.env.CASHFREE_PAYOUT_API_VERSION || CASHFREE_API_VERSION).trim();
const CASHFREE_PAYOUT_BASE_URL =
  CASHFREE_ENV === "PROD" || CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/payout"
    : "https://sandbox.cashfree.com/payout";
const OWNER_BANK_VERIFICATION_CANDIDATES = [
  { accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank" },
  { accountNumber: "1233943142", ifsc: "ICIC0000009", bankName: "ICICI Bank" },
  { accountNumber: "388108022658", ifsc: "ICIC0000009", bankName: "ICICI Bank" },
  { accountNumber: "000890289871772", ifsc: "SCBL0036078", bankName: "Standard Chartered Bank" },
  { accountNumber: "000100289877623", ifsc: "SBIN0008752", bankName: "State Bank of India" },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const rootHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const log = (message, detail) => {
  if (detail === undefined) {
    process.stdout.write(`${message}\n`);
    return;
  }
  process.stdout.write(`${message} ${JSON.stringify(detail, null, 2)}\n`);
};

const ensureAutomationConfig = async () => {
  const rows = [
    {
      key: "platform_fee_percentage",
      value: "5.0",
      description: "Default platform fee percentage for settlements",
    },
    {
      key: "fixed_platform_fee",
      value: "50.00",
      description: "Flat fee deducted from refunds if configured",
    },
    {
      key: "supabase_url",
      value: SUPABASE_URL,
      description: "Supabase project URL for automation triggers",
    },
    {
      key: "supabase_service_role_key",
      value: SERVICE_ROLE_KEY,
      description: "Service role key for server automation",
    },
  ];

  const { error } = await admin.from("config").upsert(rows, { onConflict: "key" });
  if (error) throw error;
};

const listAuthUsers = async () => {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) throw error;
  return data?.users || [];
};

const findAuthUserByEmail = async (email) => {
  const users = await listAuthUsers();
  return users.find((entry) => String(entry.email || "").toLowerCase() === email.toLowerCase()) || null;
};

const ensureAuthUser = async ({
  email,
  password,
  role,
  name,
  phone,
}) => {
  const users = await listAuthUsers();
  let user = users.find((entry) => String(entry.email || "").toLowerCase() === email.toLowerCase());
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  const authPhone = normalizedPhone ? `+91${normalizedPhone.slice(-10)}` : undefined;

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      phone: authPhone,
      email_confirm: true,
      user_metadata: { role, name, phone: normalizedPhone },
      app_metadata: { role },
    });

    if (error || !data.user) {
      throw error || new Error(`Unable to create auth user for ${email}`);
    }

    user = data.user;
    log("Created auth user", { email, role, userId: user.id });
  }

  await ensureAccountRecords(
    { id: user.id, email },
    role,
    name,
    phone,
  );

  return user;
};

const getAccountByEmail = async (email) => {
  const { data, error } = await admin
    .from("accounts")
    .select("id,email,role,account_status")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Account not found for ${email}`);
  return data;
};

const getAccountByIdOrEmail = async (userId, email) => {
  let query = admin
    .from("accounts")
    .select("id,email,phone,role,account_status")
    .eq("id", userId)
    .maybeSingle();

  let { data, error } = await query;
  if (error) throw error;
  if (data) return data;

  query = admin
    .from("accounts")
    .select("id,email,phone,role,account_status")
    .eq("email", email)
    .maybeSingle();

  ({ data, error } = await query);
  if (error) throw error;
  return data || null;
};

const ensureAccountRecords = async (user, role, name, phone) => {
  const existingAccount = await getAccountByIdOrEmail(user.id, user.email);
  const accountPayload = {
    id: user.id,
    email: user.email,
    role,
    account_status: "active",
  };
  const resolvedPhone = phone || existingAccount?.phone || "";
  if (resolvedPhone) {
    accountPayload.phone = resolvedPhone;
  }

  if (!accountPayload.phone) {
    throw new Error(`Phone is required for account sync: ${user.email}`);
  }

  const { error: accountError } = await admin.from("accounts").upsert(accountPayload);
  if (accountError) throw accountError;

  if (role === "customer") {
    const { error: customerError } = await admin.from("customers").upsert({
      id: user.id,
      email: user.email,
      name,
      phone,
      city: "Hyderabad",
    });
    if (customerError) throw customerError;
    return;
  }

  if (role === "admin") {
    const { error: adminError } = await admin.from("admins").upsert({
      id: user.id,
      email: user.email,
      name,
    });
    if (adminError) throw adminError;
    return;
  }

  const { error: ownerError } = await admin.from("owners").upsert({
    id: user.id,
    email: user.email,
    name,
    phone,
    verified: false,
    verification_status: "pending",
    bank_verified: false,
    bank_verification_status: "pending",
  });
  if (ownerError) throw ownerError;
};

const approveOwnerAfterBankVerification = async (ownerId) => {
  const [ownerProfile, bankAccount, verification] = await Promise.all([
    getOwnerProfile(ownerId),
    getOwnerBankAccount(ownerId),
    getOwnerBankVerification(ownerId),
  ]);

  const isBankVerified =
    ownerProfile?.bank_verified === true ||
    String(ownerProfile?.bank_verification_status || "").toLowerCase() === "verified" ||
    (
      bankAccount?.verified === true &&
      String(bankAccount?.bank_verification_status || "").toLowerCase() === "verified" &&
      !!bankAccount?.cashfree_beneficiary_id
    ) ||
    String(verification?.transfer_status || "").toLowerCase() === "success";

  if (!isBankVerified) {
    throw new Error("Owner bank verification must succeed before approval");
  }

  const { error: ownerError } = await admin
    .from("owners")
    .update({
      verified: true,
      verification_status: "approved",
      bank_verified: true,
      bank_verification_status: "verified",
    })
    .eq("id", ownerId);
  if (ownerError) throw ownerError;

  const { error: accountError } = await admin
    .from("accounts")
    .update({ account_status: "active" })
    .eq("id", ownerId);
  if (accountError) throw accountError;
};

const signIn = async (email, password) => {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw error || new Error(`Unable to sign in: ${email}`);
  }

  return { client, session: data.session, user: data.user };
};

const insertSignupOtp = async (email, otp) => {
  const { error } = await admin.from("email_otps").insert({
    email,
    otp_hash: sha256Hex(otp),
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    attempts: 0,
    used: false,
  });

  if (error) {
    throw new Error(`Unable to insert signup OTP: ${error.message}`);
  }
};

const callFunction = async (name, body, accessToken) => {
  const headers = {
    ...rootHeaders,
    ...(accessToken ? { "x-supabase-auth": `Bearer ${accessToken}` } : {}),
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `${name} failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

const callGatewayProbe = async (kind, payload, accessToken) => {
  if (!accessToken) {
    throw new Error("Cashfree credentials missing and no auth token available for remote probe");
  }

  const response = await callFunction(
    "cashfree-gateway-probe",
    { kind, ...payload },
    accessToken,
  );

  return response?.data ?? null;
};

const uploadLicense = async (ownerId) => {
  const filePath = `${ownerId}/license-${slug()}.pdf`;
  const blob = new Blob(
    ["%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"],
    { type: "application/pdf" },
  );

  const { error } = await admin.storage.from("documents").upload(filePath, blob, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) throw new Error(`License upload failed: ${error.message}`);
  return admin.storage.from("documents").getPublicUrl(filePath).data.publicUrl;
};

const getOwnerBankAccount = async (ownerId) => {
  const { data, error } = await admin
    .from("owner_bank_accounts")
    .select("owner_id, account_number_last4, verified, bank_verification_status, cashfree_beneficiary_id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getOwnerBankVerification = async (ownerId) => {
  const { data, error } = await admin
    .from("owner_signup_bank_verifications")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getOwnerProfile = async (ownerId) => {
  const { data, error } = await admin
    .from("owners")
    .select(
      "id, bank_verified, bank_verification_status, cashfree_status, cashfree_transfer_id, cashfree_beneficiary_id, bank_account_number, bank_ifsc",
    )
    .eq("id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const resetOwnerBankVerificationState = async (ownerId) => {
  const [ownerProfile, bankAccount, verification] = await Promise.all([
    getOwnerProfile(ownerId),
    getOwnerBankAccount(ownerId).catch(() => null),
    getOwnerBankVerification(ownerId).catch(() => null),
  ]);

  const hasReusableVerification =
    !!bankAccount?.cashfree_beneficiary_id &&
    bankAccount?.verified === true &&
    String(bankAccount?.bank_verification_status || "").toLowerCase() === "verified" &&
    String(verification?.transfer_status || "").toLowerCase() === "success";

  if (hasReusableVerification) {
    return {
      reused: true,
      bankAccount,
      verification,
    };
  }

  const hasStaleState =
    !!verification ||
    !!bankAccount ||
    !!ownerProfile?.cashfree_beneficiary_id ||
    !!ownerProfile?.cashfree_transfer_id ||
    !!ownerProfile?.bank_account_number ||
    !!ownerProfile?.bank_ifsc ||
    ownerProfile?.bank_verified === true ||
    String(ownerProfile?.cashfree_status || "").toLowerCase() === "success" ||
    String(ownerProfile?.bank_verification_status || "").toLowerCase() === "verified";

  if (!hasStaleState) {
    return {
      reused: false,
      bankAccount: null,
      verification: null,
    };
  }

  log("Resetting owner bank verification state", {
    ownerId,
    verificationStatus: verification?.transfer_status || null,
    bankVerificationStatus:
      bankAccount?.bank_verification_status || ownerProfile?.bank_verification_status || null,
    cashfreeStatus: ownerProfile?.cashfree_status || null,
  });

  const { error: attemptsError } = await admin
    .from("owner_bank_verification_attempts")
    .delete()
    .eq("owner_id", ownerId);
  if (attemptsError) throw attemptsError;

  const { error: historyError } = await admin
    .from("owner_bank_verification_history")
    .delete()
    .eq("owner_id", ownerId);
  if (historyError) throw historyError;

  const { error: verificationError } = await admin
    .from("owner_signup_bank_verifications")
    .delete()
    .eq("owner_id", ownerId);
  if (verificationError) throw verificationError;

  const { error: bankAccountError } = await admin
    .from("owner_bank_accounts")
    .delete()
    .eq("owner_id", ownerId);
  if (bankAccountError) throw bankAccountError;

  const { error: ownerError } = await admin
    .from("owners")
    .update({
      cashfree_beneficiary_id: null,
      cashfree_transfer_id: null,
      cashfree_status: "pending",
      verification_reference_id: null,
      bank_verified: false,
      bank_verified_at: null,
      bank_verification_status: "pending",
      account_holder_name: null,
      bank_account_number: null,
      bank_ifsc: null,
      bank_details: {},
    })
    .eq("id", ownerId);
  if (ownerError) throw ownerError;

  return {
    reused: false,
    bankAccount: null,
    verification: null,
  };
};

const createOwnerBeneficiary = async (ownerSession, ownerId) => {
  const existingState = await resetOwnerBankVerificationState(ownerId);

  if (existingState.reused) {
    log("Reusing existing verified owner beneficiary", {
      ownerId,
      beneficiaryId: existingState.bankAccount.cashfree_beneficiary_id,
      last4: existingState.bankAccount.account_number_last4 || null,
    });

    return {
      success: true,
      beneficiary_id: existingState.bankAccount.cashfree_beneficiary_id,
      verification_id: existingState.verification.id,
      transfer_id: existingState.verification.transfer_reference_id,
      bank_account_last4: existingState.bankAccount.account_number_last4 || null,
      ifsc: null,
    };
  }

  let lastError = null;

  for (const candidate of OWNER_BANK_VERIFICATION_CANDIDATES) {
    try {
      log("Trying owner bank verification candidate", {
        ifsc: candidate.ifsc,
        last4: candidate.accountNumber.slice(-4),
      });

      await callFunction(
        "verify-owner-bank",
        {
          ownerId,
          accountHolderName: "Sandbox Owner",
          accountNumber: candidate.accountNumber,
          confirmAccountNumber: candidate.accountNumber,
          ifsc: candidate.ifsc,
        },
        ownerSession.access_token,
      );

      const verification = await waitFor(
        "owner bank verification success",
        async () => {
          await callFunction(
            "sync-owner-bank-verification-status",
            { ownerId },
            ownerSession.access_token,
          ).catch(() => undefined);
          return getOwnerBankVerification(ownerId);
        },
        (record) => ["success", "failed"].includes(String(record?.transfer_status || "").toLowerCase()),
        180000,
        5000,
      );

      if (String(verification?.transfer_status || "").toLowerCase() !== "success") {
        lastError = new Error(
          `Owner bank verification failed for ${candidate.ifsc}/${candidate.accountNumber.slice(-4)}`,
        );
        continue;
      }

      const bankAccount = await waitFor(
        "verified owner bank account",
        () => getOwnerBankAccount(ownerId),
        (record) =>
          !!record?.cashfree_beneficiary_id &&
          record?.verified === true &&
          String(record?.bank_verification_status || "").toLowerCase() === "verified",
        120000,
        4000,
      );

      return {
        success: true,
        beneficiary_id: bankAccount.cashfree_beneficiary_id,
        verification_id: verification.id,
        transfer_id: verification.transfer_reference_id,
        bank_account_last4: candidate.accountNumber.slice(-4),
        ifsc: candidate.ifsc,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log("Owner bank verification candidate failed", {
        ifsc: candidate.ifsc,
        last4: candidate.accountNumber.slice(-4),
        message: lastError.message,
      });
    }
  }

  throw lastError || new Error("Unable to verify owner bank account with available sandbox candidates");
};

const createProperty = async (ownerId, amount = 10) => {
  const { data, error } = await admin
    .from("properties")
    .insert({
      owner_id: ownerId,
      title: `Cashfree Live Check ${slug()}`,
      description: "Sandbox property for live Cashfree validation",
      property_type: "pg",
      city: "Hyderabad",
      state: "Telangana",
      monthly_rent: amount,
      advance_deposit: amount,
      total_rooms: 1,
      rooms_available: 1,
      status: "published",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

const cleanupCustomerActiveBookings = async (customerId) => {
  const activeStatuses = [
    "pending",
    "requested",
    "accepted",
    "approved",
    "payment_pending",
    "checked-in",
    "checked_in",
    "BOOKED",
    "ACTIVE",
    "ONGOING",
    "confirmed",
  ];

  const { data: activeBookings, error } = await admin
    .from("bookings")
    .select("id")
    .eq("customer_id", customerId)
    .in("status", activeStatuses)
    .is("vacate_date", null);

  if (error) throw error;
  if (!activeBookings?.length) return;

  const bookingIds = activeBookings.map((booking) => booking.id);
  await admin.from("refunds").delete().in("booking_id", bookingIds);
  await admin.from("settlements").delete().in("booking_id", bookingIds);
  await admin.from("payment_attempts").delete().in("booking_id", bookingIds);
  await admin.from("payments").delete().in("booking_id", bookingIds);
  await admin.from("bookings").delete().in("id", bookingIds);
};

const createBooking = async ({
  customerId,
  customerEmail,
  ownerId,
  propertyId,
  amount,
}) => {
  const startDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const endDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);

  const { data, error } = await admin
    .from("bookings")
    .insert({
      customer_id: customerId,
      property_id: propertyId,
      owner_id: ownerId,
      start_date: startDate.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      status: "payment_pending",
      payment_status: "pending",
      amount_due: amount,
      monthly_rent: amount,
      advance_paid: amount,
      customer_name: customerEmail.split("@")[0],
      customer_phone: "9999999999",
      customer_email: customerEmail,
      payment_type: "advance",
      payment_provider: "cashfree",
      payment_method: "card",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

const primeBookingForMonthlyRent = async (bookingId) => {
  const now = new Date();
  const cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const { data, error } = await admin
    .from("bookings")
    .update({
      status: "approved",
      stay_status: "ongoing",
      booking_status: "approved",
      continue_status: "active",
      payment_status: "paid",
      advance_payment_status: "paid",
      rent_payment_status: "pending",
      charge_status: "pending",
      charge_type: "rent",
      start_date: previousMonthStart.toISOString().slice(0, 10),
      check_in_date: previousMonthStart.toISOString().slice(0, 10),
      current_cycle_start_date: cycleStart.toISOString().slice(0, 10),
      next_due_date: dueDate.toISOString().slice(0, 10),
      admin_approved: true,
    })
    .eq("id", bookingId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

const reviewBooking = async ({
  bookingId,
  status,
  notes,
  adminId,
}) => {
  const payload = {
    status,
    admin_approved: true,
    admin_reviewed_at: new Date().toISOString(),
    admin_reviewed_by: adminId,
    admin_review_notes: notes || null,
    rejection_reason:
      status === "rejected" || status === "cancelled"
        ? notes || "Rejected during live flow verification"
        : null,
  };

  const { error } = await admin
    .from("bookings")
    .update(payload)
    .eq("id", bookingId);

  if (error) throw error;
};

const getLatestPaymentForBooking = async (bookingId) => {
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getPaymentByOrderId = async (orderId) => {
  const { data, error } = await admin
    .from("payments")
    .select("*")
    .eq("provider_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getLatestRefundForBooking = async (bookingId) => {
  const { data, error } = await admin
    .from("refunds")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getLatestSettlementForBooking = async (bookingId) => {
  const { data, error } = await admin
    .from("settlements")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getSettlementByPaymentId = async (paymentId) => {
  const { data, error } = await admin
    .from("settlements")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const fetchCashfreeOrder = async (orderId) => {
  if (!CASHFREE_CLIENT_ID || !CASHFREE_CLIENT_SECRET) {
    throw new Error("Cashfree credentials missing");
  }

  const response = await fetch(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
    headers: {
      "x-client-id": CASHFREE_CLIENT_ID,
      "x-client-secret": CASHFREE_CLIENT_SECRET,
      "x-api-version": CASHFREE_API_VERSION,
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Unable to fetch order ${orderId}`);
  }

  return payload;
};

const fetchCashfreePayments = async (orderId) => {
  if (!CASHFREE_CLIENT_ID || !CASHFREE_CLIENT_SECRET) {
    throw new Error("Cashfree credentials missing");
  }

  const response = await fetch(`${CASHFREE_BASE_URL}/orders/${orderId}/payments`, {
    headers: {
      "x-client-id": CASHFREE_CLIENT_ID,
      "x-client-secret": CASHFREE_CLIENT_SECRET,
      "x-api-version": CASHFREE_API_VERSION,
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload?.message || `Unable to fetch payments for ${orderId}`);
  }

  return Array.isArray(payload) ? payload : payload?.data || [];
};

const clickFirstVisible = async (candidates, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const locator of candidates) {
      try {
        await locator.first().waitFor({ state: "visible", timeout: 1000 });
        await locator.first().click({ timeout: 2000 });
        return true;
      } catch {
        // try next candidate
      }
    }
    await sleep(500);
  }
  return false;
};

const fillFirstVisible = async (candidates, value, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const locator of candidates) {
      try {
        await locator.first().waitFor({ state: "visible", timeout: 1000 });
        await locator.first().fill(value, { timeout: 2000 });
        return true;
      } catch {
        // try next candidate
      }
    }
    await sleep(500);
  }
  return false;
};

const hasFirstVisible = async (candidates, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const locator of candidates) {
      try {
        await locator.first().waitFor({ state: "visible", timeout: 1000 });
        return true;
      } catch {
        // try next candidate
      }
    }
    await sleep(500);
  }
  return false;
};

const captureCheckoutDebug = async (page, prefix) => {
  const safePrefix = prefix.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
  const text = await page.locator("body").innerText().catch(() => "");
  await fs.promises.writeFile(`${safePrefix}.txt`, text, "utf8").catch(() => undefined);
  await fs.promises.writeFile(`${safePrefix}.html`, await page.content().catch(() => ""), "utf8").catch(() => undefined);
  await page.screenshot({ path: `${safePrefix}.png`, fullPage: true }).catch(() => undefined);
};

const fillOtpChallenge = async (page, otp, selectors = [
  ".otpContainer input:visible",
  ".otp-container input:visible",
]) => {
  for (const selector of selectors) {
    const inputs = page.locator(selector);
    const count = await inputs.count().catch(() => 0);
    if (!count) {
      continue;
    }

    if (count === 1) {
      try {
        await inputs.first().click({ timeout: 2000 });
        await inputs.first().fill(otp, { timeout: 2000 });
        return true;
      } catch {
        // try next selector
      }
      continue;
    }

    try {
      const digits = otp.split("");
      for (let index = 0; index < Math.min(digits.length, count); index += 1) {
        const input = inputs.nth(index);
        await input.click({ timeout: 2000 });
        await input.fill("", { timeout: 2000 }).catch(() => undefined);
        await input.type(digits[index], { delay: 80, timeout: 2000 });
      }
      return true;
    } catch {
      // try next selector
    }
  }

  return false;
};

const isCashfreeAuthError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("authentication failed") ||
    message.includes("authentication_error") ||
    message.includes("missing env: cashfree_payout_client_id") ||
    message.includes("missing payout secret") ||
    message.includes("cashfree credentials missing") ||
    (message.includes("401") && message.includes("cashfree"))
  );
};

const maybeWaitForGateway = async (
  label,
  fn,
  predicate,
  timeoutMs = 120000,
  intervalMs = 4000,
) => {
  try {
    return await waitFor(label, fn, predicate, timeoutMs, intervalMs);
  } catch (error) {
    if (isCashfreeAuthError(error)) {
      log(`${label} skipped`, {
        reason: "Local Cashfree API credentials are unavailable or stale. Continuing with backend/webhook verification.",
      });
      return null;
    }
    throw error;
  }
};

const completeHostedCardCheckout = async (paymentSessionId) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  try {
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ url: "https://sdk.cashfree.com/js/v3/cashfree.js" });
    await page.evaluate(
      async ({ sessionId, mode }) => {
        const cf = window.Cashfree({ mode });
        await cf.checkout({ paymentSessionId: sessionId, redirectTarget: "_self" });
      },
      {
        sessionId: paymentSessionId,
        mode: CASHFREE_ENV === "PROD" || CASHFREE_ENV === "PRODUCTION" ? "production" : "sandbox",
      },
    );

    await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => undefined);
    await page.waitForURL(/cashfree\.com\/checkout/i, { timeout: 60000 }).catch(() => undefined);
    await sleep(2500);

    const selectedCard = await clickFirstVisible([
      page.getByRole("button", { name: /^Card$/i }),
      page.getByText(/^Card$/i),
      page.locator("text=Card"),
    ], 10000);

    const cardViewReady = selectedCard || await hasFirstVisible([
      page.getByRole("button", { name: /^Use$/i }),
      page.locator("button:has-text('Use')"),
      page.locator("[role='button']:has-text('Use')"),
      page.getByText(/Test Card Transactions/i),
      page.getByText(/Proceed to Pay/i),
      page.getByText(/Add a new card/i),
    ], 15000);

    if (!cardViewReady) {
      await captureCheckoutDebug(page, "cashfree-card-step-debug");
      throw new Error("Unable to open card payment option in Cashfree checkout");
    }

    const usedTestCard = await clickFirstVisible([
      page.getByRole("button", { name: /^Use$/i }),
      page.locator("button:has-text('Use')"),
      page.locator("[role='button']:has-text('Use')"),
    ], 20000);
    if (!usedTestCard) {
      await captureCheckoutDebug(page, "cashfree-use-card-debug");
      throw new Error("Unable to select sandbox test card");
    }

    const proceededToPay = await clickFirstVisible([
      page.getByRole("button", { name: /Proceed to Pay/i }),
      page.getByText(/Proceed to Pay/i),
      page.locator("button:has-text('Proceed to Pay')"),
      page.locator("[role='button']:has-text('Proceed to Pay')"),
    ], 20000);
    if (!proceededToPay) {
      await captureCheckoutDebug(page, "cashfree-proceed-debug");
      throw new Error(`Unable to continue from card page. Current URL: ${page.url()}`);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
    await sleep(1500);

    const simulatorVisible = await hasFirstVisible([
      page.getByText(/Simulation Status/i),
      page.getByText("SUCCESS", { exact: true }),
    ], 5000);

    const nativeOtpVisible = !simulatorVisible && await hasFirstVisible([
      page.getByText(/Enter the 6-digit OTP sent to the linked phone number/i),
      page.getByText(/Resend OTP/i),
      page.getByText(/Complete this transaction on/i),
    ], 5000);

    if (nativeOtpVisible) {
      const nativeOtpFilled = await fillOtpChallenge(page, "111000");

      if (!nativeOtpFilled) {
        await captureCheckoutDebug(page, "cashfree-native-otp-debug");
        throw new Error(`Unable to fill hosted OTP challenge. Current URL: ${page.url()}`);
      }

      await page.waitForURL(/(payments-test\.cashfree\.com\/pgbillpayuiapi\/gateway\/thankyou|payment-status)/i, {
        timeout: 5000,
      }).catch(() => undefined);

      if (/payment-status|pgbillpayuiapi\/gateway\/thankyou/i.test(page.url())) {
        return {
          finalUrl: page.url(),
          title: await page.title().catch(() => ""),
        };
      }

      await sleep(1000);
      if (/payment-status|pgbillpayuiapi\/gateway\/thankyou/i.test(page.url())) {
        return {
          finalUrl: page.url(),
          title: await page.title().catch(() => ""),
        };
      }

      const nativeOtpSubmitted = await clickFirstVisible([
        page.locator(".modal-content-for-desktop").getByRole("button", { name: /Proceed to Pay/i }),
        page.locator(".otp-container").getByRole("button", { name: /Proceed to Pay/i }),
        page.locator(".modal-content-for-desktop button:has-text('Proceed to Pay')"),
        page.locator(".otp-container button:has-text('Proceed to Pay')"),
        page.getByRole("button", { name: /Proceed to Pay/i }),
        page.getByText(/^Proceed to Pay$/i),
        page.locator("button:has-text('Proceed to Pay')"),
      ], 20000);

      if (!nativeOtpSubmitted) {
        if (/payment-status|pgbillpayuiapi\/gateway\/thankyou/i.test(page.url())) {
          return {
            finalUrl: page.url(),
            title: await page.title().catch(() => ""),
          };
        }
        await captureCheckoutDebug(page, "cashfree-native-otp-submit-debug");
        throw new Error(`Unable to submit hosted OTP challenge. Current URL: ${page.url()}`);
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
      await sleep(2000);
    }

    const simulatorAfterOtp = /payments-test\.cashfree\.com/i.test(page.url()) || await hasFirstVisible([
      page.getByText(/Simulation Status/i),
      page.getByText("SUCCESS", { exact: true }),
    ], 5000);

    if (simulatorAfterOtp) {
      let otpFilled = false;
      const simulatorOtp = page.locator("#basic-otp");
      if (await simulatorOtp.count().catch(() => 0)) {
        try {
          await simulatorOtp.fill("111000", { timeout: 5000 });
          otpFilled = true;
        } catch {
          otpFilled = false;
        }
      }

      if (!otpFilled) {
        otpFilled = await fillOtpChallenge(page, "111000", [
          "#basic-otp",
          ".otpContainer input:visible",
          ".otp-container input:visible",
          "input[inputmode='numeric']:visible",
        ]);
      }

      const successSelected = await clickFirstVisible([
        page.locator("[data-status='SUCCESS']"),
        page.getByText("SUCCESS", { exact: true }),
        page.getByRole("button", { name: /^SUCCESS$/i }),
        page.locator("text=SUCCESS"),
      ], 20000);

      if (!successSelected && !otpFilled) {
        await captureCheckoutDebug(page, "cashfree-otp-debug");
        throw new Error(`Unable to find simulator success controls. Current URL: ${page.url()}`);
      }

      const successSelectedAfterOtp = successSelected || await clickFirstVisible([
        page.locator("[data-status='SUCCESS']"),
        page.getByText("SUCCESS", { exact: true }),
        page.getByRole("button", { name: /^SUCCESS$/i }),
        page.locator("text=SUCCESS"),
      ], 15000);

      if (!successSelectedAfterOtp) {
        await captureCheckoutDebug(page, "cashfree-success-debug");
        throw new Error(`Unable to select SUCCESS result in simulator. Current URL: ${page.url()}`);
      }

      await page.waitForFunction(() => {
        const button = document.querySelector("#successForm button");
        return !!button && !(button instanceof HTMLButtonElement && button.disabled);
      }, { timeout: 10000 }).catch(() => undefined);

      const submitted = await clickFirstVisible([
        page.locator("#successForm button"),
        page.getByRole("button", { name: /submit/i }),
        page.getByText(/^Submit$/i),
        page.locator("button:has-text('Submit')"),
        page.locator("[role='button']:has-text('Submit')"),
      ], 20000);

      if (!submitted) {
        await captureCheckoutDebug(page, "cashfree-submit-debug");
        throw new Error(`Unable to submit simulator result. Current URL: ${page.url()}`);
      }
    }

    await page.waitForURL(/(payments-test\.cashfree\.com\/pgbillpayuiapi\/gateway\/thankyou|payment-status)/i, {
      timeout: 60000,
    }).catch(() => undefined);

    if (!/payment-status/i.test(page.url())) {
      await page.waitForURL(/payment-status/i, { timeout: 20000 }).catch(() => undefined);
    }

    return {
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
    };
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

const fetchCashfreeRefund = async (orderId, refundId) => {
  if (!CASHFREE_CLIENT_ID || !CASHFREE_CLIENT_SECRET) {
    throw new Error("Cashfree credentials missing");
  }

  const response = await fetch(
    `${CASHFREE_BASE_URL}/orders/${orderId}/refunds/${refundId}`,
    {
      headers: {
        "x-client-id": CASHFREE_CLIENT_ID,
        "x-client-secret": CASHFREE_CLIENT_SECRET,
        "x-api-version": CASHFREE_API_VERSION,
        "Content-Type": "application/json",
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Unable to fetch refund ${refundId}`);
  }

  return payload;
};

const fetchCashfreeTransfer = async (transferId) => {
  if (!CASHFREE_PAYOUT_CLIENT_ID || !CASHFREE_PAYOUT_CLIENT_SECRET) {
    throw new Error("Missing env: CASHFREE_PAYOUT_CLIENT_ID");
  }

  const response = await fetch(`${CASHFREE_PAYOUT_BASE_URL}/transfers?transfer_id=${encodeURIComponent(transferId)}`, {
    headers: {
      "x-client-id": CASHFREE_PAYOUT_CLIENT_ID,
      "x-client-secret": CASHFREE_PAYOUT_CLIENT_SECRET,
      "x-api-version": CASHFREE_PAYOUT_API_VERSION,
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Unable to fetch transfer ${transferId}`);
  }

  return payload;
};

const fetchGatewayOrder = async (orderId, accessToken, bookingId) => {
  try {
    return await fetchCashfreeOrder(orderId);
  } catch (error) {
    if (isCashfreeAuthError(error)) {
      return callGatewayProbe("order", { orderId, bookingId }, accessToken);
    }
    throw error;
  }
};

const fetchGatewayPayments = async (orderId, accessToken, bookingId) => {
  try {
    return await fetchCashfreePayments(orderId);
  } catch (error) {
    if (isCashfreeAuthError(error)) {
      return callGatewayProbe("payments", { orderId, bookingId }, accessToken);
    }
    throw error;
  }
};

const fetchGatewayRefund = async (orderId, refundId, accessToken, bookingId) => {
  try {
    return await fetchCashfreeRefund(orderId, refundId);
  } catch (error) {
    if (isCashfreeAuthError(error)) {
      return callGatewayProbe("refund", { orderId, refundId, bookingId }, accessToken);
    }
    throw error;
  }
};

const fetchGatewayTransfer = async (transferId, accessToken) => {
  try {
    return await fetchCashfreeTransfer(transferId);
  } catch (error) {
    if (isCashfreeAuthError(error)) {
      return callGatewayProbe("transfer", { transferId }, accessToken);
    }
    throw error;
  }
};

const waitFor = async (label, fn, predicate, timeoutMs = 120000, intervalMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await fn();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await sleep(intervalMs);
  }

  throw new Error(`${label} timed out. Last value: ${JSON.stringify(lastValue)}`);
};

const createPaymentOrder = async (
  booking,
  customerUser,
  accessToken,
  options = {},
) => {
  const {
    amount = 10,
    paymentType = "advance",
    metadata = undefined,
  } = options;

  const payload = {
    bookingId: booking.id,
    amount,
    customerId: customerUser.id,
    customerName: "Sandbox Customer",
    customerEmail: customerUser.email,
    customerPhone: "9999999999",
    card: {
      card_number: "4111111111111111",
      card_holder_name: "Test",
      card_expiry_mm: "03",
      card_expiry_yy: "28",
      card_cvv: "123",
    },
    paymentType,
    metadata,
    app: "customer",
  };

  return callFunction("cashfree-create-order", payload, accessToken);
};

const verifyPayment = async (input, accessToken) =>
  callFunction("cashfree-verify-order", input, accessToken);

const reconcileSettlement = async (settlementId, accessToken) =>
  callFunction("cashfree-settlement", { settlementId }, accessToken);

const ensureSettlement = async ({ bookingId, paymentId, accessToken, createOnly = false }) =>
  callFunction(
    "cashfree-settlement",
    { bookingId, paymentId, createOnly },
    accessToken,
  );

const processRefund = async (input, accessToken) =>
  callFunction("cashfree-refund", { action: "process", initiatedBy: "admin", ...input }, accessToken);

const syncRefund = async (input, accessToken) =>
  callFunction("cashfree-refund", { action: "sync", initiatedBy: "admin", ...input }, accessToken);

const main = async () => {
    const ownerEmail = "cashfree_live_owner_e2e@example.com";
    const customerEmail = "cashfree_live_customer_e2e@example.com";
    const adminEmail = optionalEnv("E2E_ADMIN_EMAIL") || "kommurajesh298@gmail.com";
    const ownerPassword = "password123";
    const customerPassword = "password123";
    const adminPassword = optionalEnv("E2E_ADMIN_PASSWORD") || "Rajesh@7674";

    log("Restoring automation config");
    await ensureAutomationConfig();

    log("Ensuring E2E auth users");
    const ownerAuthUser = await ensureAuthUser({
      email: ownerEmail,
      password: ownerPassword,
      role: "owner",
      name: "Sandbox Owner",
      phone: "9100000002",
    });
    const customerAuthUser = await ensureAuthUser({
      email: customerEmail,
      password: customerPassword,
      role: "customer",
      name: "Sandbox Customer",
      phone: "9100000001",
    });
    const adminAuthUser = await findAuthUserByEmail(adminEmail);
    if (!adminAuthUser) {
      throw new Error(`Admin auth user not found for ${adminEmail}`);
    }

    const adminAccount = await getAccountByEmail(adminEmail);

    await ensureAccountRecords(
      { id: adminAuthUser.id, email: adminEmail },
      "admin",
      "K. Rajesh",
      "",
    );
    await ensureAccountRecords(
      { id: ownerAuthUser.id, email: ownerEmail },
      "owner",
      "Sandbox Owner",
      "9100000002",
    );
    await ensureAccountRecords(
      { id: customerAuthUser.id, email: customerEmail },
      "customer",
      "Sandbox Customer",
      "9100000001",
    );

    const ownerLogin = await signIn(ownerEmail, ownerPassword);
    const customerLogin = await signIn(customerEmail, customerPassword);
    const adminLogin = await signIn(adminEmail, adminPassword);
    const ownerUser = ownerLogin.user;
    const customerUser = customerLogin.user;

    await cleanupCustomerActiveBookings(customerUser.id);

    log("Creating verified owner beneficiary");
    const beneficiary = await createOwnerBeneficiary(ownerLogin.session, ownerUser.id);
    log("Beneficiary created", beneficiary);

    log("Approving owner after verified bank setup");
    await approveOwnerAfterBankVerification(ownerUser.id);

    log("Creating owner property");
    const property = await createProperty(ownerUser.id, 10);

    log("Creating refund test booking");
    const refundBooking = await createBooking({
      customerId: customerUser.id,
      customerEmail,
      ownerId: ownerUser.id,
      propertyId: property.id,
      amount: 10,
    });

    log("Creating payment order for refund test");
    const refundOrder = await createPaymentOrder(
      refundBooking,
      customerUser,
      customerLogin.session.access_token,
    );
    log("Refund flow order init", refundOrder);

    const refundPayment = await waitFor(
      "payment row with order id",
      () => getPaymentByOrderId(refundOrder.order_id),
      (payment) => payment?.provider_order_id === refundOrder.order_id,
      30000,
      2000,
    );
    log("Refund flow payment row", refundPayment);

    const refundCheckout = await completeHostedCardCheckout(refundOrder.payment_session_id);
    log("Refund flow checkout result", refundCheckout);

    const refundGatewayOrder = await maybeWaitForGateway(
      "Cashfree order paid",
      () =>
        fetchGatewayOrder(
          refundPayment.provider_order_id,
          customerLogin.session.access_token,
          refundBooking.id,
        ),
      (order) => String(order?.order_status || "").toUpperCase() === "PAID",
      120000,
      4000,
    );
    log("Refund flow Cashfree order", refundGatewayOrder);

    const refundGatewayPayments = await maybeWaitForGateway(
      "Cashfree payment record",
      () =>
        fetchGatewayPayments(
          refundPayment.provider_order_id,
          customerLogin.session.access_token,
          refundBooking.id,
        ),
      (payments) => Array.isArray(payments) && payments.length > 0,
      120000,
      4000,
    );
    log("Refund flow gateway payments", refundGatewayPayments);

    await verifyPayment({
      bookingId: refundBooking.id,
      orderId: refundPayment.provider_order_id,
    }, customerLogin.session.access_token);

    const refundDbPayment = await waitFor(
      "database payment completed",
      () => getLatestPaymentForBooking(refundBooking.id),
      (payment) =>
        ["completed", "paid"].includes(String(payment?.status || "").toLowerCase()) &&
        !!payment?.provider_payment_id,
      120000,
      4000,
    );
    log("Refund flow DB payment", refundDbPayment);

    log("Rejecting booking to prepare refund review");
    await reviewBooking({
      bookingId: refundBooking.id,
      status: "rejected",
      notes: "Live flow refund test",
      adminId: adminAccount.id,
    });

    log("Approving refund through cashfree-refund");
    const refundProcess = await processRefund({
      bookingId: refundBooking.id,
      paymentId: refundDbPayment.id,
      reason: "Live flow refund test",
      refundReason: "booking_rejected",
      refundAmount: Number(refundDbPayment.amount || 0),
      commissionAmount: 0,
    }, adminLogin.session.access_token);
    log("Refund process response", refundProcess);

    const refundRow = await waitFor(
      "refund row",
      () => getLatestRefundForBooking(refundBooking.id),
      (refund) => !!refund?.refund_id && !!refund?.payment_id,
      120000,
      4000,
    );
    log("Refund row", refundRow);

    const refundGateway = await maybeWaitForGateway(
      "Cashfree refund registration",
      () =>
        fetchGatewayRefund(
          refundPayment.provider_order_id,
          refundRow.refund_id,
          customerLogin.session.access_token,
          refundBooking.id,
        ),
      (refund) =>
        ["SUCCESS", "PENDING", "PROCESSING", "ONHOLD"].includes(
          String(refund?.refund_status || "").toUpperCase(),
        ),
      120000,
      4000,
    );
    log("Refund gateway", refundGateway);

    const refundDbFinal = await waitFor(
      "refund row reconciliation",
      async () => {
        const currentRefund = await getLatestRefundForBooking(refundBooking.id);
        if (currentRefund?.id) {
          const currentStatus = String(
            currentRefund.refund_status || currentRefund.status || "",
          ).toUpperCase();
          if (!["SUCCESS", "FAILED", "PROCESSED"].includes(currentStatus)) {
            await syncRefund({
              refundRowId: currentRefund.id,
              bookingId: refundBooking.id,
              paymentId: refundDbPayment.id,
            }, adminLogin.session.access_token).catch(() => null);
          }
        }

        return getLatestRefundForBooking(refundBooking.id);
      },
      (refund) =>
        !!refund?.refund_id &&
        ["SUCCESS", "FAILED", "PROCESSING", "PENDING", "ONHOLD"].includes(
          String(refund?.refund_status || refund?.status || "").toUpperCase(),
        ),
      120000,
      4000,
    );
    log("Refund DB final", refundDbFinal);

    log("Creating settlement test booking");
    const settlementBooking = await createBooking({
      customerId: customerUser.id,
      customerEmail,
      ownerId: ownerUser.id,
      propertyId: property.id,
      amount: 10,
    });

    log("Creating payment order for settlement test");
    const settlementOrder = await createPaymentOrder(
      settlementBooking,
      customerUser,
      customerLogin.session.access_token,
    );
    log("Settlement flow order init", settlementOrder);

    const settlementPayment = await waitFor(
      "settlement payment row with order id",
      () => getPaymentByOrderId(settlementOrder.order_id),
      (payment) => payment?.provider_order_id === settlementOrder.order_id,
      30000,
      2000,
    );
    log("Settlement flow payment row", settlementPayment);

    const settlementCheckout = await completeHostedCardCheckout(settlementOrder.payment_session_id);
    log("Settlement flow checkout result", settlementCheckout);

    const settlementGatewayOrder = await maybeWaitForGateway(
      "settlement gateway order paid",
      () =>
        fetchGatewayOrder(
          settlementPayment.provider_order_id,
          customerLogin.session.access_token,
          settlementBooking.id,
        ),
      (order) => String(order?.order_status || "").toUpperCase() === "PAID",
      120000,
      4000,
    );
    log("Settlement flow Cashfree order", settlementGatewayOrder);

    const settlementGatewayPayments = await maybeWaitForGateway(
      "settlement gateway payment record",
      () =>
        fetchGatewayPayments(
          settlementPayment.provider_order_id,
          customerLogin.session.access_token,
          settlementBooking.id,
        ),
      (payments) => Array.isArray(payments) && payments.length > 0,
      120000,
      4000,
    );
    log("Settlement flow gateway payments", settlementGatewayPayments);

    await verifyPayment({
      bookingId: settlementBooking.id,
      orderId: settlementPayment.provider_order_id,
    }, customerLogin.session.access_token);

    await waitFor(
      "settlement DB payment completed",
      () => getLatestPaymentForBooking(settlementBooking.id),
      (payment) =>
        ["completed", "paid"].includes(String(payment?.status || "").toLowerCase()) &&
        !!payment?.provider_payment_id,
      120000,
      4000,
    );

    log("Approving booking to trigger settlement payout");
    await reviewBooking({
      bookingId: settlementBooking.id,
      status: "approved",
      notes: "Live flow settlement approval",
      adminId: adminAccount.id,
    });

    let lastSettlementCreateAt = 0;
    const settlementRow = await waitFor(
      "settlement row",
      async () => {
        let settlement = await getLatestSettlementForBooking(settlementBooking.id);
        if (
          (!settlement?.provider_transfer_id) &&
          Date.now() - lastSettlementCreateAt > 15_000
        ) {
          lastSettlementCreateAt = Date.now();
          await ensureSettlement({
            bookingId: settlementBooking.id,
            paymentId: settlementPayment.id,
            accessToken: ownerLogin.session.access_token,
          }).catch((error) => {
            log("Settlement create retry failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
          settlement = await getLatestSettlementForBooking(settlementBooking.id);
        }
        return settlement;
      },
      (settlement) => !!settlement?.provider_transfer_id,
      180000,
      4000,
    );
    log("Settlement row", settlementRow);

    const transferGateway = await maybeWaitForGateway(
      "Cashfree transfer completion",
      () => fetchGatewayTransfer(settlementRow.provider_transfer_id, ownerLogin.session.access_token),
      (transfer) =>
        ["SUCCESS", "COMPLETED", "PROCESSED"].includes(
          String(
            transfer?.status ||
              transfer?.status_code ||
              transfer?.data?.status ||
              transfer?.data?.status_code ||
              "",
          ).toUpperCase(),
        ),
      120000,
      4000,
    );
    log("Settlement gateway transfer", transferGateway);

    let lastSettlementReconcileAt = 0;
    const settlementDbFinal = await waitFor(
      "settlement completed",
      async () => {
        const settlement = await getLatestSettlementForBooking(settlementBooking.id);
        if (
          settlement?.id &&
          String(settlement.status || "").toUpperCase() === "PROCESSING" &&
          Date.now() - lastSettlementReconcileAt > 15_000
        ) {
          lastSettlementReconcileAt = Date.now();
          await reconcileSettlement(settlement.id, customerLogin.session.access_token).catch((error) => {
            log("Settlement reconciliation retry failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
          return getLatestSettlementForBooking(settlementBooking.id);
        }
        return settlement;
      },
      (settlement) => String(settlement?.status || "").toUpperCase() === "COMPLETED",
      240000,
      4000,
    );
    log("Settlement DB final", settlementDbFinal);

    log("Priming booking into a due monthly rent cycle");
    const monthlyReadyBooking = await primeBookingForMonthlyRent(settlementBooking.id);
    log("Monthly flow booking prepared", monthlyReadyBooking);

    const monthlyRentAmount = Number(monthlyReadyBooking.monthly_rent || settlementBooking.monthly_rent || 10);
    const monthlyCycleDate = new Date(String(monthlyReadyBooking.current_cycle_start_date || new Date().toISOString()).slice(0, 10));
    const monthlyScope = `${monthlyCycleDate.getUTCFullYear()}-${String(monthlyCycleDate.getUTCMonth() + 1).padStart(2, "0")}`;

    log("Creating monthly rent payment order");
    const monthlyOrder = await createPaymentOrder(
      settlementBooking,
      customerUser,
      customerLogin.session.access_token,
      {
        amount: monthlyRentAmount,
        paymentType: "monthly",
        metadata: { month: monthlyScope },
      },
    );
    log("Monthly flow order init", monthlyOrder);

    const monthlyPayment = await waitFor(
      "monthly payment row with order id",
      () => getPaymentByOrderId(monthlyOrder.order_id),
      (payment) => payment?.provider_order_id === monthlyOrder.order_id,
      30000,
      2000,
    );
    log("Monthly flow payment row", monthlyPayment);

    const monthlyCheckout = await completeHostedCardCheckout(monthlyOrder.payment_session_id);
    log("Monthly flow checkout result", monthlyCheckout);

    const monthlyGatewayOrder = await maybeWaitForGateway(
      "monthly gateway order paid",
      () =>
        fetchGatewayOrder(
          monthlyPayment.provider_order_id,
          customerLogin.session.access_token,
          settlementBooking.id,
        ),
      (order) => String(order?.order_status || "").toUpperCase() === "PAID",
      120000,
      4000,
    );
    log("Monthly flow Cashfree order", monthlyGatewayOrder);

    const monthlyGatewayPayments = await maybeWaitForGateway(
      "monthly gateway payment record",
      () =>
        fetchGatewayPayments(
          monthlyPayment.provider_order_id,
          customerLogin.session.access_token,
          settlementBooking.id,
        ),
      (payments) => Array.isArray(payments) && payments.length > 0,
      120000,
      4000,
    );
    log("Monthly flow gateway payments", monthlyGatewayPayments);

    await verifyPayment({
      bookingId: settlementBooking.id,
      orderId: monthlyPayment.provider_order_id,
    }, customerLogin.session.access_token);

    const monthlyDbPayment = await waitFor(
      "monthly DB payment completed",
      () => getPaymentByOrderId(monthlyOrder.order_id),
      (payment) =>
        ["completed", "paid"].includes(String(payment?.status || "").toLowerCase()) &&
        !!payment?.provider_payment_id,
      120000,
      4000,
    );
    log("Monthly flow DB payment", monthlyDbPayment);

    let lastMonthlySettlementCreateAt = 0;
    const monthlySettlementRow = await waitFor(
      "monthly settlement row",
      async () => {
        let settlement = await getSettlementByPaymentId(monthlyDbPayment.id);
        if (
          (!settlement?.provider_transfer_id) &&
          Date.now() - lastMonthlySettlementCreateAt > 15_000
        ) {
          lastMonthlySettlementCreateAt = Date.now();
          await ensureSettlement({
            bookingId: settlementBooking.id,
            paymentId: monthlyDbPayment.id,
            accessToken: ownerLogin.session.access_token,
          }).catch((error) => {
            log("Monthly settlement create retry failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
          settlement = await getSettlementByPaymentId(monthlyDbPayment.id);
        }
        return settlement;
      },
      (settlement) => !!settlement?.provider_transfer_id,
      180000,
      4000,
    );
    log("Monthly settlement row", monthlySettlementRow);

    const monthlyTransferGateway = await maybeWaitForGateway(
      "monthly Cashfree transfer completion",
      () => fetchGatewayTransfer(monthlySettlementRow.provider_transfer_id, ownerLogin.session.access_token),
      (transfer) =>
        ["SUCCESS", "COMPLETED", "PROCESSED"].includes(
          String(
            transfer?.status ||
              transfer?.status_code ||
              transfer?.data?.status ||
              transfer?.data?.status_code ||
              "",
          ).toUpperCase(),
        ),
      120000,
      4000,
    );
    log("Monthly settlement gateway transfer", monthlyTransferGateway);

    let lastMonthlyReconcileAt = 0;
    const monthlySettlementFinal = await waitFor(
      "monthly settlement completed",
      async () => {
        const settlement = await getSettlementByPaymentId(monthlyDbPayment.id);
        if (
          settlement?.id &&
          String(settlement.status || "").toUpperCase() === "PROCESSING" &&
          Date.now() - lastMonthlyReconcileAt > 15_000
        ) {
          lastMonthlyReconcileAt = Date.now();
          await reconcileSettlement(settlement.id, customerLogin.session.access_token).catch((error) => {
            log("Monthly settlement reconciliation retry failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
          return getSettlementByPaymentId(monthlyDbPayment.id);
        }
        return settlement;
      },
      (settlement) => String(settlement?.status || "").toUpperCase() === "COMPLETED",
      240000,
      4000,
    );
    log("Monthly settlement DB final", monthlySettlementFinal);

    const { data: monthlyBookingFinal, error: monthlyBookingError } = await admin
      .from("bookings")
      .select("id, status, payment_status, advance_payment_status, rent_payment_status, settlement_status, payout_status")
      .eq("id", settlementBooking.id)
      .maybeSingle();
    if (monthlyBookingError) throw monthlyBookingError;
    log("Monthly flow booking final", monthlyBookingFinal);

    const summary = {
      payment_success_order_id: settlementPayment.provider_order_id,
      refund_success_order_id: refundPayment.provider_order_id,
      refund_status: refundGateway?.refund_status || refundDbFinal.status,
      payout_transfer_id: settlementDbFinal.provider_transfer_id,
      payout_status:
        transferGateway?.status ||
        transferGateway?.status_code ||
        transferGateway?.data?.status ||
        transferGateway?.data?.status_code ||
        settlementDbFinal.status,
      monthly_rent_order_id: monthlyDbPayment.provider_order_id,
      monthly_rent_payment_status: monthlyDbPayment.status,
      monthly_rent_transfer_id: monthlySettlementFinal.provider_transfer_id,
      monthly_rent_payout_status:
        monthlyTransferGateway?.status ||
        monthlyTransferGateway?.status_code ||
        monthlyTransferGateway?.data?.status ||
        monthlyTransferGateway?.data?.status_code ||
        monthlySettlementFinal.status,
    };
    log("Live Cashfree summary", summary);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
