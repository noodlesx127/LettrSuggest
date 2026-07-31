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

    const uid = await page.evaluate(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          continue;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          continue;
        }
        const value = parsed as {
          user?: { id?: unknown };
          currentSession?: { user?: { id?: unknown } };
          session?: { user?: { id?: unknown } };
        };
        const candidate =
          value.user?.id ??
          value.currentSession?.user?.id ??
          value.session?.user?.id;
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate;
        }
      }
      throw new Error("Authenticated Supabase user ID was not found");
    });

    await page.evaluate((userId) => {
      window.sessionStorage.setItem(
        `lettrsuggest:${userId}:items`,
        JSON.stringify([
          { id: 999999937, title: "Smoke fixture", reasons: [], score: 10 },
        ]),
      );
      window.sessionStorage.setItem(
        "lettrsuggest_items",
        JSON.stringify([
          { id: 999999938, title: "Legacy sentinel", reasons: [], score: 10 },
        ]),
      );
    }, uid);

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
    await expect
      .poll(() =>
        page.evaluate((userId) => {
          return {
            path: window.location.pathname,
            stored:
              window.sessionStorage.getItem(
                `lettrsuggest:${userId}:items`,
              ) !== null,
            rendered: document.body.innerText.includes("Smoke fixture"),
          };
        }, uid),
      )
      .toEqual({ path: "/suggest", stored: true, rendered: true });
    await expect(page.getByText("Smoke fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Legacy sentinel", { exact: true })).toHaveCount(
      0,
    );
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
