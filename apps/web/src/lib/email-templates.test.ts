import { describe, expect, it } from "vitest";

import { resetPasswordEmail, verificationEmail } from "./email-templates";

const url =
  "http://localhost:3100/api/auth/verify-email?token=abc.def&callbackURL=%2Femail-verified";

describe.each([
  ["verificationEmail", verificationEmail, /confirm/i],
  ["resetPasswordEmail", resetPasswordEmail, /reset/i],
] as const)("%s", (_name, template, subject) => {
  it("puts the link, unchanged, in the text part", () => {
    const email = template({ name: "Ada", url });
    expect(email.subject).toMatch(subject);
    expect(email.text).toContain(url);
    expect(email.text).toContain("Hi Ada,");
  });

  it("escapes the link in the HTML part, as the button and as visible text", () => {
    const email = template({ name: "Ada", url });
    const escaped = url.replaceAll("&", "&amp;");
    expect(email.html).toContain(`href="${escaped}"`);
    expect(email.html.split(escaped).length - 1).toBe(3);
    expect(email.html).not.toContain("token=abc.def&callbackURL");
  });

  it("escapes the user's name, which the user chose", () => {
    const email = template({ name: '<img src=x onerror="alert(1)">', url });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("greets without a name when there is none", () => {
    expect(template({ name: "  ", url }).text).toMatch(/^Hi, /);
    expect(template({ url }).text).toMatch(/^Hi, /);
  });

  it("says when the link expires and that it is safe to ignore", () => {
    const email = template({ name: "Ada", url });
    expect(email.text).toMatch(/expires in one hour/);
    expect(email.text).toMatch(/ignore this email/);
  });
});
