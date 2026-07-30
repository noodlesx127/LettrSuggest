import { expect, test } from "@playwright/test";

const email = process.env.TEST_USER_EMAIL;
const password = process.env.TEST_USER_PASSWORD;

test("auth forms protect credentials before client handlers run", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  try {
    for (const [path, buttonName] of [
      ["/auth/login", "Sign in"],
      ["/auth/register", "Create account"],
    ] as const) {
      await page.goto(path);
      const button = page.getByRole("button", {
        name: buttonName,
        exact: true,
      });
      await expect(button).toBeDisabled();
      await expect(button.locator("xpath=ancestor::form")).toHaveAttribute(
        "method",
        "post",
      );
    }
  } finally {
    await context.close();
  }
});

test.describe("authenticated recommendation pages", () => {
  test.beforeAll(() => {
    if (!email || !password) {
      test.skip();
    }
  });

  test("render their headings and controls without generating recommendations", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.locator('input[type="email"]').fill(email!);
    await page.locator('input[type="password"]').fill(password!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    // Keep /suggest's automatic generation guard closed with inert client-only state.
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "lettrsuggest_items",
        JSON.stringify([
          { id: 27205, title: "Smoke fixture", reasons: [], score: 0 },
        ]),
      );
    });

    const generationRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/suggest"
      ) {
        generationRequests.push(request.url());
      }
    });

    await page.goto("/suggest");
    await expect(
      page.getByRole("heading", { name: "Suggestions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Improve Suggestions Quiz",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quick", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Deep dive", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Exclude genres (comma)")).toBeVisible();
    await expect(page.getByLabel("Year min")).toBeVisible();
    await expect(page.getByLabel("Year max")).toBeVisible();
    expect(generationRequests).toHaveLength(0);

    await page.goto("/genre-suggest");
    await expect(
      page.getByRole("heading", { name: "Genre Picks", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Select Genres", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Select All", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Clear All", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Get Genre Suggestions",
        exact: true,
      }),
    ).toBeVisible();
    expect(generationRequests).toHaveLength(0);
  });
});
