import { expect, test } from "@playwright/test";

test.describe("EdgeQA v1", () => {
  test("renders the landing page and primary CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/EdgeQA/);
    await expect(page.getByRole("heading", { name: /Ship confidence/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Create a QA link/ })).toBeVisible();
    await expect(page.getByText("QA without the trade-offs.")).toBeVisible();
  });

  test("validates and generates a protected link", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Create a QA link/ }).click();
    await expect(page.getByRole("heading", { name: /Bring your repo/ })).toBeVisible();
    await page.getByRole("button", { name: /Generate magic link/ }).click();
    await expect(page.getByText(/Add a repository/)).toBeVisible();

    await page.getByLabel("Repository URL").fill("https://github.com/acme/site");
    await page.getByLabel("GitHub fine-grained token").fill("github_pat_test");
    await page.getByLabel("Session PIN").fill("private-pin");
    await page.getByRole("button", { name: /Generate magic link/ }).click();
    await expect(page.getByText("YOUR SECURE QA LINK")).toBeVisible();
    await expect(page.getByRole("button", { name: /Open preview/ })).toBeVisible();
  });
});
