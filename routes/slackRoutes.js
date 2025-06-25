const express = require('express');
const router = express.Router();
const slackClient = require('../utils/slackClient');
const fileService = require('../services/fileService');
const llmService = require('../services/llmService');

router.post('/upload', async (req, res) => {
  const userId = req.body.user_id;

  await slackClient.chat.postMessage({
    channel: userId,
    text: "📎 Please upload your compliance policy PDF in this thread."
  });

  res.status(200).send();
});

router.post('/file-process', async (req, res) => {
  try {
    const { file_id, user_id } = req.body;

    const rawText = await fileService.downloadAndExtract(file_id);
    const rules = await llmService.extractComplianceRules(rawText);

    await slackClient.chat.postMessage({
      channel: user_id,
      text: `✅ Extracted Rules:\n${rules}`
    });

    res.status(200).send();
  } catch (error) {
    console.error(error);
    res.status(500).send('Error processing document');
  }
});

module.exports = router;