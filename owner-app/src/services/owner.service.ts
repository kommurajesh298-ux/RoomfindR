import { supabase } from "./supabase-config";
import { deferRealtimeSubscription } from "./realtime-subscription";
import {
  invokeProtectedEdgeFunction,
} from "./protected-edge.service";
import type {
  OwnerBankVerificationHistoryEntry,
  OwnerBankVerificationRecord,
} from "../types/owner.types";
import { resolveOwnerVerificationState } from "../utils/ownerVerification";

const OWNER_VERIFICATION_TABLE = "owner_bank_verification";
const OWNER_SIGNUP_VERIFICATION_TABLE = "owner_signup_bank_verifications";

const maskAccountNumber = (value?: string | null, last4?: string | null) => {
  const normalizedLast4 = String(last4 || "").replace(/\D/g, "").slice(-4);
  if (normalizedLast4.length === 4) {
    return `XXXX${normalizedLast4}`;
  }

  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed;
};

const mapOwnerVerificationRecord = (
  row: Record<string, unknown> | null | undefined,
): OwnerBankVerificationRecord | null => {
  if (!row?.id || !row.owner_id) return null;

  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    bank_account_number: maskAccountNumber(
      typeof row.bank_account_number === "string"
        ? row.bank_account_number
        : typeof row.account_number_encrypted === "string"
          ? row.account_number_encrypted
          : null,
      typeof row.account_number_last4 === "string" ? row.account_number_last4 : null,
    ),
    ifsc_code: String(row.ifsc_code || row.ifsc || ""),
    account_holder_name: String(
      row.account_holder_name || row.full_name || "",
    ),
    transfer_amount: Number(row.transfer_amount || 1),
    transfer_reference_id: row.transfer_reference_id
      ? String(row.transfer_reference_id)
      : null,
    provider_reference_id: row.provider_reference_id
      ? String(row.provider_reference_id)
      : null,
    transfer_status:
      row.transfer_status === "success" || row.transfer_status === "failed"
        ? row.transfer_status
        : "pending",
    status_message: row.status_message ? String(row.status_message) : null,
    last_attempt_at: row.last_attempt_at ? String(row.last_attempt_at) : null,
    verified_at: row.verified_at ? String(row.verified_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || row.created_at || ""),
  };
};

const fetchBankVerificationOverviewDirect = async (
  ownerId: string,
  limit = 10,
  options: { syncPending?: boolean } = {},
) => {
  const cappedLimit = Math.max(1, Math.min(50, limit || 10));

  const [{ data: verification, error: verificationError }, { data: signupVerification, error: signupVerificationError }, { data: history, error: historyError }] =
    await Promise.all([
      supabase
        .from(OWNER_VERIFICATION_TABLE)
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle(),
      supabase
        .from(OWNER_SIGNUP_VERIFICATION_TABLE)
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle(),
      supabase
        .from("owner_bank_verification_history")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(cappedLimit),
    ]);

  if (verificationError) throw verificationError;
  if (signupVerificationError) throw signupVerificationError;
  if (historyError) throw historyError;

  const currentVerification = (verification || signupVerification) as Record<string, unknown> | null;
  const shouldSyncPending =
    options.syncPending !== false &&
    currentVerification &&
    String(currentVerification.transfer_status || "").toLowerCase() === "pending" &&
    Boolean(currentVerification.transfer_reference_id);

  if (shouldSyncPending) {
    try {
      await invokeProtectedEdgeFunction(
        "sync-owner-bank-verification-status",
        { ownerId, limit: 5 },
        "Unable to refresh bank verification status",
      );
      return fetchBankVerificationOverviewDirect(ownerId, cappedLimit, {
        syncPending: false,
      });
    } catch (error) {
      console.warn("[ownerService] Bank verification sync failed:", error);
    }
  }

  return {
    verification: mapOwnerVerificationRecord(currentVerification),
    history: (history || []) as OwnerBankVerificationHistoryEntry[],
  };
};

export const ownerService = {
  getOwnerProfile: async (ownerId: string) => {
    const initialOwnerProfile = await supabase
      .from("owners")
      .select("*")
      .eq("id", ownerId)
      .maybeSingle();

    let data = initialOwnerProfile.data;
    const { error } = initialOwnerProfile;

    if (error) throw error;
    if (!data) {
      const { error: repairError } = await supabase.rpc("repair_my_profile");
      if (repairError) {
        console.error("[ownerService] Owner profile repair failed:", repairError);
        return null;
      }

      const retry = await supabase
        .from("owners")
        .select("*")
        .eq("id", ownerId)
        .maybeSingle();

      if (retry.error) throw retry.error;
      data = retry.data;
    }

    if (!data) return null;

    const owner = { ...data } as Record<string, unknown>;
    if (owner.bank_details) {
      owner.bankDetails = owner.bank_details;
      if (owner.account_holder_name && typeof owner.bankDetails === "object") {
        (owner.bankDetails as Record<string, unknown>).accountHolderName =
          owner.account_holder_name;
      }
      delete owner.bank_details;
    }

    if (owner.cashfree_transfer_id) {
      owner.cashfreeTransferId = owner.cashfree_transfer_id;
    }

    if (
      Array.isArray(owner.verification_documents) &&
      owner.verification_documents.length > 0
    ) {
      owner.licenseDocUrl = owner.verification_documents[0];
    }

    const { data: bankAccount, error: bankAccountError } = await supabase
      .from("owner_bank_accounts")
      .select(
        "bank_verification_status, verified, cashfree_beneficiary_id, bank_name, branch_name, city, ifsc, account_number_last4, account_holder_name",
      )
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (bankAccountError) throw bankAccountError;

    const { data: bankVerification, error: bankVerificationError } = await supabase
      .from(OWNER_VERIFICATION_TABLE)
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (bankVerificationError) throw bankVerificationError;

    if (bankAccount) {
      owner.bankVerificationStatus = bankAccount.bank_verification_status;
      owner.cashfreeBeneficiaryId = bankAccount.cashfree_beneficiary_id;
      const bankDetails =
        typeof owner.bankDetails === "object" && owner.bankDetails !== null
          ? owner.bankDetails as Record<string, unknown>
          : {};
      bankDetails.accountHolderName =
        bankAccount.account_holder_name || bankDetails.accountHolderName;
      bankDetails.bankName = bankAccount.bank_name;
      bankDetails.branchName = bankAccount.branch_name;
      bankDetails.city = bankAccount.city;
      bankDetails.ifscCode = bankAccount.ifsc || bankDetails.ifscCode;
      bankDetails.accountNumber =
        bankAccount.account_number_last4
          ? `XXXX${bankAccount.account_number_last4}`
          : bankDetails.accountNumber;
      owner.bankDetails = bankDetails;
    }

    if (bankVerification) {
      owner.bankVerification = mapOwnerVerificationRecord(
        bankVerification as Record<string, unknown>,
      );
    }

    owner.ownerId = String(owner.owner_id || owner.id || "");
    owner.cashfreeStatus = owner.cashfree_status;
    owner.bankVerified = resolveOwnerVerificationState(owner).bankVerified;

    return owner;
  },

  updateOwnerProfile: async (
    ownerId: string,
    updates: Record<string, unknown>,
  ) => {
    const dbUpdates = { ...updates };
    if (dbUpdates.bankDetails) {
      const bank = dbUpdates.bankDetails as {
        accountHolderName?: string;
        bankName?: string;
        ifscCode?: string;
        accountNumber?: string;
      };
      dbUpdates.bank_details = bank;
      if (bank.accountHolderName) {
        dbUpdates.account_holder_name = bank.accountHolderName;
      }
      delete dbUpdates.bankDetails;
    }
    await supabase.from("owners").upsert({ id: ownerId, ...dbUpdates });
  },

  subscribeToOwner: (ownerId: string, callback: (data: unknown) => void) => {
    const fetch = async () => {
      try {
        const data = await ownerService.getOwnerProfile(ownerId);
        callback(data);
      } catch (error) {
        console.error("[ownerService] Unable to load owner profile:", error);
        callback(null);
      }
    };
    fetch();

    return deferRealtimeSubscription(() => {
      const ownerChannel = supabase
        .channel(`owner-profile-${ownerId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "owners",
            filter: `id=eq.${ownerId}`,
          },
          fetch,
        )
        .subscribe();

      const bankChannel = supabase
        .channel(`owner-bank-${ownerId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "owner_bank_accounts",
            filter: `owner_id=eq.${ownerId}`,
          },
          fetch,
        )
        .subscribe();

      const verificationChannel = supabase
        .channel(`owner-bank-verification-summary-${ownerId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: OWNER_VERIFICATION_TABLE,
            filter: `owner_id=eq.${ownerId}`,
          },
          fetch,
        )
        .subscribe();

      return () => {
        supabase.removeChannel(ownerChannel);
        supabase.removeChannel(bankChannel);
        supabase.removeChannel(verificationChannel);
      };
    });
  },

  subscribeToBankVerification: (
    ownerId: string,
    callback: (status: {
      bank_verification_status: string;
      verified: boolean;
      cashfree_beneficiary_id?: string | null;
    } | null) => void,
  ) => {
    const fetchStatus = async () => {
      const { data } = await supabase
        .from("owner_bank_accounts")
        .select("bank_verification_status, verified, cashfree_beneficiary_id")
        .eq("owner_id", ownerId)
        .maybeSingle();

      callback(data || null);
    };

    fetchStatus();

    const channel = supabase
      .channel(`owner-bank-verification-${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "owner_bank_accounts",
          filter: `owner_id=eq.${ownerId}`,
        },
        fetchStatus,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  getBankVerificationOverview: async (ownerId: string, limit = 10) => {
    return fetchBankVerificationOverviewDirect(ownerId, limit);
  },

  verifyOwnerBank: async (payload: {
    ownerId?: string;
    accountHolderName?: string;
    accountNumber?: string;
    confirmAccountNumber?: string;
    ifsc?: string;
    forceNewBeneficiary?: boolean;
  }) => {
    return invokeProtectedEdgeFunction<{
      success: boolean;
      verification: OwnerBankVerificationRecord | null;
      history: OwnerBankVerificationHistoryEntry[];
      transfer_id?: string;
      message?: string;
    }>(
      "verify-owner-bank",
      {
        ...(payload.ownerId ? { ownerId: payload.ownerId } : {}),
        accountHolderName: payload.accountHolderName,
        accountNumber: payload.accountNumber,
        confirmAccountNumber: payload.confirmAccountNumber,
        ifsc: payload.ifsc,
        forceNewBeneficiary: payload.forceNewBeneficiary === true,
      },
      "Unable to verify bank account",
    );
  },

  resetOwnerBankDetails: async (input: {
    ownerId?: string;
    accountHolderName?: string;
    accountNumber?: string;
    confirmAccountNumber?: string;
    ifsc?: string;
  }) => {
    return invokeProtectedEdgeFunction<{
      success: boolean;
      reset_required?: boolean;
      verification: OwnerBankVerificationRecord | null;
      history: OwnerBankVerificationHistoryEntry[];
      transfer_id?: string;
    }>(
      "reset-owner-bank",
      {
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        accountHolderName: input.accountHolderName,
        accountNumber: input.accountNumber,
        confirmAccountNumber: input.confirmAccountNumber,
        ifsc: input.ifsc,
      },
      "Unable to reset bank details",
    );
  },

  subscribeToBankVerificationOverview: (
    ownerId: string,
    callback: (data: {
      verification: OwnerBankVerificationRecord | null;
      history: OwnerBankVerificationHistoryEntry[];
    }) => void,
  ) => {
    const fetchOverview = async () => {
      try {
        const overview = await ownerService.getBankVerificationOverview(ownerId);
        callback(overview);
      } catch (error) {
        console.error(
          "[ownerService] Unable to refresh bank verification overview:",
          error,
        );
      }
    };

    void fetchOverview();

    const currentChannel = supabase
      .channel(`owner-bank-verification-current-${ownerId}`)
      .on(
        "postgres_changes",
        {
            event: "*",
            schema: "public",
            table: OWNER_VERIFICATION_TABLE,
            filter: `owner_id=eq.${ownerId}`,
          },
          fetchOverview,
      )
      .subscribe();

    const historyChannel = supabase
      .channel(`owner-bank-verification-history-${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "owner_bank_verification_history",
          filter: `owner_id=eq.${ownerId}`,
        },
        fetchOverview,
      )
      .subscribe();

    const bankAccountChannel = supabase
      .channel(`owner-bank-verification-account-${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "owner_bank_accounts",
          filter: `owner_id=eq.${ownerId}`,
        },
        fetchOverview,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(currentChannel);
      supabase.removeChannel(historyChannel);
      supabase.removeChannel(bankAccountChannel);
    };
  },
};
