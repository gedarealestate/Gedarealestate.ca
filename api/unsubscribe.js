// Newsletter unsubscribe endpoint for gedarealestate.ca.
// POST /api/unsubscribe  { email }
// Marks the subscriber unsubscribed in the "Geda Real Estate News"
// Resend audience, flags them Unsubscribed in the Airtable Newsletter
// table, and emails a notification to gedarealestate@gmail.com.
// Secrets come from Vercel project env vars (never in this file):
//   RESEND_API_KEY     - Resend API key with full access
//   RESEND_AUDIENCE_ID - Resend audience id for "Geda Real Estate News"
//   AIRTABLE_TOKEN     - Airtable personal access token (data.records write)
//   AIRTABLE_BASE_ID   - Airtable base id for "GEDA REAL ESTATE"
// The Airtable update and the notification email are best-effort: the
// unsubscribe still succeeds if either fails.

const NOTIFY_TO = "gedarealestate@gmail.com";
// Resend only sends from a verified domain. Until gedarealestate.ca is
// verified in Resend, notifications come from its test address.
const NOTIFY_FROM = "Geda Real Estate <onboarding@resend.dev>";
const AIRTABLE_TABLE_ID = "tblr8UJK4tQ4s7OLu"; // Newsletter table

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function airtableFlagUnsubscribed(token, baseId, email) {
  const formula = `{Email}="${email.replace(/"/g, '\\"')}"`;
  const url =
    `https://api.airtable.com/v0/${baseId}/${AIRTABLE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return;
  const data = await r.json().catch(() => ({}));
  const record = data.records && data.records[0];
  if (!record) return;
  await fetch(
    `https://api.airtable.com/v0/${baseId}/${AIRTABLE_TABLE_ID}/${record.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { Unsubscribed: true } }),
    }
  );
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
  if (!isEmail(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return res.status(500).json({ error: "Newsletter unsubscribe is not set up yet." });
  }

  // Mark unsubscribed in Resend. A 404 means they were not on the list.
  try {
    const r = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts/${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ unsubscribed: true }),
      }
    );
    if (!r.ok && r.status !== 404) {
      const data = await r.json().catch(() => ({}));
      return res
        .status(502)
        .json({ error: data.message || "Could not unsubscribe. Please try again." });
    }
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the service. Please try again." });
  }

  // Best-effort extras: Airtable flag and owner notification.
  const airtableToken = process.env.AIRTABLE_TOKEN;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;
  if (airtableToken && airtableBaseId) {
    try {
      await airtableFlagUnsubscribed(airtableToken, airtableBaseId, email);
    } catch (e) {
      console.error("Airtable unsubscribe flag failed:", e && e.message);
    }
  }
  try {
    await sendNotification(
      apiKey,
      `Newsletter unsubscribe: ${email}`,
      `${email} unsubscribed from Geda Real Estate News on gedarealestate.ca.`
    );
  } catch (e) {
    console.error("Unsubscribe notification failed:", e && e.message);
  }
  try {
    await sendSms(`Unsubscribe: ${email} left Geda Real Estate News.`);
  } catch (e) {
    console.error("Unsubscribe SMS failed:", e && e.message);
  }

  return res.status(200).json({ ok: true });
};
