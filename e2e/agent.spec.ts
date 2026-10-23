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
