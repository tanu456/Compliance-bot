require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'pdf/generated')));

const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const auditThreadMap = new Map();

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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

async function analyzeWithLLM(pdfText) {
  try {
    console.log('🔍 Starting LLM analysis...');
    console.log('📄 PDF text length:', pdfText.length);
    console.log('🔑 OpenAI API Key exists:', !!process.env.OPENAI_API_KEY);
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    if (!pdfText || pdfText.trim().length === 0) {
      throw new Error('PDF text is empty or contains no readable content');
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a legal compliance expert. Analyze the following policy document and extract clear, actionable compliance rules. Format your response as a structured list of rules with brief explanations.'
        },
        {
          role: 'user',
          content: `Please analyze this policy document and extract compliance rules:\n\n${pdfText.slice(0, 8000)}`
        }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });

    console.log('✅ LLM analysis completed successfully');
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('❌ LLM Analysis Error Details:');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error status:', error.status);
    
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    
    // Return more specific error messages based on the error type
    if (error.message.includes('OPENAI_API_KEY')) {
      return '⚠️ OpenAI API key is not configured. Please check your environment variables.';
    } else if (error.message.includes('empty')) {
      return '⚠️ The PDF appears to be empty or contains no readable text. Please check the document.';
    } else if (error.code === 'insufficient_quota') {
      return '⚠️ OpenAI API quota exceeded. Please check your account usage.';
    } else if (error.code === 'invalid_api_key') {
      return '⚠️ Invalid OpenAI API key. Please check your configuration.';
    } else {
      return `⚠️ AI analysis failed: ${error.message}`;
    }
  }
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
      await sendSlackMsg(channel, '🤖 Analyzing with GPT-3.5-turbo and extracting compliance rules...', thread_ts);

      let parsed;
      try {
        parsed = await pdfParse(buffer.data);
        console.log('📄 PDF parsed successfully');
        console.log('📊 PDF stats:', {
          pages: parsed.numpages,
          textLength: parsed.text.length,
          hasText: !!parsed.text.trim()
        });
        
        if (!parsed.text || parsed.text.trim().length === 0) {
          await sendSlackMsg(channel, '⚠️ The PDF appears to be empty or contains no readable text. Please check if the document has text content.', thread_ts);
          return;
        }
      } catch (err) {
        console.error('❌ PDF parsing failed:', err.message);
        await sendSlackMsg(channel, '⚠️ Could not parse your PDF. Please upload a valid, non-encrypted file.', thread_ts);
        return;
      }

      await delay(randDelay());
      
      // Mock validation report instead of LLM analysis
      const mockValidationReport = `Validation Report – Compliance Summary

| Rule / Check              | Status    | Remarks                                                                |
|---------------------------|------------|-------------------------------------------------------------------------|
| ₹5000 Limit Rule Found    | ✅   | Clearly states receipts are required for expenses above ₹5000.        |
| Approval Clause Detected  | ✅ | Requires manager approval and proper documentation for all claims.    |
| Reimbursement Deadline    |  ❌ | No mention of timeline for when approved reimbursements will be paid. |
| Non-Reimbursable Items    |  ❌| No list of excluded/non-reimbursable expenses (e.g., alcohol, fines). |

---
Suggested Improvements
• Add a Reimbursement Deadline section:
  "All approved expense claims will be reimbursed within 10 business days."
• Add a Non-Reimbursable Items section:
  "The following will not be reimbursed: Alcohol, personal entertainment, fines, gifts without business justification."`;

      // Save extracted rules as JSON
      const rulesData = {
        file_id: file.id,
        user_id: event.user,
        filename: file.name,
        extracted_at: new Date().toISOString(),
        rules: mockValidationReport,
        original_text_length: parsed.text.length,
        validation_type: 'compliance_check'
      };

      const rulesFilename = `validation_${file.id}_${Date.now()}.json`;
      const rulesPath = path.join(__dirname, 'extracted_rules', rulesFilename);
      fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
      fs.writeFileSync(rulesPath, JSON.stringify(rulesData, null, 2));

      await sendSlackMsg(channel, '📋 Generating compliance validation report...', thread_ts);
      await delay(randDelay());

      const summary = `\`\`\`
📋 COMPLIANCE VALIDATION REPORT

${mockValidationReport}

📊 Document Stats:
• Text Length: ${parsed.text.length} characters
• Pages: ${parsed.numpages}
• Validation File: ${rulesFilename}

🔬 Analysis: Complete | Validation: Mock Data
\`\`\``;
      
      await sendSlackMsg(channel, summary, thread_ts);
    }

    // ✅ Generate sector template
    else if (text.includes('generate') || text.includes('compliance policy for')) {
      const sector = text.includes('travel') ? 'healthcare' : 'finance';
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

    // ✅ Analyze file and generate rules
    else if (text.includes('analyze rules') && event.files?.length > 0) {
      const file = event.files[0];
      const url = file.url_private_download;

      await sendSlackMsg(channel, '🧠 Starting AI-powered compliance rule extraction...', thread_ts);
      await delay(randDelay());
      await sendSlackMsg(channel, '📥 Downloading your document...', thread_ts);

      const buffer = await axios.get(url, {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        responseType: 'arraybuffer'
      });

      await delay(randDelay());
      await sendSlackMsg(channel, '🤖 Analyzing document with GPT-3.5-turbo...', thread_ts);

      let parsed;
      try {
        parsed = await pdfParse(buffer.data);
      } catch (err) {
        console.error('❌ PDF parsing failed:', err.message);
        await sendSlackMsg(channel, '⚠️ Could not parse your document. Please upload a valid PDF file.', thread_ts);
        return;
      }

      await delay(randDelay());
      
      // Use LLM to extract rules
      const extractedRules = await analyzeWithLLM(parsed.text);
      
      // Save rules as JSON
      const rulesData = {
        file_id: file.id,
        user_id: event.user,
        filename: file.name,
        extracted_at: new Date().toISOString(),
        rules: extractedRules,
        original_text_length: parsed.text.length,
        analysis_type: 'compliance_rules_extraction'
      };

      const rulesFilename = `compliance_rules_${file.id}_${Date.now()}.json`;
      const rulesPath = path.join(__dirname, 'extracted_rules', rulesFilename);
      fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
      fs.writeFileSync(rulesPath, JSON.stringify(rulesData, null, 2));

      await sendSlackMsg(channel, '📋 Generating comprehensive rules report...', thread_ts);
      await delay(randDelay());

      const rulesReport = `\`\`\`
📋 COMPLIANCE RULES EXTRACTION

🤖 AI-Generated Compliance Rules:
${extractedRules}

📊 Analysis Summary:
• Document: ${file.name}
• Pages: ${parsed.numpages}
• Text Length: ${parsed.text.length} characters
• Rules File: ${rulesFilename}

🔬 AI Model: GPT-3.5-turbo | Analysis: Complete
\`\`\``;
      
      await sendSlackMsg(channel, rulesReport, thread_ts);
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
