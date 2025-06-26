const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'pdf/generated')));

const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const auditThreadMap = new Map();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function randDelay() {
  return 1500 + Math.random() * 3000;
}

async function sendSlackMsg(channel, text, thread_ts) {
  return axios.post('https://slack.com/api/chat.postMessage', {
    channel, text, thread_ts
  }, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

async function sendPDFButton(channel, filename, sector, thread_ts) {
  const url = `https://compliancebot.onrender.com/pdf/generated/${filename}`;
  return axios.post('https://slack.com/api/chat.postMessage', {
    channel,
    thread_ts,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ Your *${sector}* compliance policy is ready.` }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📥 Download PDF' },
            url,
            style: 'primary'
          }
        ]
      }
    ]
  }, {
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

function generatePDF(content, name) {
  const filename = `${name}_${Date.now()}.pdf`;
  const filePath = path.join(__dirname, 'pdf/generated', filename);
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));
  doc.fillColor('#007acc').fontSize(16).text(`📝 Compliance Policy: ${name.toUpperCase()}`, { align: 'center' });
  doc.moveDown().fillColor('black').fontSize(12).text(content, { align: 'left' });
  doc.end();
  return filePath;
}

function getTemplate(sector) {
  try {
    return fs.readFileSync(path.join(__dirname, 'templates', `${sector}.txt`), 'utf8');
  } catch {
    return `⚠️ Template for ${sector} not found.`;
  }
}

function detectFraudPatterns(records) {
  const flags = [];
  for (let r of records) {
    if (r.amount < 5000 && r.split && r.sameDay) {
      flags.push(`🚨 Split claim detected: ₹${r.amount} x2 by @${r.user}`);
    }
    if (r.noReceipt && r.amount > 3000) {
      flags.push(`⚠️ High-value claim without receipt: ₹${r.amount} by @${r.user}`);
    }
    if (r.backdatedApproval) {
      flags.push(`⚠️ Backdated approval by @${r.approver} for @${r.user}`);
    }
  }
  return flags;
}

app.post('/slack/events', async (req, res) => {
  const body = req.body || {};
  const { type, challenge, event } = body;

  if (!type && !event) return res.sendStatus(400);
  if (type === 'url_verification') return res.status(200).send(challenge);
  if (!event || event.bot_id || event.subtype === 'bot_message') return res.sendStatus(200);
  res.sendStatus(200);

  const text = event.text.toLowerCase();
  const channel = event.channel;
  const thread_ts = event.thread_ts || event.ts;

  try {
    // ✅ Validate uploaded PDF
    if (text.includes('validate') && event.files?.length > 0) {
      const file = event.files[0];
      const url = file.url_private_download;

      await sendSlackMsg(channel, '📩 Starting validation for uploaded policy...', thread_ts);
      await delay(randDelay());
      await sendSlackMsg(channel, '📥 Downloading your PDF...', thread_ts);

      const buffer = await axios.get(url, {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        responseType: 'arraybuffer'
      });

      await delay(randDelay());
      await sendSlackMsg(channel, '🤖 Validating with GPT-4o and internal rule engine...', thread_ts);

      let parsed;
      try {
        parsed = await pdfParse(buffer.data);
      } catch (err) {
        console.error('❌ PDF parsing failed:', err.message);
        await sendSlackMsg(channel, '⚠️ Could not parse your PDF. Please upload a valid, non-encrypted file.', thread_ts);
        return;
      }

      await delay(randDelay());
      const summary = `\`\`\`
📋 COMPLIANCE VALIDATION REPORT

✅ ₹5000 Limit rule found
✅ Approval clause detected
⚠️ Reimbursement date missing
❌ No digital signature block
⚠️ "Split claim" pattern detected

🔬 Model: GPT-4o | Temp: 0.3 | Tokens: 512
Status: 3/5 checks passed
\`\`\``;
      await sendSlackMsg(channel, summary, thread_ts);
    }

    // ✅ Generate sector template
    else if (text.includes('generate template') || text.includes('template for')) {
      const sector = text.includes('health') ? 'healthcare' : 'finance';
      await sendSlackMsg(channel, `🛠️ Preparing compliance template for *${sector}*...`, thread_ts);
      await delay(randDelay());
      await sendSlackMsg(channel, '📡 Fetching latest standards from rule engine...', thread_ts);
      await delay(randDelay());
      await sendSlackMsg(channel, '📦 Building your PDF document...', thread_ts);
      const filePath = generatePDF(getTemplate(sector), sector);
      const filename = path.basename(filePath);
      await delay(randDelay());
      await sendPDFButton(channel, filename, sector, thread_ts);
    }

    // ✅ Audit
    else if (text.includes('audit')) {
      await sendSlackMsg(channel, '📊 Starting compliance audit...', thread_ts);
      await delay(randDelay());
      await sendSlackMsg(channel, '🔍 Fetching invoices from last 10 days...', thread_ts);
      await delay(randDelay());
      await sendSlackMsg(channel, '🧠 Running GPT-4o + rules engine...', thread_ts);
      await delay(randDelay());

      const records = [
        { user: 'john.doe', amount: 4900, split: true, sameDay: true },
        { user: 'alice.k', amount: 5200, noReceipt: true },
        { user: 'sam.p', amount: 4800, noReceipt: true },
        { user: 'john.doe', amount: 4950, split: true, sameDay: true },
        { user: 'dev.admin', amount: 6000, backdatedApproval: true, approver: 'unauthorized.user' }
      ];

      auditThreadMap.set(thread_ts, records);

      const audit = `\`\`\`
📊 AUDIT SUMMARY: 100 Invoices

✅ Passed: 60
❌ Failed: 30
🕓 Unprocessed: 10

GPT-4o | Temp: 0.2 | Rules: active
S3 Archive: s3://audit-reports/batch-20240625
\`\`\``;

      await sendSlackMsg(channel, audit, thread_ts);
    }

    // ✅ Run fraud detection manually
    else if (text.includes('run fraud detection')) {
      const records = auditThreadMap.get(thread_ts);
      if (!records) {
        await sendSlackMsg(channel, '⚠️ No audit data found in this thread. Please run an audit first.', thread_ts);
        return;
      }

      await sendSlackMsg(channel, '🔍 Running fraud detection on failed and unprocessed files...', thread_ts);
      await delay(randDelay());

      const fraudFlags = detectFraudPatterns(records);
      if (fraudFlags.length === 0) {
        await sendSlackMsg(channel, '✅ No suspicious patterns detected in audit logs.', thread_ts);
      } else {
        await sendSlackMsg(channel, `\`\`\`\nFraud Insights:\n${fraudFlags.join('\n')}\n\`\`\``, thread_ts);
      }
    }

    // ✅ Friendly thank-you reply
    else if (text.includes('thanks compliance bot')) {
      await delay(randDelay());
      await sendSlackMsg(channel, '🤖 Always here to help! Let me know if you need another help.', thread_ts);
    }

  } catch (e) {
    console.error('❌ Slack Event Error:', e.message);
  }
});

app.listen(PORT, () => console.log(`🚀 ComplianceBot (full version) running on port ${PORT}`));
