"use client";

import { useState } from "react";

import { ParamField } from "./param-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

// Sample figures only: no banking API is connected yet, so every customer sees these.
const BALANCES: Record<string, number> = {
  chequing: 2418.55,
  savings: 12040.1,
  tfsa: 8500,
  rrsp: 21300.75,
  fhsa: 4000,
  credit_card: -612.4,
};

const TRANSACTIONS = [
  { date: "Oct 14", description: "Grocery Store", amount: -86.42 },
  { date: "Oct 12", description: "Payroll deposit", amount: 1850 },
  { date: "Oct 11", description: "Coffee Shop", amount: -5.75 },
  { date: "Oct 9", description: "Hydro bill", amount: -112.3 },
];

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

/** A read-only panel: pick an account and what to see, and the sample figures show right away. */
export function ViewAccount({ call }: { call: Extract<ActionCall, { action: "view_account" }> }) {
  const { account: accountParam, view: viewParam } = call.params;
  const { params } = CATALOG.view_account;
  const [account, setAccount] = useState(accountParam.value ?? "");
  const [view, setView] = useState(viewParam.value ?? "balance");
  const accountName = account.replaceAll("_", " ");

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h2 className="text-balance">Your Account</h2>
        </CardTitle>
        <CardDescription>Demo only: these are sample figures, not your real accounts.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ParamField name="account" label="Account" param={accountParam} required options={params.account.options} onSelect={setAccount} />
        <ParamField name="view" label="Show" param={{ ...viewParam, value: view }} options={params.view.options} onSelect={setView} />
        <div aria-live="polite">
          {account !== "" && view === "balance" && (
            <p className="text-2xl font-semibold tabular-nums">
              {money.format(BALANCES[account] ?? 0)}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{accountName} balance</span>
            </p>
          )}
          {account !== "" && view === "transactions" && (
            <ul className="divide-y text-sm" aria-label={`Recent ${accountName} transactions`}>
              {TRANSACTIONS.map((t) => (
                <li key={t.description} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="mr-3 text-muted-foreground">{t.date}</span>
                    {t.description}
                  </span>
                  <span className="tabular-nums">{money.format(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
