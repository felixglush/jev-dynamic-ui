"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function SetupAutodeposit({ call }: { call: Extract<ActionCall, { action: "setup_autodeposit" }> }) {
  const { deposit_account, email, phone } = call.params;
  // Autodeposit is registered to an email or a mobile number, so each is required only while the other is empty.
  const [emailValue, setEmailValue] = useState(email.value ?? "");
  const [phoneValue, setPhoneValue] = useState(phone.value ?? "");

  return (
    <ActionForm
      title="Turn On Autodeposit"
      description="Money sent to you by e-Transfer goes straight into your account."
      submitLabel="Turn On Autodeposit"
    >
      <ParamField
        name="deposit_account"
        label="Deposit into"
        param={deposit_account}
        required
        options={CATALOG.setup_autodeposit.params.deposit_account.options}
      />
      <ParamField name="email" label="Your email" param={email} type="email" required={phoneValue.trim() === ""} onValue={setEmailValue} />
      <ParamField name="phone" label="Your mobile number" param={phone} type="tel" required={emailValue.trim() === ""} onValue={setPhoneValue} />
    </ActionForm>
  );
}
