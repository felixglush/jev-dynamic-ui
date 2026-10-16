import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { ScheduleFields } from "./schedule-fields";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function PayBill({ call }: { call: Extract<ActionCall, { action: "pay_bill" }> }) {
  const { payee, amount, from_account, date, frequency } = call.params;
  return (
    <ActionForm title="Pay a Bill" description="Pay a company, now or on a schedule." submitLabel="Pay Bill">
      <ParamField name="payee" label="Pay to" param={payee} required />
      <ParamField name="amount" label="Amount (CAD)" param={amount} required type="number" placeholder="0.00" />
      <ParamField name="from_account" label="From account" param={from_account} options={CATALOG.pay_bill.params.from_account.options} />
      <ScheduleFields date={date} frequency={frequency} />
    </ActionForm>
  );
}
