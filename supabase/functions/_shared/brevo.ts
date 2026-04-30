const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const getBrevoConfig = () => {
  const apiKey = Deno.env.get("BREVO_API_KEY") ?? "";
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") ?? "";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "RoomFindR";

  if (!apiKey || !senderEmail) {
    throw new Error("Brevo configuration is missing");
  }

  return {
    apiKey,
    senderEmail,
    senderName,
  };
};

export const sendBrevoEmail = async (input: {
  toEmail: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}): Promise<void> => {
  const { apiKey, senderEmail, senderName } = getBrevoConfig();

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [{ email: input.toEmail }],
      subject: input.subject,
      htmlContent: input.htmlContent,
      textContent: input.textContent,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to send email");
  }
};

const otpEmailHtml = (input: {
  eyebrow: string;
  title: string;
  message: string;
  otp: string;
  expiresInMinutes: number;
  footer: string;
}) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${input.title}</title>
    </head>
    <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f4f6;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
              <tr>
                <td style="padding:0 0 16px 4px;font-size:13px;line-height:20px;color:#6b7280;">
                  RoomFindR secure email
                </td>
              </tr>
              <tr>
                <td style="border-radius:28px;overflow:hidden;background-color:#ffffff;box-shadow:0 18px 50px rgba(15,23,42,0.12);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="padding:0;background:linear-gradient(135deg,#fff7ed 0%,#ffffff 42%,#f0fdf4 100%);">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="padding:28px 32px 18px 32px;">
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                  <td align="center" valign="middle" style="width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#f97316,#22c55e);color:#ffffff;font-size:22px;font-weight:700;">
                                    R
                                  </td>
                                  <td style="padding-left:14px;">
                                    <div style="font-size:20px;line-height:24px;font-weight:700;color:#111827;">RoomFindR</div>
                                    <div style="font-size:12px;line-height:18px;color:#6b7280;">${input.eyebrow}</div>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:0 32px 10px 32px;">
                              <div style="height:1px;background:linear-gradient(90deg,rgba(249,115,22,0.12),rgba(34,197,94,0.2));"></div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:12px 32px 32px 32px;">
                              <div style="display:inline-block;padding:7px 12px;border-radius:999px;background-color:#fff7ed;color:#c2410c;font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                                Verification Code
                              </div>
                              <h1 style="margin:18px 0 10px 0;font-size:32px;line-height:38px;font-weight:700;letter-spacing:-0.03em;color:#111827;">
                                ${input.title}
                              </h1>
                              <p style="margin:0 0 24px 0;font-size:16px;line-height:26px;color:#4b5563;">
                                ${input.message}
                              </p>
                              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:22px;">
                                <tr>
                                  <td style="border-radius:22px;border:1px solid #d1fae5;background:linear-gradient(135deg,#ffffff 0%,#f0fdf4 100%);padding:22px 20px;text-align:center;">
                                    <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#16a34a;margin-bottom:8px;">
                                      One-Time Password
                                    </div>
                                    <div style="font-size:38px;line-height:42px;font-weight:700;letter-spacing:0.34em;color:#f97316;text-indent:0.34em;">
                                      ${input.otp}
                                    </div>
                                  </td>
                                </tr>
                              </table>
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:18px;">
                                <tr>
                                  <td style="padding:10px 14px;border-radius:14px;background-color:#f0fdf4;color:#166534;font-size:13px;line-height:18px;font-weight:700;">
                                    Expires in ${input.expiresInMinutes} minutes
                                  </td>
                                </tr>
                              </table>
                              <p style="margin:0 0 10px 0;font-size:14px;line-height:22px;color:#6b7280;">
                                Enter this code in the RoomFindR app to continue. Do not share it with anyone.
                              </p>
                              <p style="margin:0;font-size:14px;line-height:22px;color:#6b7280;">
                                ${input.footer}
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

export const signupOtpTemplate = (otp: string): {
  subject: string;
  html: string;
  text: string;
} => {
  const subject = "RoomFindR signup verification code";
  const html = otpEmailHtml({
    eyebrow: "Signup verification",
    title: "Verify your RoomFindR account",
    message: "Use the code below to complete your signup and secure your new account.",
    otp,
    expiresInMinutes: 5,
    footer: "If you did not request this email, you can safely ignore it.",
  });
  const text =
    `Verify your RoomFindR account.\n\n` +
    `Your signup code is ${otp}.\n` +
    `It expires in 5 minutes.\n\n` +
    `If you did not request this email, you can safely ignore it.`;
  return { subject, html, text };
};

export const resetOtpTemplate = (otp: string): {
  subject: string;
  html: string;
  text: string;
} => {
  const subject = "RoomFindR password reset code";
  const html = otpEmailHtml({
    eyebrow: "Password reset",
    title: "Reset your RoomFindR password",
    message: "Use the code below to continue your password reset request.",
    otp,
    expiresInMinutes: 10,
    footer: "If you did not request a password reset, no further action is needed.",
  });
  const text =
    `Reset your RoomFindR password.\n\n` +
    `Your password reset code is ${otp}.\n` +
    `It expires in 10 minutes.\n\n` +
    `If you did not request a password reset, no further action is needed.`;
  return { subject, html, text };
};
