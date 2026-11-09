// Newsletter signup endpoint for gedarealestate.ca.
// POST /api/subscribe  { email, firstName? }
// Adds the subscriber to the "Geda Real Estate News" Resend audience,
// records them in the Airtable Newsletter table, and emails a
// notification to gedarealestate@gmail.com.
// Secrets come from Vercel project env vars (never in this file):
//   RESEND_API_KEY     - Resend API key with full access
//   RESEND_AUDIENCE_ID - Resend audience id for "Geda Real Estate News"
//   AIRTABLE_TOKEN     - Airtable personal access token (data.records write)
//   AIRTABLE_BASE_ID   - Airtable base id for "GEDA REAL ESTATE"
// The Airtable write and the notification email are best-effort: the
// signup still succeeds if either fails, so a visitor is never blocked.

const NOTIFY_TO = "gedarealestate@gmail.com";
// Resend only sends from a verified domain. Until gedarealestate.ca is
// verified in Resend, notifications come from its test address.
const NOTIFY_FROM = "Geda Real Estate <onboarding@resend.dev>";
const AIRTABLE_TABLE_ID = "tblr8UJK4tQ4s7OLu"; // Newsletter table

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function airtableFindByEmail(token, baseId, email) {
  const formula = `{Email}="${email.replace(/"/g, '\\"')}"`;
  const url =
    `https://api.airtable.com/v0/${baseId}/${AIRTABLE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return (data.records && data.records[0]) || null;
}

async function airtableRecordSubscriber(token, baseId, email, firstName) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await airtableFindByEmail(token, baseId, email);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (existing) {
    // Already on file: clear any earlier unsubscribe so a re-subscribe counts.
    if (existing.fields && existing.fields.Unsubscribed) {
      await fetch(
        `https://api.airtable.com/v0/${baseId}/${AIRTABLE_TABLE_ID}/${existing.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ fields: { Unsubscribed: false } }),
        }
      );
    }
    return;
  }
  await fetch(`https://api.airtable.com/v0/${baseId}/${AIRTABLE_TABLE_ID}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fields: {
        Email: email,
        "First name": firstName || "",
        Subscribed: today,
        Source: "Website",
        Unsubscribed: false,
      },
    }),
  });
}

async function sendNotification(apiKey, subject, text) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: NOTIFY_FROM, to: NOTIFY_TO, subject, text }),
  });
}

// Best-effort SMS alert via Twilio. Runs only when the Twilio env vars
// are set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
// NOTIFY_PHONE).
async function sendSms(text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.NOTIFY_PHONE;
  if (!sid || !token || !from || !to) return;
  const params = new URLSearchParams({ From: from, To: to, Body: text });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  if (!isEmail(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return res.status(500).json({ error: "Newsletter signup is not set up yet." });
  }

  const contact = { email, unsubscribed: false };
  if (firstName) contact.first_name = firstName;

  let r;
  try {
    r = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contact),
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the signup service. Please try again." });
  }

  const data = await r.json().catch(() => ({}));
  const already = r.status === 409 || r.status === 422;
  if (!r.ok && !already) {
    return res
      .status(502)
      .json({ error: data.message || "Could not subscribe. Please try again." });
  }

  // Best-effort extras: Airtable record and owner notification.
  const airtableToken = process.env.AIRTABLE_TOKEN;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;
  if (airtableToken && airtableBaseId) {
    try {
      await airtableRecordSubscriber(airtableToken, airtableBaseId, email, firstName);
    } catch (e) {
      console.error("Airtable newsletter record failed:", e && e.message);
    }
  }
  try {
    await sendNotification(
      apiKey,
      `New newsletter subscriber: ${email}`,
      `${firstName ? firstName + " " : ""}${email} just subscribed to Geda Real Estate News from gedarealestate.ca.`
    );
  } catch (e) {
    console.error("Subscriber notification failed:", e && e.message);
  }
  try {
    await sendSms(
      `New subscriber: ${firstName ? firstName + " " : ""}${email} joined Geda Real Estate News.`
    );
  } catch (e) {
    console.error("Subscriber SMS failed:", e && e.message);
  }

  return res.status(200).json({ ok: true, already: already || undefined });
};
