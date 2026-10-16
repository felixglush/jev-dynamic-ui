import type { ActionCall } from "@/lib/jev/types";

import { AddEtransferContact } from "./add-etransfer-contact";
import { AddPayee } from "./add-payee";
import { CancelEtransfer } from "./cancel-etransfer";
import { DisputeTransaction } from "./dispute-transaction";
import { ManageCard } from "./manage-card";
import { OpenAccount } from "./open-account";
import { PayBill } from "./pay-bill";
import { PayCreditCard } from "./pay-credit-card";
import { RequestEtransfer } from "./request-etransfer";
import { SendEtransfer } from "./send-etransfer";
import { SetupAutodeposit } from "./setup-autodeposit";
import { TransferBetweenAccounts } from "./transfer-between-accounts";
import { UpdateContactInfo } from "./update-contact-info";
import { ViewAccount } from "./view-account";

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
    case "add_payee":
      return <AddPayee call={call} />;
    case "cancel_etransfer":
      return <CancelEtransfer call={call} />;
    case "dispute_transaction":
      return <DisputeTransaction call={call} />;
    case "manage_card":
      return <ManageCard call={call} />;
    case "pay_bill":
      return <PayBill call={call} />;
    case "request_etransfer":
      return <RequestEtransfer call={call} />;
    case "setup_autodeposit":
      return <SetupAutodeposit call={call} />;
    case "transfer_between_accounts":
      return <TransferBetweenAccounts call={call} />;
    case "update_contact_info":
      return <UpdateContactInfo call={call} />;
    case "view_account":
      return <ViewAccount call={call} />;
    default: {
      const unhandled: never = call;
      throw new Error(`No component for action: ${JSON.stringify(unhandled)}`);
    }
  }
}
