// Contact form companion endpoint for gedarealestate.ca.
// POST /api/contact  { name, email, interest, message }
// Records the message in the Airtable Contact Us table and emails a
// notification with the full message to gedarealestate@gmail.com.
// This does NOT replace FormSubmit, which still delivers the message to
// GedaRealEstate@RoyalLePage.ca. The website calls this endpoint in
// parallel and treats its result as best-effort.
// Secrets come from Vercel project env vars (never in this file):
//   RESEND_API_KEY   - Resend API key with full access
//   AIRTABLE_TOKEN   - Airtable personal access token (data.records write)
//   AIRTABLE_BASE_ID - Airtable base id for "GEDA REAL ESTATE"

const NOTIFY_TO = "gedarealestate@gmail.com";
// Resend only sends from a verified domain. Until gedarealestate.ca is
// verified in Resend, notifications come from its test address.
const NOTIFY_FROM = "Geda Real Estate <onboarding@resend.dev>";
const AIRTABLE_TABLE_ID = "tblLkZxfPtpfgZXsF"; // Contact Us table

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const interest = typeof body.interest === "string" ? body.interest.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!name || !isEmail(email)) {
    return res.status(400).json({ error: "A name and a valid email address are required." });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Best-effort Airtable record.
  const airtableToken = process.env.AIRTABLE_TOKEN;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;
  if (airtableToken && airtableBaseId) {
    try {
      await fetch(
        `https://api.airtable.com/v0/${airtableBaseId}/${AIRTABLE_TABLE_ID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${airtableToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              Name: name,
              Email: email,
              Interest: interest || "Just have a question",
              Message: message,
              Date: today,
            },
          }),
        }
      );
    } catch (e) {
      console.error("Airtable contact record failed:", e && e.message);
    }
  }

  // Best-effort owner notification with the full message.
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: NOTIFY_FROM,
          to: NOTIFY_TO,
          subject: `New contact message from ${name}${interest ? ` (${interest})` : ""}`,
          text:
            `Name: ${name}\nEmail: ${email}\n` +
            `Interest: ${interest || "Just have a question"}\n\n${message}`,
        }),
      });
    } catch (e) {
      console.error("Contact notification failed:", e && e.message);
    }
  }

  // Best-effort SMS alert via Twilio. Runs only when the Twilio env vars
  // are set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
  // NOTIFY_PHONE).
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;
  const notifyPhone = process.env.NOTIFY_PHONE;
  if (twilioSid && twilioToken && twilioFrom && notifyPhone) {
    try {
      const params = new URLSearchParams({
        From: twilioFrom,
        To: notifyPhone,
        Body: `New contact message from ${name}${interest ? ` (${interest})` : ""}: ${message.slice(0, 120)}`,
      });
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );
    } catch (e) {
      console.error("Contact SMS failed:", e && e.message);
    }
  }

  return res.status(200).json({ ok: true });
};
