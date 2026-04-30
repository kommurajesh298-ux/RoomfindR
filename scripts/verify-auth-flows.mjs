import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import dotenv from "dotenv";

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
  const queryFile = path.join(os.tmpdir(), "roomfindr-linked-config-auth.sql");
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
    throw new Error(`Missing required env var: ${label}`);
  }
  return value;
};

const SUPABASE_URL = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_URL");
if (!isHttpUrl(SUPABASE_URL)) {
  throw new Error("Missing valid SUPABASE_URL");
}
const SUPABASE_ANON_KEY = requiredEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const normalizeOtpMode = (value) => String(value || "").trim().toLowerCase();
const TEST_OTP_MODE = normalizeOtpMode(process.env.TEST_OTP_MODE) || "auto";

const CUSTOMER_PASSWORD = "RoomFindRAuth1";
const CUSTOMER_RESET_PASSWORD = "RoomFindRReset2";
const OWNER_PASSWORD = "RoomFindROwner1";
const MAIL_TM_API = "https://api.mail.tm";
const OWNER_BANK_VERIFICATION_CANDIDATES = [
  { accountNumber: "026291800001191", ifsc: "YESB0000262", bankName: "Yes Bank" },
  { accountNumber: "1233943142", ifsc: "ICIC0000009", bankName: "ICICI Bank" },
  { accountNumber: "388108022658", ifsc: "ICIC0000009", bankName: "ICICI Bank" },
  { accountNumber: "000890289871772", ifsc: "SCBL0036078", bankName: "Standard Chartered Bank" },
  { accountNumber: "000100289877623", ifsc: "SBIN0008752", bankName: "State Bank of India" },
];

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const publicHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256Hex = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
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

const fetchWithRetry = async (url, options, config = {}) => {
  const retries = config.retries ?? 4;
  const retryDelayMs = config.retryDelayMs ?? 1500;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError;
};

const log = (message) => {
  process.stdout.write(`${message}\n`);
};

const createTempInbox = async (label) => {
  if (TEST_OTP_MODE === "manual-db") {
    return {
      address: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@roomfindr.test`,
      token: null,
    };
  }

  const domainRes = await fetchWithRetry(`${MAIL_TM_API}/domains`);
  const domainPayload = await domainRes.json();
  const domain = domainPayload?.["hydra:member"]?.[0]?.domain;
  if (!domain) {
    throw new Error("Unable to fetch temporary mail domain");
  }

  const address = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domain}`;
  const password = `MailTm${Math.random().toString(36).slice(2)}A1`;

  const createRes = await fetchWithRetry(`${MAIL_TM_API}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });

  if (!createRes.ok && createRes.status !== 422) {
    throw new Error(`Unable to create temporary inbox: ${createRes.status}`);
  }

  const tokenRes = await fetchWithRetry(`${MAIL_TM_API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Unable to authenticate temporary inbox: ${tokenRes.status}`);
  }

  const tokenPayload = await tokenRes.json();
  return {
    address,
    token: tokenPayload.token,
  };
};

const createMailboxWithFallback = async (label) => {
  try {
    return await createTempInbox(label);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
    const canFallback = TEST_OTP_MODE === "auto" && message.includes("temporary inbox: 429");
    if (!canFallback) {
      throw error;
    }

    log(`Mailbox provider throttled for ${label}; falling back to manual DB OTP mode`);
    return {
      address: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@roomfindr.test`,
      token: null,
      otpMode: "manual-db",
    };
  }
};

const fetchLatestOtp = async (mailbox, subjectSnippet) => {
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    const listRes = await fetchWithRetry(`${MAIL_TM_API}/messages?page=1`, {
      headers: { Authorization: `Bearer ${mailbox.token}` },
    });

    if (!listRes.ok) {
      throw new Error(`Unable to list mailbox messages: ${listRes.status}`);
    }

    const listPayload = await listRes.json();
    const messages = listPayload?.["hydra:member"] || [];
    const target = messages.find((item) =>
      String(item.subject || "").toLowerCase().includes(subjectSnippet.toLowerCase()),
    );

    if (target?.id) {
      const messageRes = await fetchWithRetry(`${MAIL_TM_API}/messages/${target.id}`, {
        headers: { Authorization: `Bearer ${mailbox.token}` },
      });
      if (!messageRes.ok) {
        throw new Error(`Unable to read mailbox message: ${messageRes.status}`);
      }

      const messagePayload = await messageRes.json();
      const textSource = [
        messagePayload.text,
        messagePayload.html?.join?.("\n"),
        messagePayload.intro,
      ]
        .filter(Boolean)
        .join("\n");

      const match = textSource.match(/\b(\d{6})\b/);
      if (match?.[1]) {
        return match[1];
      }
    }

    await sleep(5000);
  }

  throw new Error(`Timed out waiting for OTP email (${subjectSnippet})`);
};

const insertOtpRecord = async (table, email, otp, expiresInMinutes) => {
  const { error } = await adminClient.from(table).insert({
    email,
    otp_hash: sha256Hex(otp),
    expires_at: new Date(Date.now() + expiresInMinutes * 60_000).toISOString(),
    attempts: 0,
    used: false,
  });

  if (error) {
    throw new Error(`Unable to insert ${table} OTP: ${error.message}`);
  }
};

const getOtpModeForMailbox = (mailbox) => mailbox?.otpMode || TEST_OTP_MODE;

const getSignupOtp = async (mailbox) => {
  if (getOtpModeForMailbox(mailbox) === "manual-db") {
    const otp = "246810";
    await insertOtpRecord("email_otps", mailbox.address, otp, 5);
    return otp;
  }

  await callFunction("send-signup-email-otp", { email: mailbox.address });
  return fetchLatestOtp(mailbox, "signup");
};

const getResetOtp = async (mailbox) => {
  if (getOtpModeForMailbox(mailbox) === "manual-db") {
    const otp = "135791";
    await insertOtpRecord("password_reset_otps", mailbox.address, otp, 10);
    return otp;
  }

  await callFunction("send-password-reset-otp", { email: mailbox.address });
  return fetchLatestOtp(mailbox, "password reset");
};

const callFunction = async (name, body, accessToken) => {
  const headers = {
    ...publicHeaders,
    ...(accessToken ? { "x-supabase-auth": `Bearer ${accessToken}` } : {}),
  };

  const response = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `Function ${name} failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

const signInWithPassword = async (email, password) => {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw error || new Error(`Unable to sign in for ${email}`);
  }

  return { client, session: data.session, user: data.user };
};

const ensurePasswordSignInFails = async (email, password) => {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) {
    throw new Error(`Expected sign-in failure for ${email}, but login succeeded`);
  }
};

const deleteUserIfExists = async (userId) => {
  if (!userId) return;
  await adminClient.auth.admin.deleteUser(userId).catch(() => undefined);
};

const getAccountRecord = async (userId) => {
  const { data, error } = await adminClient
    .from("accounts")
    .select("id, role, account_status")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getOwnerBankRecord = async (ownerId) => {
  const { data, error } = await adminClient
    .from("owner_bank_accounts")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const getOwnerBankVerificationRecord = async (ownerId) => {
  const { data, error } = await adminClient
    .from("owner_signup_bank_verifications")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const invokeSignedInFunction = async (client, name, body) => {
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token || "";
  if (!accessToken) {
    throw new Error(`Missing signed-in session for ${name}`);
  }

  return callFunction(name, body, accessToken);
};

const uploadOwnerPreSignupLicense = async ({ email, phone, name }) => {
  const form = new FormData();
  form.set("email", email);
  form.set("phone", phone);
  form.set("name", name);
  form.set(
    "file",
    new File(
      [new Blob(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"], { type: "application/pdf" })],
      "license.pdf",
      { type: "application/pdf" },
    ),
  );

  const response = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/upload-owner-license-pre-signup`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
      payload?.message ||
      `upload-owner-license-pre-signup failed with status ${response.status}`,
    );
  }

  return payload;
};

const verifyOwnerBankPreSignup = async ({ email, phone, name }) => {
  let lastError;
  const failureReasons = [];

  for (const candidate of OWNER_BANK_VERIFICATION_CANDIDATES) {
    try {
      const initial = await callFunction("verify-owner-bank-pre-signup", {
        email,
        phone,
        name,
        accountHolderName: name,
        accountNumber: candidate.accountNumber,
        confirmAccountNumber: candidate.accountNumber,
        ifsc: candidate.ifsc,
      });

      const resolved = await waitFor(
        "owner pre-signup bank verification success",
        async () => {
          if (String(initial?.verification?.transfer_status || "").toLowerCase() === "success") {
            return initial;
          }
          return callFunction("verify-owner-bank-pre-signup", {
            email,
            phone,
            transferId: initial?.transfer_id || null,
            statusOnly: true,
          });
        },
        (payload) => ["success", "failed"].includes(String(payload?.verification?.transfer_status || "").toLowerCase()),
        180000,
        5000,
      );

      if (String(resolved?.verification?.transfer_status || "").toLowerCase() !== "success") {
        throw new Error(
          `Owner pre-signup bank verification did not reach success. Current status: ${resolved?.verification?.transfer_status}`,
        );
      }

      return {
        verification: resolved,
        bank: candidate,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (
        message.includes("already registered") ||
        message.includes("duplicate") ||
        message.includes("already linked")
      ) {
        failureReasons.push(`${candidate.ifsc}/${candidate.accountNumber.slice(-4)} duplicate`);
        continue;
      }
      failureReasons.push(
        `${candidate.ifsc}/${candidate.accountNumber.slice(-4)} ${error instanceof Error ? error.message : String(error)}`,
      );
      lastError = error;
    }
  }

  throw lastError ||
    new Error(
      `Unable to verify owner bank during pre-signup. Attempts: ${failureReasons.join(" | ") || "none"}`,
    );
};

const runCustomerFlow = async (cleanupIds) => {
  log("Customer flow: creating temporary inbox");
  const mailbox = await createMailboxWithFallback("roomfindr-customer");
  const phoneDigits = String(Date.now()).slice(-10);

  log(
    `Customer flow: ${getOtpModeForMailbox(mailbox) === "manual-db" ? "inserting" : "requesting"} signup OTP`,
  );
  const signupOtp = await getSignupOtp(mailbox);
  log("Customer flow: verifying signup OTP");
  const verifySignup = await callFunction("verify-signup-email-otp", {
    email: mailbox.address,
    otp: signupOtp,
    password: CUSTOMER_PASSWORD,
    role: "customer",
    name: "Flow Customer",
    phone: phoneDigits,
    city: "Hyderabad",
  });

  cleanupIds.push(verifySignup.user_id);

  if (verifySignup.account_status !== "active") {
    throw new Error("Customer account did not become active after OTP verification");
  }

  await ensurePasswordSignInFails(mailbox.address, "WrongPassword1");

  log("Customer flow: signing in with created password");
  const customerLogin = await signInWithPassword(mailbox.address, CUSTOMER_PASSWORD);
  const customerAccount = await getAccountRecord(customerLogin.user.id);
  if (customerAccount?.role !== "customer" || customerAccount?.account_status !== "active") {
    throw new Error("Customer account record is incorrect after signup");
  }

  await customerLogin.client.auth.signOut();

  log(
    `Customer flow: ${getOtpModeForMailbox(mailbox) === "manual-db" ? "inserting" : "requesting"} password reset OTP`,
  );
  const resetOtp = await getResetOtp(mailbox);

  log("Customer flow: verifying password reset OTP");
  await callFunction("verify-password-reset-otp", {
    email: mailbox.address,
    otp: resetOtp,
    new_password: CUSTOMER_RESET_PASSWORD,
  });

  log("Customer flow: validating old password is rejected");
  await ensurePasswordSignInFails(mailbox.address, CUSTOMER_PASSWORD);

  log("Customer flow: signing in with new password");
  const resetLogin = await signInWithPassword(mailbox.address, CUSTOMER_RESET_PASSWORD);
  await resetLogin.client.auth.signOut();

  return {
    email: mailbox.address,
    userId: verifySignup.user_id,
  };
};

const runOwnerFlow = async (cleanupIds) => {
  log("Owner flow: creating temporary inbox");
  const mailbox = await createMailboxWithFallback("roomfindr-owner");
  const phoneDigits = String(Date.now() + 1234).slice(-10);
  const ownerName = "Flow Owner";

  log("Owner flow: uploading pre-signup license document");
  await uploadOwnerPreSignupLicense({
    email: mailbox.address,
    phone: phoneDigits,
    name: ownerName,
  });

  log("Owner flow: verifying pre-signup bank details");
  const preSignupBank = await verifyOwnerBankPreSignup({
    email: mailbox.address,
    phone: phoneDigits,
    name: ownerName,
  });

  log(
    `Owner flow: ${getOtpModeForMailbox(mailbox) === "manual-db" ? "inserting" : "requesting"} signup OTP`,
  );
  const signupOtp = await getSignupOtp(mailbox);

  log("Owner flow: verifying signup OTP");
  const verifySignup = await callFunction("verify-signup-email-otp", {
    email: mailbox.address,
    otp: signupOtp,
    password: OWNER_PASSWORD,
    role: "owner",
    name: ownerName,
    phone: phoneDigits,
    transferId: preSignupBank?.verification?.transfer_id || null,
  });

  cleanupIds.push(verifySignup.user_id);

  if (verifySignup.account_status !== "pending_admin_approval") {
    throw new Error("Owner account should remain pending admin approval after signup");
  }

  const ownerLogin = await signInWithPassword(mailbox.address, OWNER_PASSWORD);
  const ownerAccount = await getAccountRecord(ownerLogin.user.id);
  if (ownerAccount?.role !== "owner" || ownerAccount?.account_status !== "pending_admin_approval") {
    throw new Error("Owner account status is incorrect after signup");
  }

  let verification = await getOwnerBankVerificationRecord(ownerLogin.user.id);
  let verifiedBankRecord = await getOwnerBankRecord(ownerLogin.user.id);
  let selectedBank = preSignupBank.bank;

  const alreadyVerified =
    verifiedBankRecord?.verified === true &&
    String(verifiedBankRecord?.bank_verification_status || "").toLowerCase() === "verified" &&
    !!verifiedBankRecord?.cashfree_beneficiary_id &&
    String(verification?.transfer_status || "").toLowerCase() === "success";

  if (!alreadyVerified) {
    verification = null;
    selectedBank = null;

    for (const candidate of OWNER_BANK_VERIFICATION_CANDIDATES) {
      try {
        log(`Owner flow: verifying bank for ${candidate.ifsc}/${candidate.accountNumber.slice(-4)}`);
        await invokeSignedInFunction(ownerLogin.client, "verify-owner-bank", {
          ownerId: ownerLogin.user.id,
          accountHolderName: "Flow Owner",
          accountNumber: candidate.accountNumber,
          confirmAccountNumber: candidate.accountNumber,
          ifsc: candidate.ifsc,
        });
        verification = await waitFor(
          "owner bank verification success",
          async () => {
            await invokeSignedInFunction(ownerLogin.client, "sync-owner-bank-verification-status", {
              ownerId: ownerLogin.user.id,
            }).catch(() => undefined);
            return getOwnerBankVerificationRecord(ownerLogin.user.id);
          },
          (record) => ["success", "failed"].includes(String(record?.transfer_status || "").toLowerCase()),
          180000,
          5000,
        );
        if (String(verification?.transfer_status || "").toLowerCase() !== "success") {
          throw new Error(
            `Owner bank verification did not reach success. Current status: ${verification?.transfer_status}`,
          );
        }
        selectedBank = { ...candidate };
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (
          message.includes("already registered") ||
          message.includes("duplicate") ||
          message.includes("already linked")
        ) {
          continue;
        }
        throw error;
      }
    }

    verifiedBankRecord = await getOwnerBankRecord(ownerLogin.user.id);
  }

  if (!selectedBank || !verification) {
    throw new Error("Owner bank verification test could not find an available sandbox bank account");
  }

  const verificationRecord = await getOwnerBankVerificationRecord(ownerLogin.user.id);
  if (
    !verifiedBankRecord?.verified ||
    verifiedBankRecord.bank_verification_status !== "verified" ||
    !verifiedBankRecord.cashfree_beneficiary_id
  ) {
    throw new Error("Owner bank account record did not move to verified");
  }
  if (!verificationRecord || verificationRecord.transfer_status !== "success") {
    throw new Error("Owner bank verification row did not move to success");
  }

  await ownerLogin.client.auth.signOut();

  return {
    email: mailbox.address,
    userId: verifySignup.user_id,
    beneficiaryId: verifiedBankRecord.cashfree_beneficiary_id,
    bankVerificationId: verification.id,
    bankVerificationTransferId: verification.transfer_reference_id,
    bankAccountLast4: selectedBank.accountNumber.slice(-4),
  };
};

const main = async () => {
  const cleanupIds = [];

  try {
    const customerResult = await runCustomerFlow(cleanupIds);
    const ownerResult = await runOwnerFlow(cleanupIds);

    log("");
    log("Integration summary");
    log(`- Customer signup/login/reset verified for ${customerResult.email}`);
    log(`- Owner signup/bank validation/beneficiary/INR 1 verification verified for ${ownerResult.email}`);
    log(`- Owner beneficiary id: ${ownerResult.beneficiaryId}`);
    log(`- Owner bank verification id: ${ownerResult.bankVerificationId}`);
    log(`- Owner bank verification transfer id: ${ownerResult.bankVerificationTransferId}`);
    log(`- Owner verified bank last4: ${ownerResult.bankAccountLast4}`);
  } finally {
    for (const userId of cleanupIds.reverse()) {
      await deleteUserIfExists(userId);
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
