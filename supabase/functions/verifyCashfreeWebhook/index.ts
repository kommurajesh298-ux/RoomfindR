import { handleCashfreeWebhookRequest } from "../_shared/cashfree-webhook-handler.ts";

Deno.serve((req: Request) => handleCashfreeWebhookRequest(req));
