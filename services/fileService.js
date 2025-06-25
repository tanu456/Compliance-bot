const axios = require('axios');
const pdfParse = require('pdf-parse');
const slackClient = require('../utils/slackClient');

async function downloadAndExtract(fileId) {
  const { file } = await slackClient.files.info({ file: fileId });
  const response = await axios.get(file.url_private, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    responseType: 'arraybuffer'
  });

  const data = await pdfParse(response.data);
  return data.text;
}

module.exports = { downloadAndExtract };