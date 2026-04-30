import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Signup from "../Signup";
import { authService } from "../../services/auth.service";
import { useAuth } from "../../hooks/useAuth";

jest.mock("../../services/auth.service");
jest.mock("../../hooks/useAuth");
jest.mock("react-hot-toast", () => ({
  success: jest.fn(),
  error: jest.fn(),
  loading: jest.fn(),
  dismiss: jest.fn(),
  custom: jest.fn(),
}));

const completeAccountStep = () => {
  fireEvent.change(screen.getByPlaceholderText("Full Name"), {
    target: { value: "Test Owner" },
  });
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "owner@test.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("Contact Number"), {
    target: { value: "9876543210" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "Password1" },
  });
  fireEvent.change(screen.getByPlaceholderText("Confirm Password"), {
    target: { value: "Password1" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
};

const uploadLicenseStep = async () => {
  const file = new File(["license"], "license.png", { type: "image/png" });

  fireEvent.change(await screen.findByLabelText("License Document"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload License" }));

  await waitFor(() => {
    expect(authService.uploadOwnerLicensePreSignup).toHaveBeenCalledWith({
      email: "owner@test.com",
      phone: "9876543210",
      name: "Test Owner",
      file,
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Continue to Bank Details" }));
};

describe("Owner Signup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    (useAuth as jest.Mock).mockReturnValue({
      currentUser: null,
      ownerData: null,
      loading: false,
      refreshUserData: jest.fn().mockResolvedValue(undefined),
    });
    (authService.checkEmailExists as jest.Mock).mockResolvedValue(false);
    (authService.checkPhoneExists as jest.Mock).mockResolvedValue(false);
    (authService.requestEmailOtp as jest.Mock).mockResolvedValue({
      success: true,
      message: "OTP sent",
    });
    (authService.uploadOwnerLicensePreSignup as jest.Mock).mockResolvedValue({
      success: true,
      message: "License document uploaded successfully.",
      document: {
        id: "license_123",
        document_url: "https://test.com/license.png",
        document_name: "license.png",
        mime_type: "image/png",
        file_size_bytes: 2048,
      },
    });
    (authService.verifyEmailOtp as jest.Mock).mockResolvedValue({
      success: true,
      user_id: "owner_123",
      account_status: "pending_admin_approval",
    });
    (authService.signInWithEmail as jest.Mock).mockResolvedValue({
      user: { id: "owner_123" },
    });
    (authService.updateUserProfile as jest.Mock).mockResolvedValue(undefined);
    (authService.verifyOwnerBankPreSignup as jest.Mock).mockResolvedValue({
      success: true,
      verification: {
        transfer_status: "success",
        status_message: "Bank account verified successfully.",
      },
      transfer_id: "VRF_TEST_123",
    });
  });

  it("completes signup through bank verification and OTP", async () => {
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );

    completeAccountStep();

    await waitFor(() => {
      expect(authService.checkEmailExists).toHaveBeenCalled();
    });

    await uploadLicenseStep();

    fireEvent.change(
      await screen.findByPlaceholderText("Account Holder Full Name"),
      {
        target: { value: "Test Owner" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("IFSC Code"), {
      target: { value: "HDFC0001234" },
    });
    fireEvent.change(screen.getByPlaceholderText("Account Number"), {
      target: { value: "123456789012" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm Account Number"), {
      target: { value: "123456789012" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify Bank Account" }));

    await waitFor(() => {
      expect(authService.verifyOwnerBankPreSignup).toHaveBeenCalledWith({
        name: "Test Owner",
        email: "owner@test.com",
        phone: "9876543210",
        accountHolderName: "Test Owner",
        accountNumber: "123456789012",
        confirmAccountNumber: "123456789012",
        ifsc: "HDFC0001234",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Send OTP" }));

    await waitFor(() => {
      expect(authService.requestEmailOtp).toHaveBeenCalledWith("owner@test.com", {
        role: "owner",
        phone: "9876543210",
        transferId: "VRF_TEST_123",
      });
    });

    await screen.findByText("Email Verification Code");

    const otpInputs = screen.getAllByRole("textbox");
    fireEvent.change(otpInputs[0], { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify OTP" }));

    await waitFor(() => {
      expect(authService.verifyEmailOtp).toHaveBeenCalledWith({
        email: "owner@test.com",
        otp: "123456",
        password: "Password1",
        role: "owner",
        name: "Test Owner",
        phone: "9876543210",
        transferId: "VRF_TEST_123",
      });
    });

    await waitFor(() => {
      expect(authService.signInWithEmail).toHaveBeenCalledWith(
        "owner@test.com",
        "Password1",
      );
    });
  });

  it("shows password validation immediately while typing", async () => {
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "password1" },
    });

    expect(
      screen.getByText(
        "Password must be at least 8 characters and include upper/lowercase letters and a number.",
      ),
    ).toBeInTheDocument();
  });

  it("shows email and phone duplicate errors before continuing", async () => {
    (authService.checkEmailExists as jest.Mock).mockResolvedValue(true);
    (authService.checkPhoneExists as jest.Mock).mockResolvedValue(true);

    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "owner@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Contact Number"), {
      target: { value: "9876543210" },
    });

    await waitFor(() => {
      expect(authService.checkEmailExists).toHaveBeenCalledWith("owner@test.com");
    });
    await waitFor(() => {
      expect(authService.checkPhoneExists).toHaveBeenCalledWith("9876543210");
    });

    expect(screen.getByText("Email is already registered.")).toBeInTheDocument();
    expect(screen.getByText("Phone number is already registered.")).toBeInTheDocument();
  });

  it("polls existing pending verification without creating a duplicate transfer", async () => {
    (authService.verifyOwnerBankPreSignup as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        verification: {
          transfer_status: "pending",
          status_message: "Verifying your bank account. Please wait...",
        },
        transfer_id: "VRF_PENDING_123",
      })
      .mockResolvedValueOnce({
        success: true,
        verification: {
          transfer_status: "success",
          status_message: "Bank account verified successfully.",
        },
        transfer_id: "VRF_PENDING_123",
      });

    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );

    completeAccountStep();

    await uploadLicenseStep();

    await screen.findByPlaceholderText("Account Holder Full Name");

    fireEvent.change(screen.getByPlaceholderText("Account Holder Full Name"), {
      target: { value: "Test Owner" },
    });
    fireEvent.change(screen.getByPlaceholderText("IFSC Code"), {
      target: { value: "HDFC0001234" },
    });
    fireEvent.change(screen.getByPlaceholderText("Account Number"), {
      target: { value: "123456789012" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm Account Number"), {
      target: { value: "123456789012" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify Bank Account" }));

    await waitFor(() => {
      expect(authService.verifyOwnerBankPreSignup).toHaveBeenNthCalledWith(1, {
        name: "Test Owner",
        email: "owner@test.com",
        phone: "9876543210",
        accountHolderName: "Test Owner",
        accountNumber: "123456789012",
        confirmAccountNumber: "123456789012",
        ifsc: "HDFC0001234",
      });
    });

    expect(
      screen.getByRole("button", { name: "Verification Pending" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send OTP" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Check Status" }));

    await waitFor(() => {
      expect(authService.verifyOwnerBankPreSignup).toHaveBeenNthCalledWith(2, {
        email: "owner@test.com",
        phone: "9876543210",
        transferId: "VRF_PENDING_123",
        statusOnly: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send OTP" })).not.toBeDisabled();
    });
  });

  it("resumes a pending verification from session storage", async () => {
    window.sessionStorage.setItem(
      "owner-signup-bank-verification",
      JSON.stringify({
        name: "Saved Owner",
        email: "saved@test.com",
        phone: "9876543210",
        accountHolderName: "Saved Owner",
        ifsc: "HDFC0001234",
        transferId: "VRF_RESUME_123",
        transferStatus: "pending",
        message: "Verifying your bank account. Please wait...",
      }),
    );
    (authService.verifyOwnerBankPreSignup as jest.Mock).mockResolvedValueOnce({
      success: true,
      verification: {
        transfer_status: "success",
        status_message: "Bank account verified successfully.",
      },
      transfer_id: "VRF_RESUME_123",
    });

    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(authService.verifyOwnerBankPreSignup).toHaveBeenCalledWith({
        email: "saved@test.com",
        phone: "9876543210",
        transferId: "VRF_RESUME_123",
        statusOnly: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send OTP" })).not.toBeDisabled();
    });
  });

  it("returns focus to Send OTP after closing the already verified popup", async () => {
    (authService.verifyOwnerBankPreSignup as jest.Mock).mockResolvedValueOnce({
      success: true,
      already_verified: true,
      verification: {
        transfer_status: "success",
        status_message: "Bank account verified successfully.",
      },
      transfer_id: "VRF_TEST_123",
    });

    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );

    completeAccountStep();

    await uploadLicenseStep();

    fireEvent.change(
      await screen.findByPlaceholderText("Account Holder Full Name"),
      {
        target: { value: "Test Owner" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("IFSC Code"), {
      target: { value: "SBIN0008752" },
    });
    fireEvent.change(screen.getByPlaceholderText("Account Number"), {
      target: { value: "000100289877623" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm Account Number"), {
      target: { value: "000100289877623" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify Bank Account" }));

    await screen.findByText("These bank details are already verified for this signup.");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send OTP" })).toHaveFocus();
    });
  });
});
