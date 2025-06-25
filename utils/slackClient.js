const { WebClient } = require('@slack/web-api');
module.exports = new WebClient(process.env.SLACK_BOT_TOKEN);