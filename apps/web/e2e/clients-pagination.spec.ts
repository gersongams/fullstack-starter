import { createClients, expect, test, signUp } from "./helpers";

const PAGE_SIZE = 20;
const TOTAL = 25;

test("Load more walks the cursor to the last page, newest first and without repeats", async ({
  page,
}) => {
  await signUp(page);

  // "Paged Client 01" is the oldest, "Paged Client 25" the newest.
  const names = Array.from(
    { length: TOTAL },
    (_, index) => `Paged Client ${String(index + 1).padStart(2, "0")}`,
  );
  await createClients(page, names);
  const newestFirst = names.toReversed();

  await page.goto("/clients");
  const rows = page.getByRole("row", { name: /Paged Client \d\d/ });
  const shownNames = async () =>
    (await rows.getByText(/^Paged Client \d\d$/).allTextContents()).map((name) => name.trim());

  // First page: the 20 newest, and a way to get the rest.
  await expect(rows).toHaveCount(PAGE_SIZE);
  expect(await shownNames()).toEqual(newestFirst.slice(0, PAGE_SIZE));
  const loadMore = page.getByRole("button", { name: "Load more" });
  await expect(loadMore).toBeVisible();

  // Second page: the remaining 5 are appended, nothing is repeated or skipped.
  await loadMore.click();
  await expect(rows).toHaveCount(TOTAL);
  const all = await shownNames();
  expect(all).toEqual(newestFirst);
  expect(new Set(all).size).toBe(TOTAL);

  // Last page: next_cursor is null, so the control goes away.
  await expect(loadMore).toBeHidden();
});
