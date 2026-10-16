import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { ScheduleFields } from "./schedule-fields";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function SendEtransfer({ call }: { call: Extract<ActionCall, { action: "send_etransfer" }> }) {
  const { recipient, recipient_email, amount, from_account, date, frequency } = call.params;
  return (
    <ActionForm title="Send an e-Transfer" description="Review the details before you send." submitLabel="Send Money">
      <ParamField name="recipient" label="To" param={recipient} required />
      <ParamField name="recipient_email" label="Their email" param={recipient_email} type="email" />
      <ParamField name="amount" label="Amount (CAD)" param={amount} required type="number" placeholder="0.00" />
      <ParamField
        name="from_account"
        label="From account"
        param={from_account}
        options={CATALOG.send_etransfer.params.from_account.options}
      />
      <ScheduleFields date={date} frequency={frequency} />
    </ActionForm>
  );
}
