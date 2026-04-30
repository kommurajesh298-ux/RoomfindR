export type OtpTable = "email_otps" | "password_reset_otps";

export type OtpRecord = {
  id: string;
  email: string;
  otp_hash: string;
  expires_at: string;
  attempts: number;
  used: boolean;
  created_at: string;
};

export const countRecentOtps = async (
  supabase: any,
  table: OtpTable,
  email: string,
  windowMinutes: number,
): Promise<number> => {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gt("created_at", windowStart);

  if (error) throw error;
  return count ?? 0;
};

export const insertOtpRecord = async (
  supabase: any,
  table: OtpTable,
  email: string,
  otpHash: string,
  expiryMinutes: number,
): Promise<void> => {
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();

  const { error } = await supabase.from(table).insert({
    email,
    otp_hash: otpHash,
    expires_at: expiresAt,
    attempts: 0,
    used: false,
  });

  if (error) throw error;
};

export const getLatestUnusedOtp = async (
  supabase: any,
  table: OtpTable,
  email: string,
): Promise<OtpRecord | null> => {
  const { data, error } = await supabase
    .from(table)
    .select("id, email, otp_hash, expires_at, attempts, used, created_at")
    .eq("email", email)
    .eq("used", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as OtpRecord | null) ?? null;
};

export const incrementOtpAttempt = async (
  supabase: any,
  table: OtpTable,
  otpId: string,
  nextAttempts: number,
): Promise<void> => {
  const { error } = await supabase
    .from(table)
    .update({ attempts: nextAttempts })
    .eq("id", otpId);

  if (error) throw error;
};

export const markOtpUsed = async (
  supabase: any,
  table: OtpTable,
  otpId: string,
): Promise<void> => {
  const { error } = await supabase
    .from(table)
    .update({ used: true })
    .eq("id", otpId);

  if (error) throw error;
};
