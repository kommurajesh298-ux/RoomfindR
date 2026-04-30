import { handleCashfreePayoutWebhook } from "../cashfree-payout-webhook/index.ts";

Deno.serve((req: Request) => handleCashfreePayoutWebhook(req));
