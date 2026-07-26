// Vercel Serverless Function — /api/chat
// Holds the Anthropic API key server-side (never exposed to the browser),
// runs the ProFusion lead-qualifying assistant, and captures completed leads.
//
// Required environment variable (set in Vercel dashboard, NOT in code):
//   ANTHROPIC_API_KEY   -> your Anthropic key
// Optional (for lead delivery):
//   AIRTABLE_TOKEN      -> an Airtable personal access token that can write
//                          to the ProFusion CRM v2 base (Contacts table)

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

// Ship the captured lead directly into the ProFusion CRM v2 Airtable base
// (Contacts table). Requires env var AIRTABLE_TOKEN (a personal access token
// with data.records:write scope on the base).
async function deliverLead(lead) {
  const token = process.env.AIRTABLE_TOKEN;
  const BASE_ID = 'appZN4sC1Uv2G69Vf';
  const TABLE_ID = 'tblw0FF6NGEMujdAl'; // Contacts

  if (!token) { console.log('LEAD captured (no AIRTABLE_TOKEN set):', lead); return; }

  // Map the bot's free-form service to one of the CRM's dropdown values.
  const svc = (lead.service || '').toLowerCase();
  let serviceType = 'General Contracting';
  if (svc.includes('roof') || svc.includes('storm') || svc.includes('restoration')) {
    serviceType = 'Roofing';
  } else if (svc.includes('solar')) {
    serviceType = 'Solar';
  } // renovation, remodel, TI, buildout, and anything else -> General Contracting

  // Fold the rich detail into the Notes field so nothing is lost.
  const noteLines = [];
  if (lead.summary)         noteLines.push(lead.summary);
  if (lead.service)         noteLines.push(`Service requested: ${lead.service}`);
  if (lead.property_type)   noteLines.push(`Property type: ${lead.property_type}`);
  if (lead.urgent)          noteLines.push(`⚠️ URGENT`);
  if (lead.insurance_claim) noteLines.push(`Insurance claim involved: yes`);
  if (lead.scope)           noteLines.push(`Scope: ${lead.scope}`);
  if (lead.timeline)        noteLines.push(`Timeline: ${lead.timeline}`);
  if (lead.budget)          noteLines.push(`Budget: ${lead.budget}`);
  noteLines.push(`— Captured via profusiongc.com chat, ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`);

  const fields = {
    'fld6jEjJlKcksLUDJ': lead.name || 'Website Lead',   // Full Name
    'flddysmYSBQdKlmi0': lead.phone || '',              // Phone Number
    'fldlyA81NO9aD5sLo': lead.email || '',              // Email
    'fldI2U3d3zR5mqZqu': lead.address || '',            // Property Address
    'fldsccSqiVNtD0W7k': serviceType,                   // Primary Service Type
    'fldcvLMNNDqCdXjsx': 'Todo',                        // Contact Status
    'fldYqAVfvlEZJe7xl': noteLines.join('\n')           // Notes
  };
  // Drop empty strings so we don't overwrite with blanks.
  Object.keys(fields).forEach(k => { if (fields[k] === '') delete fields[k]; });

  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error('Airtable write failed:', resp.status, t);
  } else {
    console.log('Lead written to Airtable Contacts:', lead.name);
  }
}
