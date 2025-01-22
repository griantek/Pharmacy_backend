// Backend and Bot Server for Pharmacy Booking System

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mysql = require('mysql2');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Database Connection (using MySQL for scalability on GCP)
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'pharmacy_booking'
});

db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL database.');
});

// WhatsApp Meta API Configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';
const WHATSAPP_ACCESS_TOKEN = 'your-meta-api-access-token';
const PHONE_NUMBER_ID = 'your-phone-number-id';

// WhatsApp Message Sender
const sendMessage = async (phoneNumber, message) => {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Message sent to ${phoneNumber}`);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
};

// Endpoint to Handle Incoming Webhooks
app.post('/webhook', (req, res) => {
  const { entry } = req.body;

  if (entry && entry[0].changes && entry[0].changes[0].value.messages) {
    const messages = entry[0].changes[0].value.messages;
    messages.forEach(async message => {
      const from = message.from;
      const msgBody = message.text?.body.toLowerCase();

      if (msgBody === 'hi') {
        await sendMessage(from, 'Welcome to Pharmacy Bot! Select an option:\n1. Order Medicine\n2. Contact Support');
      } else if (msgBody === '1') {
        await sendMessage(from, 'Visit our web application to order medicines: https://pharmacy-booking.com');
      } else if (msgBody === '2') {
        await sendMessage(from, 'Contact our support team at support@pharmacy-booking.com or call +1234567890.');
      } else {
        await sendMessage(from, 'Sorry, I did not understand that. Please reply with "Hi" to start over.');
      }
    });
  }

  res.sendStatus(200);
});

// Endpoint to Test Database Connection
app.get('/test-db', (req, res) => {
  db.query('SELECT 1 + 1 AS solution', (err, results) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).send('Database connection failed');
    } else {
      res.send(`Database connection successful: ${results[0].solution}`);
    }
  });
});

// Starting the Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
