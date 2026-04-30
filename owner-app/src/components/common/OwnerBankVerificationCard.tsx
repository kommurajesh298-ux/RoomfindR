import React, { useEffect, useMemo, useState } from "react";
import {
  IoAlertCircleOutline,
  IoCheckmarkCircleOutline,
  IoRefreshOutline,
  IoTimeOutline,
} from "react-icons/io5";
import { format } from "date-fns";

import { ownerService } from "../../services/owner.service";
import { useAuth } from "../../hooks/useAuth";
import { useOwner } from "../../hooks/useOwner";
import { showToast } from "../../utils/toast";
import Modal from "./Modal";
import type {
  OwnerBankVerificationHistoryEntry,
  OwnerBankVerificationRecord,
} from "../../types/owner.types";

type OverviewState = {
  verification: OwnerBankVerificationRecord | null;
  history: OwnerBankVerificationHistoryEntry[];
};

const initialOverview: OverviewState = {
  verification: null,
  history: [],
};

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const getStatusMeta = (status: string) => {
  if (status === "success") {
    return {
      label: "Verified",
      tone: "bg-blue-50 text-blue-700 border-blue-200",
      icon: <IoCheckmarkCircleOutline size={18} className="text-blue-500" />,
    };
  }

  if (status === "failed") {
    return {
      label: "Failed",
      tone: "bg-rose-50 text-rose-700 border-rose-200",
      icon: <IoAlertCircleOutline size={18} className="text-rose-500" />,
    };
  }

  return {
    label: "Pending",
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    icon: <IoTimeOutline size={18} className="text-amber-500" />,
  };
};

interface OwnerBankVerificationCardProps {
  heading?: string;
  subheading?: string;
}

const OwnerBankVerificationCard: React.FC<OwnerBankVerificationCardProps> = ({
  heading = "Bank Verification",
  subheading = "Track the Rs 1 test transfer and update bank details if verification is still pending or fails.",
}) => {
  const { currentUser } = useAuth();
  const { ownerData } = useOwner();
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [overview, setOverview] = useState<OverviewState>(initialOverview);
  const [showResetModal, setShowResetModal] = useState(false);
  const [formData, setFormData] = useState({
    accountHolderName: ownerData?.bankDetails?.accountHolderName || "",
    ifsc: ownerData?.bankDetails?.ifscCode || "",
    accountNumber: "",
    confirmAccountNumber: "",
  });

  useEffect(() => {
    setFormData((previous) => ({
      ...previous,
      accountHolderName: ownerData?.bankDetails?.accountHolderName || previous.accountHolderName,
      ifsc: ownerData?.bankDetails?.ifscCode || previous.ifsc,
    }));
  }, [ownerData?.bankDetails?.accountHolderName, ownerData?.bankDetails?.ifscCode]);

  useEffect(() => {
    if (!currentUser?.uid) return undefined;

    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const data = await ownerService.getBankVerificationOverview(currentUser.uid);
        if (mounted) setOverview(data);
      } catch (error) {
        if (mounted) {
          console.error("Failed to load bank verification overview", error);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    const unsubscribe = ownerService.subscribeToBankVerificationOverview(
      currentUser.uid,
      (data) => {
        if (mounted) {
          setOverview(data);
          setLoading(false);
        }
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [currentUser?.uid]);

  const inferredStatus = useMemo(() => {
    if (overview.verification?.transfer_status) {
      return overview.verification.transfer_status;
    }

    const ownerStatus = String(ownerData?.bankVerificationStatus || "").toLowerCase();
    if (ownerStatus === "verified") return "success";
    if (ownerStatus === "failed" || ownerStatus === "rejected") return "failed";
    return "pending";
  }, [overview.verification?.transfer_status, ownerData?.bankVerificationStatus]);

  const statusMeta = getStatusMeta(inferredStatus);
  const latestAttemptDate =
    overview.verification?.last_attempt_at || overview.verification?.created_at || null;
  const canEditBankDetails =
    inferredStatus === "failed" || !overview.verification?.id;

  const handleFormChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    const nextValue =
      name === "ifsc"
        ? value.toUpperCase().replace(/[^A-Z0-9]/g, "")
        : name === "accountNumber" || name === "confirmAccountNumber"
          ? value.replace(/\D/g, "")
          : value;
    setFormData((previous) => ({ ...previous, [name]: nextValue }));
  };

  const handleSubmitBankDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser?.uid) return;
    if (!formData.accountHolderName.trim()) {
      return showToast.error("Account holder name is required.");
    }
    if (!formData.ifsc.trim()) {
      return showToast.error("IFSC is required.");
    }
    if (!IFSC_PATTERN.test(formData.ifsc.trim().toUpperCase())) {
      return showToast.error("Please enter a valid IFSC code.");
    }
    if (!formData.accountNumber.trim() || !formData.confirmAccountNumber.trim()) {
      return showToast.error("Please enter and confirm the account number.");
    }
    if (formData.accountNumber.trim().length < 9) {
      return showToast.error("Please enter a valid account number.");
    }
    if (formData.accountNumber !== formData.confirmAccountNumber) {
      return showToast.error("Account numbers do not match.");
    }

    setResetting(true);
    try {
      const result = await ownerService.verifyOwnerBank({
        ownerId: currentUser.uid,
        accountHolderName: formData.accountHolderName,
        accountNumber: formData.accountNumber,
        confirmAccountNumber: formData.confirmAccountNumber,
        ifsc: formData.ifsc,
      });
      const transferStatus = result.verification?.transfer_status || "pending";
      showToast.success(
        transferStatus === "success"
          ? "Bank account verified successfully."
          : result.verification?.status_message || "Bank verification started.",
      );
      setShowResetModal(false);
      setFormData((previous) => ({
        ...previous,
        accountNumber: "",
        confirmAccountNumber: "",
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to reset bank details.";
      showToast.error(message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_38px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500">
              {heading}
            </p>
            <h3 className="mt-2 text-2xl font-black text-slate-900">
              Rs 1 Test Transfer Status
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">
              {subheading}
            </p>
          </div>

          <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-black ${statusMeta.tone}`}>
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Bank Account
            </p>
            <p className="mt-2 text-base font-bold text-slate-900">
              {overview.verification?.bank_account_number ||
                ownerData?.bankDetails?.accountNumber ||
                "Not available"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              IFSC
            </p>
            <p className="mt-2 text-base font-bold text-slate-900">
              {overview.verification?.ifsc_code || ownerData?.bankDetails?.ifscCode || "Not available"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Transaction ID
            </p>
            <p className="mt-2 break-all text-sm font-bold text-slate-900">
              {overview.verification?.transfer_reference_id || "Pending"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Last Attempt
            </p>
            <p className="mt-2 text-base font-bold text-slate-900">
              {latestAttemptDate ? format(new Date(latestAttemptDate), "dd MMM yyyy, hh:mm a") : "Pending"}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
          <p className="text-sm font-bold text-slate-900">
            {loading
              ? "Loading latest verification status..."
              : overview.verification?.status_message ||
                (inferredStatus === "success"
                  ? "Your bank account is verified."
                  : inferredStatus === "failed"
                    ? "Bank verification failed."
                    : "Verification in progress.")}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {canEditBankDetails ? (
            <button
              type="button"
              onClick={() => setShowResetModal(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800"
            >
              <IoRefreshOutline size={18} />
              {overview.verification?.id ? "Update Bank Details" : "Add Bank Details"}
            </button>
          ) : null}
        </div>

        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black uppercase tracking-[0.24em] text-slate-500">
              Verification History
            </h4>
            <span className="text-xs font-semibold text-slate-400">
              {overview.history.length} attempt{overview.history.length === 1 ? "" : "s"}
            </span>
          </div>

          {overview.history.length > 0 ? (
            <div className="grid gap-3">
              {overview.history.map((entry) => {
                const meta = getStatusMeta(entry.transfer_status);
                return (
                  <div
                    key={entry.id}
                    className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-[1.2fr_0.8fr_1fr]"
                  >
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                        Date
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        {format(new Date(entry.created_at), "dd MMM yyyy, hh:mm a")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                        Amount
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        Rs {Number(entry.transfer_amount || 0).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                        Status
                      </p>
                      <div className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${meta.tone}`}>
                        {meta.icon}
                        <span>{meta.label}</span>
                      </div>
                    </div>
                    <div className="md:col-span-3">
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                        Reference
                      </p>
                      <p className="mt-1 break-all text-sm font-semibold text-slate-700">
                        {entry.transfer_reference || "Pending"}
                      </p>
                      {entry.error_message ? (
                        <p className="mt-2 text-sm text-rose-600">{entry.error_message}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Verification history will appear here once the Rs 1 transfer is attempted.
            </div>
          )}
        </div>
      </section>

      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title={overview.verification?.id ? "Update Bank Details" : "Add Bank Details"}
      >
        <form className="space-y-4" onSubmit={handleSubmitBankDetails}>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {overview.verification?.id
              ? "Submit your updated bank details to trigger a fresh Rs 1 verification transfer."
              : "Enter your bank details to start the Rs 1 penny-drop verification."}
          </div>

          <label className="block space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
              Account Holder Name
            </span>
            <input
              id="accountHolderName"
              name="accountHolderName"
              autoComplete="name"
              value={formData.accountHolderName}
              onChange={handleFormChange}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400"
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
              IFSC
            </span>
            <input
              id="ifsc"
              name="ifsc"
              autoComplete="off"
              value={formData.ifsc}
              onChange={handleFormChange}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 uppercase outline-none transition focus:border-indigo-400"
              maxLength={11}
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
              Account Number
            </span>
            <input
              id="accountNumber"
              name="accountNumber"
              autoComplete="off"
              value={formData.accountNumber}
              onChange={handleFormChange}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400"
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
              Confirm Account Number
            </span>
            <input
              id="confirmAccountNumber"
              name="confirmAccountNumber"
              autoComplete="off"
              value={formData.confirmAccountNumber}
              onChange={handleFormChange}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-indigo-400"
              required
            />
          </label>

          <button
            type="submit"
            disabled={resetting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <IoRefreshOutline size={18} />
            {resetting
              ? "Submitting..."
              : overview.verification?.id
                ? "Submit And Retry Verification"
                : "Start Bank Verification"}
          </button>
        </form>
      </Modal>
    </>
  );
};

export default OwnerBankVerificationCard;

