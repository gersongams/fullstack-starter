// Transactional emails. Plain functions so they can be unit tested; every
// message has a text part (deliverability, accessibility) and a simple HTML part.

export type EmailContent = { subject: string; text: string; html: string };

const APP_NAME = "Fullstack Starter";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout({
  heading,
  intro,
  action,
  url,
  outro,
}: {
  heading: string;
  intro: string;
  action: string;
  url: string;
  outro: string;
}) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f4ee;font-family:Helvetica,Arial,sans-serif;color:#1c1b18;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border:1px solid #ddd8cb;border-radius:6px;padding:32px;text-align:left;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-size:14px;font-weight:bold;">${APP_NAME}</p>
                <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(heading)}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${escapeHtml(intro)}</p>
                <p style="margin:0 0 24px;">
                  <a href="${safeUrl}" style="display:inline-block;background:#1f5c45;color:#ffffff;text-decoration:none;font-size:15px;padding:10px 18px;border-radius:4px;">${escapeHtml(action)}</a>
                </p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#5f5b52;">If the button does not work, paste this link into your browser:</p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" style="color:#1f5c45;">${safeUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#5f5b52;">${escapeHtml(outro)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function greeting(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? `Hi ${trimmed},` : "Hi,";
}

export function verificationEmail({
  name,
  url,
}: {
  name?: string | null;
  url: string;
}): EmailContent {
  const intro = `${greeting(name)} confirm this email address to finish setting up your ${APP_NAME} account.`;
  const outro =
    "The link expires in one hour. If you did not create an account, ignore this email.";
  return {
    subject: `Confirm your email for ${APP_NAME}`,
    text: `${intro}\n\n${url}\n\n${outro}\n`,
    html: layout({ heading: "Confirm your email", intro, action: "Confirm email", url, outro }),
  };
}

export function resetPasswordEmail({
  name,
  url,
}: {
  name?: string | null;
  url: string;
}): EmailContent {
  const intro = `${greeting(name)} someone asked to reset the password of your ${APP_NAME} account.`;
  const outro =
    "The link expires in one hour and works once. If it was not you, ignore this email: your password stays the same.";
  return {
    subject: `Reset your ${APP_NAME} password`,
    text: `${intro}\n\n${url}\n\n${outro}\n`,
    html: layout({
      heading: "Reset your password",
      intro,
      action: "Choose a new password",
      url,
      outro,
    }),
  };
}
