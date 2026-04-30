import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ForgotPassword from "../ForgotPassword";
import Login from "../Login";
import ResetPassword from "../ResetPassword";

jest.mock("../../services/auth.service");
jest.mock("../../services/owner.service");
jest.mock("react-hot-toast", () => ({
  success: jest.fn(),
  error: jest.fn(),
  loading: jest.fn(),
  dismiss: jest.fn(),
  custom: jest.fn(),
}));

describe("Auth form validation", () => {
  it("shows login email validation while typing", () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "bad-email" },
    });

    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
  });

  it("shows forgot-password email validation while typing", () => {
    render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "bad-email" },
    });

    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
  });

  it("shows reset-password validation while typing", () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("New Password"), {
      target: { value: "password1" },
    });
    expect(
      screen.getByText(
        "Password must be at least 8 characters and include upper/lowercase letters and a number.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Confirm Password"), {
      target: { value: "Password2" },
    });
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });
});
