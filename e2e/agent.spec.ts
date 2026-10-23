import { expect, test } from "@playwright/test";

// The first app runs without AGENT_ENABLED and the second with it (see e2e/start-apps.mts), so the same spec
// checks both sides of the flag. The second app listens one port above the first.
const flagOnUrl = (baseURL: string, path: string) => {
  const url = new URL(path, baseURL);
  url.port = String(Number(url.port) + 1);
  return url.toString();
};

test("the agent page is a 404 while the flag is off, and the demo is unchanged", async ({ page }) => {
  const response = await page.goto("/agent");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Banking assistant" })).toBeVisible();
});

test("the agent page shows with AGENT_ENABLED=true", async ({ page, baseURL }) => {
  const response = await page.goto(flagOnUrl(baseURL!, "/agent"));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Finance assistant" })).toBeVisible();
});

test("a proposal opens the prefilled transfer form, and confirming it is answered in the chat", async ({ page, baseURL }) => {
  await page.goto(flagOnUrl(baseURL!, "/agent"));
  await expect(page.getByText("Your roof fund is behind.")).toBeVisible();

  const proposal = page.locator("[data-slot=card]", { hasText: "Raise to $900 a month" });
  await proposal.getByRole("button", { name: "Review" }).click();
  await expect(proposal.getByRole("heading", { name: "Transfer Between Your Accounts" })).toBeVisible();
  await expect(proposal.getByLabel("Amount (CAD)")).toHaveValue("900");
  await expect(proposal.getByLabel("From account")).toHaveValue("chequing");
  await expect(proposal.getByLabel("To account")).toHaveValue("savings");
  await expect(proposal.getByLabel("Repeats")).toHaveValue("monthly");

  await proposal.getByLabel("Amount (CAD)").press("Escape");
  await expect(proposal.getByLabel("Amount (CAD)")).toBeHidden();
  await proposal.getByRole("button", { name: "Review" }).click();

  await proposal.getByRole("button", { name: "Transfer" }).click();
  await expect(proposal.getByText("Confirmed")).toBeVisible();
  await expect(page.getByText("Done: raise to $900 a month. Moves the date to August 2027.")).toBeVisible();
});

test("a typed message shows in the chat with the not-connected reply", async ({ page, baseURL }) => {
  await page.goto(flagOnUrl(baseURL!, "/agent"));
  await page.getByLabel("Message").fill("how is my roof fund doing?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("how is my roof fund doing?")).toBeVisible();
  await expect(page.getByText("I'm not connected yet")).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("");
});
