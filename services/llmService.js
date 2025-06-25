const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractComplianceRules(rawText) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'You are a legal compliance assistant. Extract and list clear, actionable compliance rules from the following policy document.'
      },
      {
        role: 'user',
        content: rawText.slice(0, 8000)
      }
    ]
  });

  return completion.choices[0].message.content;
}

module.exports = { extractComplianceRules };