import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function DisputeTransaction({ call }: { call: Extract<ActionCall, { action: "dispute_transaction" }> }) {
  const { merchant, amount, date, reason } = call.params;
  return (
    <ActionForm
      title="Dispute a Charge"
      description="Tell us about the charge and we’ll look into it."
      submitLabel="Submit Dispute"
    >
      <ParamField name="merchant" label="Merchant" param={merchant} required />
      <ParamField name="amount" label="Amount (CAD)" param={amount} type="number" placeholder="0.00" />
      <ParamField name="date" label="Date of the charge" param={date} type="date" />
      <ParamField name="reason" label="What went wrong" param={reason} options={CATALOG.dispute_transaction.params.reason.options} />
    </ActionForm>
  );
}
