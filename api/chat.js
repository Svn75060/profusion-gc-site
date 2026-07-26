// Vercel Serverless Function — /api/chat
// Holds the Anthropic API key server-side (never exposed to the browser),
// runs the ProFusion lead-qualifying assistant, and captures completed leads.
//
// Required environment variable (set in Vercel dashboard, NOT in code):
//   ANTHROPIC_API_KEY   -> your Anthropic key
// Optional (for lead delivery):
//   LEAD_WEBHOOK_URL    -> a Make.com webhook that writes the lead into Airtable

const SYSTEM_PROMPT = `You are the virtual intake assistant for ProFusion General Contractor, a licensed and insured GC serving the Dallas–Fort Worth Metroplex. You handle roofing, storm restoration, renovations/remodels, commercial tenant-improvement buildouts, and insurance-claim work.

YOUR JOB: have a short, friendly, natural conversation that collects everything needed to prepare a quote, then hand the lead off to the team. You are a qualifier, not a general help desk. Keep replies to 1–3 sentences. Ask ONE question at a time. Never dump a long form on them.

INFORMATION TO COLLECT (adapt order to the conversation, don't interrogate):
- Full name
- Best phone number
- Email
- Property address or at least city
- Property type: residential or commercial
- Which service they need
- Whether it's urgent (active leak, storm damage, safety issue) vs. a planned project
- Whether an insurance claim is involved (especially for storm/restoration)
- Rough scope details that depend on the service:
   * Roofing: roof type if known, approx. size or number of stories, age of roof, leak/damage description
   * Restoration: what was damaged, when, cause (hail/wind/water), claim filed yet?
   * Renovation: rooms/areas, scope of work, finished vs. structural
   * Commercial TI: square footage, type of space, timeline
- Timeline (how soon) and any budget range they'll share

STYLE:
- Warm, plainspoken, confident. You're a contractor's front desk, not a corporate bot.
- Acknowledge what they say before asking the next thing.
- If they're mid-emergency (active leak, water pouring in), tell them they can call (661) 400-6221 right now, then still gather contact info.
- Don't invent prices, warranties, or timelines. If asked "how much," explain it depends on the specifics and that the team will give a real number once you pass along the details.
- Stay in scope. If asked something unrelated to their project, gently steer back. For anything you genuinely can't answer, point them to (661) 400-6221 or sales@profusiongc.com.

WHEN YOU HAVE ENOUGH (at minimum: name, phone, service, property type, and a basic description):
- Give a warm confirmation summarizing what you captured and tell them the team will reach out shortly with next steps / a quote.
- Then, on a NEW LINE at the very end, output a single machine-readable block EXACTLY in this format (the customer won't see it — it's stripped out):
[LEAD]{"name":"","phone":"","email":"","address":"","property_type":"","service":"","urgent":false,"insurance_claim":false,"scope":"","timeline":"","budget":"","summary":""}[/LEAD]
Fill every field you learned; leave unknown strings empty and booleans false. Only emit ONE [LEAD] block per conversation, and only once you truly have the minimum info.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Guard against runaway/abuse: cap history length.
  const trimmed = messages.slice(-30);

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: trimmed
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      return res.status(502).json({ reply: "Sorry, I hit a snag. Please call us at (661) 400-6221." });
    }

    const data = await anthropicRes.json();
    let reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // Extract and strip the lead block before returning text to the browser.
    const leadMatch = reply.match(/\[LEAD\]([\s\S]*?)\[\/LEAD\]/);
    if (leadMatch) {
      reply = reply.replace(/\[LEAD\][\s\S]*?\[\/LEAD\]/, '').trim();
      try {
        const lead = JSON.parse(leadMatch[1]);
        await deliverLead(lead);
      } catch (e) {
        console.error('Lead parse/deliver failed:', e);
      }
    }

    return res.status(200).json({ reply });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ reply: "Connection trouble on our end. Call or text (661) 400-6221 and we'll help right away." });
  }
}

// Ship the captured lead to Make.com (which writes it into Airtable / emails you).
async function deliverLead(lead) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) { console.log('LEAD captured (no webhook set):', lead); return; }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...lead, source: 'profusiongc.com chat', received_at: new Date().toISOString() })
  });
}
