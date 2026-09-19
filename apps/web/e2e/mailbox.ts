import { expect, type APIRequestContext } from "@playwright/test";

// Mailpit (compose.yaml) catches every email the app sends and exposes them
// over HTTP, so a spec can read the message a flow produced and follow its link.
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://localhost:18025";

type Summary = { ID: string; Subject: string };

async function search(request: APIRequestContext, to: string, subject: RegExp) {
  const response = await request.get(`${MAILPIT}/api/v1/search`, {
    params: { query: `to:"${to}"` },
  });
  expect(response.ok(), `Mailpit is not reachable at ${MAILPIT}. Run \`make db-up\`.`).toBe(true);
  const { messages } = (await response.json()) as { messages: Summary[] };
  return messages.filter((message) => subject.test(message.Subject));
}

/** Waits for the newest email to `to` whose subject matches, and returns its first link. */
export async function linkFromEmail(request: APIRequestContext, to: string, subject: RegExp) {
  let found: Summary | undefined;
  await expect
    .poll(async () => (found = (await search(request, to, subject))[0]), {
      message: `an email to ${to} matching ${subject}`,
      timeout: 15_000,
    })
    .toBeTruthy();

  const response = await request.get(`${MAILPIT}/api/v1/message/${found!.ID}`);
  const { Text } = (await response.json()) as { Text: string };
  const link = Text.match(/https?:\/\/\S+/)?.[0];
  expect(link, "the email's text part has a link").toBeTruthy();
  return link!;
}

/** How many emails to `to` match the subject right now. */
export async function countEmails(request: APIRequestContext, to: string, subject: RegExp) {
  return (await search(request, to, subject)).length;
}
