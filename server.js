require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const slackRoutes = require('./routes/slackRoutes');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use('/', slackRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚙️ Server running on port ${PORT}`));