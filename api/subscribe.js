// Newsletter signup endpoint for gedarealestate.ca.
// POST /api/subscribe  { email, firstName? }
// Adds the subscriber to the "Geda Real Estate News" Resend audience.
// Secrets come from Vercel project env vars (never in this file):
//   RESEND_API_KEY     - Resend API key with full access
//   RESEND_AUDIENCE_ID - Resend audience id for "Geda Real Estate News"

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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
  if (r.ok) return res.status(200).json({ ok: true });
  // Already on the list: treat as subscribed so the visitor sees a thank-you.
  if (r.status === 409 || r.status === 422) {
    return res.status(200).json({ ok: true, already: true });
  }
  return res
    .status(502)
    .json({ error: data.message || "Could not subscribe. Please try again." });
};
