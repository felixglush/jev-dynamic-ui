"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function PayCreditCard({ call }: { call: Extract<ActionCall, { action: "pay_credit_card" }> }) {
  const { payment_option, amount, from_account } = call.params;
  // The amount is only needed for "custom", so the form has to know which option is selected.
  const [option, setOption] = useState(payment_option.value ?? "");

  return (
    <ActionForm
      title="Pay Your Credit Card"
      description="Choose how much to pay and where it comes from."
      submitLabel="Make Payment"
    >
      <ParamField
        name="payment_option"
        label="How much"
        param={payment_option}
        required
        options={CATALOG.pay_credit_card.params.payment_option.options}
        onSelect={setOption}
      />
      <ParamField
        name="amount"
        label="Custom amount (CAD)"
        param={amount}
        required={option === "custom"}
        type="number"
        placeholder="0.00"
      />
      <ParamField
        name="from_account"
        label="From account"
        param={from_account}
        options={CATALOG.pay_credit_card.params.from_account.options}
      />
    </ActionForm>
  );
}
