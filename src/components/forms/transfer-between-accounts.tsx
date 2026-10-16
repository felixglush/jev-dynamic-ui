import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { ScheduleFields } from "./schedule-fields";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function TransferBetweenAccounts({
  call,
}: {
  call: Extract<ActionCall, { action: "transfer_between_accounts" }>;
}) {
  const { from_account, to_account, amount, date, frequency } = call.params;
  const { params } = CATALOG.transfer_between_accounts;
  return (
    <ActionForm
      title="Transfer Between Your Accounts"
      description="Move money between your own accounts."
      submitLabel="Transfer"
    >
      <ParamField name="from_account" label="From account" param={from_account} required options={params.from_account.options} />
      <ParamField name="to_account" label="To account" param={to_account} required options={params.to_account.options} />
      <ParamField name="amount" label="Amount (CAD)" param={amount} required type="number" placeholder="0.00" />
      <ScheduleFields date={date} frequency={frequency} />
    </ActionForm>
  );
}
