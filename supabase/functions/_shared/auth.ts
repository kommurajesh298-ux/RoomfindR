import { createServiceClient } from "./supabase.ts";

const getBearerToken = (req: Request): string => {
  const parseHeader = (value: string | null): string => {
    const header = String(value || "").trim();
    if (!header) return "";

    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }

    return header;
  };

  return (
    parseHeader(req.headers.get("x-supabase-auth")) ||
    parseHeader(req.headers.get("authorization"))
  );
};

export const requireAuthenticatedUser = async (req: Request) => {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired auth token");

  return { supabase, user: data.user };
};

export const requireAdminUser = async (req: Request) => {
  const { supabase, user } = await requireAuthenticatedUser(req);
  const { data, error } = await supabase
    .from("accounts")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || data?.role !== "admin") {
    throw new Error("Admin access required");
  }

  return { supabase, user };
};

export const requireOwnerOrAdminUser = async (req: Request) => {
  const { supabase, user } = await requireAuthenticatedUser(req);
  const { data, error } = await supabase
    .from("accounts")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data?.role || !["owner", "admin"].includes(data.role)) {
    throw new Error("Owner or admin access required");
  }

  return { supabase, user, role: data.role as "owner" | "admin" };
};
