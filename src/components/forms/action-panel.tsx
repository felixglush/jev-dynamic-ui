import type { ActionCall } from "@/lib/jev/types";

import { AddEtransferContact } from "./add-etransfer-contact";
import { OpenAccount } from "./open-account";
import { PayCreditCard } from "./pay-credit-card";
import { SendEtransfer } from "./send-etransfer";

/**
 * Pick the component for an action. Because `call` is a discriminated union, TypeScript narrows it
 * inside each `case`, and the `never` check in `default` fails to compile if an action in the
 * catalog has no case here.
 */
export function ActionPanel({ call }: { call: ActionCall }) {
  switch (call.action) {
    case "add_etransfer_contact":
      return <AddEtransferContact call={call} />;
    case "send_etransfer":
      return <SendEtransfer call={call} />;
    case "pay_credit_card":
      return <PayCreditCard call={call} />;
    case "open_account":
      return <OpenAccount call={call} />;
    default: {
      const unhandled: never = call;
      throw new Error(`No component for action: ${JSON.stringify(unhandled)}`);
    }
  }
}
