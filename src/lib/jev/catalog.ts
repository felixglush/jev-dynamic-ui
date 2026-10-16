/**
 * The action catalog: every action the banking app can perform and the parameters each one takes.
 *
 * This is the single source of truth. The classifier builds its Jev questions from it, the result
 * types in types.ts are derived from it, and the UI gets one component per entry. Add an action
 * here and TypeScript will point at every place that still needs updating.
 *
 * `as const` freezes the object into literal types ("send_etransfer", not just string), and
 * `satisfies` checks the shape without widening those literals back to plain strings.
 */

/** How a parameter's value is found. See candidates.ts for the non-choice types. */
export type ParamSpec =
  | { type: "name" | "email" | "phone" | "amount" | "date" | "account_number"; question: string; required?: boolean }
  | { type: "choice"; question: string; required?: boolean; options: Record<string, string> };

export type ActionSpec = {
  /** Shown to Jev as the description of this action, so it should say when the action applies. */
  description: string;
  params: Record<string, ParamSpec>;
};

/** Longest chat message accepted. Shared so the input's maxLength and the server check agree. */
export const MAX_MESSAGE_LENGTH = 500;

/** Judgments below this confidence are flagged for the customer to double-check. */
export const LOW_CONFIDENCE = 0.6;

const ACCOUNT_OPTIONS = {
  chequing: "The chequing account.",
  savings: "The savings account.",
} as const;

/** Accounts money can move between. Payments to other people and bills only come from the first two. */
const OWN_ACCOUNT_OPTIONS = {
  chequing: "The chequing account.",
  savings: "The savings account.",
  tfsa: "The Tax-Free Savings Account (TFSA).",
  rrsp: "The Registered Retirement Savings Plan (RRSP).",
  fhsa: "The First Home Savings Account (FHSA).",
} as const;

/** How often a payment repeats. Shared by everything that can be scheduled; none means it doesn't repeat. */
export const FREQUENCY_OPTIONS = {
  weekly: "Repeats every week.",
  biweekly: "Repeats every two weeks.",
  monthly: "Repeats every month.",
} as const;

const DATE_QUESTION =
  "On what date does the customer want the payment in `query` to happen (or start, if it repeats)? Pick none if it should happen right away.";
const FREQUENCY_QUESTION =
  "How often should the payment in `query` repeat? Pick none if the query doesn't say it repeats.";

export const CATALOG = {
  add_etransfer_contact: {
    description:
      "Add a new person as an Interac e-Transfer recipient (a saved contact), without sending money yet.",
    params: {
      name: {
        type: "name",
        required: true,
        question:
          "What is the name or nickname of the person the customer wants to save as an e-Transfer contact in `query`? A relationship alone (like 'my sister') counts only if no name is given.",
      },
      email: {
        type: "email",
        question: "Which email address belongs to the new e-Transfer contact in `query`?",
      },
      phone: {
        type: "phone",
        question: "Which phone number belongs to the new e-Transfer contact in `query`?",
      },
    },
  },
  send_etransfer: {
    description: "Send money to another person by Interac e-Transfer, now or on a schedule.",
    params: {
      recipient: {
        type: "name",
        required: true,
        question:
          "Who is the person the customer wants to send money to in `query`? Pick their name or nickname.",
      },
      recipient_email: {
        type: "email",
        question: "Which email address should the e-Transfer in `query` be sent to?",
      },
      amount: {
        type: "amount",
        required: true,
        question: "How much money does the customer want to send by e-Transfer in `query`?",
      },
      from_account: {
        type: "choice",
        question: "Which of the customer's accounts should the e-Transfer in `query` come out of?",
        options: ACCOUNT_OPTIONS,
      },
      date: { type: "date", question: DATE_QUESTION },
      frequency: { type: "choice", question: FREQUENCY_QUESTION, options: FREQUENCY_OPTIONS },
    },
  },
  pay_credit_card: {
    description: "Make a payment toward the customer's credit card balance.",
    params: {
      payment_option: {
        type: "choice",
        required: true,
        question: "How much of the credit card balance does the customer want to pay in `query`?",
        options: {
          minimum: "The minimum payment due.",
          statement_balance: "The balance on the latest statement, which is what is due by the due date.",
          current_balance: "Everything owed right now, including purchases not yet on a statement.",
          custom: "A specific dollar amount the customer states.",
        },
      },
      amount: {
        type: "amount",
        question:
          "Which specific dollar amount does the customer want to pay toward the credit card in `query`?",
      },
      from_account: {
        type: "choice",
        question:
          "Which of the customer's accounts should the credit card payment in `query` come out of?",
        options: ACCOUNT_OPTIONS,
      },
    },
  },
  open_account: {
    description: "Open a new account or product with the bank.",
    params: {
      account_type: {
        type: "choice",
        required: true,
        question: "What kind of account does the customer want to open in `query`?",
        options: {
          chequing: "A chequing account for everyday banking.",
          savings: "A regular high-interest savings account.",
          tfsa: "A Tax-Free Savings Account (TFSA).",
          rrsp: "A Registered Retirement Savings Plan (RRSP).",
          fhsa: "A First Home Savings Account (FHSA).",
          gic: "A Guaranteed Investment Certificate (GIC) or term deposit.",
          credit_card: "A new credit card.",
        },
      },
      initial_deposit: {
        type: "amount",
        question:
          "How much money does the customer want to put into the new account when opening it in `query`?",
      },
      from_account: {
        type: "choice",
        question: "Which of the customer's accounts should the opening deposit in `query` come out of?",
        options: ACCOUNT_OPTIONS,
      },
    },
  },
  transfer_between_accounts: {
    description:
      "Move money between the customer's own accounts (for example chequing to savings or into a TFSA), now or on a schedule. Not for paying another person, a bill or a credit card.",
    params: {
      from_account: {
        type: "choice",
        required: true,
        question: "Which of the customer's own accounts should the money in `query` come out of?",
        options: OWN_ACCOUNT_OPTIONS,
      },
      to_account: {
        type: "choice",
        required: true,
        question: "Which of the customer's own accounts should the money in `query` go into?",
        options: OWN_ACCOUNT_OPTIONS,
      },
      amount: {
        type: "amount",
        required: true,
        question: "How much money does the customer want to move between their accounts in `query`?",
      },
      date: { type: "date", question: DATE_QUESTION },
      frequency: { type: "choice", question: FREQUENCY_QUESTION, options: FREQUENCY_OPTIONS },
    },
  },
  pay_bill: {
    description:
      "Pay a bill to a company or biller such as a utility, phone, internet, insurance or tax payee, now or on a schedule. Not credit card payments, and not e-Transfers to people.",
    params: {
      payee: {
        type: "name",
        required: true,
        question: "Which company or biller does the customer want to pay in `query`?",
      },
      amount: {
        type: "amount",
        required: true,
        question: "How much does the customer want to pay toward the bill in `query`?",
      },
      from_account: {
        type: "choice",
        question: "Which of the customer's accounts should the bill payment in `query` come out of?",
        options: ACCOUNT_OPTIONS,
      },
      date: { type: "date", question: DATE_QUESTION },
      frequency: { type: "choice", question: FREQUENCY_QUESTION, options: FREQUENCY_OPTIONS },
    },
  },
  add_payee: {
    description:
      "Add a new biller (a company the customer pays bills to) along with the customer's account number with it, without paying it yet.",
    params: {
      biller: {
        type: "name",
        required: true,
        question: "What is the name of the company or biller the customer wants to add as a payee in `query`?",
      },
      account_number: {
        type: "account_number",
        required: true,
        question: "Which number is the customer's account number with the new biller in `query`?",
      },
    },
  },
  manage_card: {
    description:
      "Lock or unlock a debit or credit card, or order a replacement for a lost, stolen or damaged card.",
    params: {
      card_action: {
        type: "choice",
        required: true,
        question: "What does the customer want done with their card in `query`?",
        options: {
          lock: "Temporarily lock or freeze the card so it can't be used.",
          unlock: "Unlock or unfreeze a locked card.",
          replace: "Order a replacement card, for example because it is lost, stolen or damaged.",
        },
      },
      card: {
        type: "choice",
        required: true,
        question: "Which card does the customer mean in `query`?",
        options: { debit: "The debit card.", credit: "The credit card." },
      },
      reason: {
        type: "choice",
        question: "Why does the customer need a replacement card in `query`?",
        options: {
          lost: "The card is lost.",
          stolen: "The card was stolen.",
          damaged: "The card is damaged or no longer works.",
        },
      },
    },
  },
  view_account: {
    description: "Show the balance of an account or its recent transactions. Read-only; nothing changes.",
    params: {
      account: {
        type: "choice",
        required: true,
        question: "Which account does the customer want to look at in `query`?",
        options: { ...OWN_ACCOUNT_OPTIONS, credit_card: "The credit card." },
      },
      view: {
        type: "choice",
        question: "What does the customer want to see in `query`?",
        options: {
          balance: "How much money is in the account right now.",
          transactions: "The recent transactions or activity on the account.",
        },
      },
    },
  },
  request_etransfer: {
    description: "Ask another person to send the customer money by Interac e-Transfer (a money request).",
    params: {
      // Not required here: the form accepts a name or an email, whichever the customer gives.
      from_person: {
        type: "name",
        question: "Who does the customer want to request money from in `query`?",
      },
      from_email: {
        type: "email",
        question: "Which email address should the e-Transfer request in `query` be sent to?",
      },
      amount: {
        type: "amount",
        required: true,
        question: "How much money does the customer want to request by e-Transfer in `query`?",
      },
    },
  },
  cancel_etransfer: {
    description: "Cancel an Interac e-Transfer the customer already sent that hasn't been accepted yet.",
    params: {
      recipient: {
        type: "name",
        required: true,
        question: "Who was the e-Transfer the customer wants to cancel in `query` sent to?",
      },
      amount: {
        type: "amount",
        question: "How much was the e-Transfer the customer wants to cancel in `query`?",
      },
    },
  },
  setup_autodeposit: {
    description:
      "Turn on Interac e-Transfer Autodeposit, so money sent to the customer's email address or phone number goes straight into an account.",
    params: {
      deposit_account: {
        type: "choice",
        required: true,
        question: "Which account should e-Transfers in `query` be deposited into automatically?",
        options: ACCOUNT_OPTIONS,
      },
      email: {
        type: "email",
        question: "Which email address does the customer want to turn Autodeposit on for in `query`?",
      },
      phone: {
        type: "phone",
        question: "Which phone number does the customer want to turn Autodeposit on for in `query`?",
      },
    },
  },
  dispute_transaction: {
    description:
      "Report a charge on an account or card as wrong, fraudulent or unrecognized, and ask the bank to investigate.",
    params: {
      merchant: {
        type: "name",
        required: true,
        question: "Which merchant or business made the charge the customer is disputing in `query`?",
      },
      amount: {
        type: "amount",
        question: "How much was the charge the customer is disputing in `query`?",
      },
      date: {
        type: "date",
        question: "On what date was the charge the customer is disputing in `query`?",
      },
      reason: {
        type: "choice",
        question: "Why does the customer dispute the charge in `query`?",
        options: {
          unrecognized: "The customer doesn't recognize the charge, or thinks it is fraud.",
          duplicate: "The customer was charged more than once.",
          wrong_amount: "The customer was charged a different amount than they agreed to.",
          not_received: "The customer paid for goods or services they never received.",
        },
      },
    },
  },
  update_contact_info: {
    description: "Change the customer's own phone number, email address or mailing address on file with the bank.",
    params: {
      contact_type: {
        type: "choice",
        required: true,
        question: "Which piece of the customer's own contact information do they want to change in `query`?",
        options: {
          phone: "Their phone number.",
          email: "Their email address.",
          address: "Their mailing or home address.",
        },
      },
      new_email: {
        type: "email",
        question: "What is the customer's new email address in `query`?",
      },
      new_phone: {
        type: "phone",
        question: "What is the customer's new phone number in `query`?",
      },
    },
  },
} as const satisfies Record<string, ActionSpec>;
