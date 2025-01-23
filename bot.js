// Backend and Bot Server for Pharmacy Booking System

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mysql = require('mysql2');

const app = express();
const PORT = process.env.PORT || 5000;

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
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// WhatsApp Message Sender with Buttons
const sendMessageWithButtons = async (phoneNumber, headerText, bodyText, buttons) => {
  try {
    await axios.post(
      `${process.env.WHATSAPP_API_URL}`,
      {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: {
            type: 'text',
            text: headerText
          },
          body: {
            text: bodyText
          },
          action: {
            buttons: buttons
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Buttons sent to ${phoneNumber}`);
  } catch (error) {
    console.error('Error sending buttons:', error.response?.data || error.message);
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
        await sendMessageWithButtons(from, 'Welcome to Pharmacy Bot!', 'Select an option:', [
          { type: 'reply', reply: { id: 'order_medicine', title: 'Order Medicine' } },
          { type: 'reply', reply: { id: 'contact_support', title: 'Contact Support' } }
        ]);
      } else if (message.type === 'interactive' && message.interactive.button_reply.id === 'order_medicine') {
        await sendMessageWithButtons(from, 'Order Medicine', 'Visit our web application to order medicines:', [
          { type: 'url', reply: { id: 'web_link', title: 'Open Web App', url: 'https://pharmacy-booking.com' } }
        ]);
      } else if (message.type === 'interactive' && message.interactive.button_reply.id === 'contact_support') {
        await sendMessageWithButtons(from, 'Contact Support', 'You can reach us via:', [
          { type: 'reply', reply: { id: 'email_support', title: 'Email Support' } },
          { type: 'reply', reply: { id: 'phone_support', title: 'Phone Support' } }
        ]);
      } else {
        await sendMessageWithButtons(from, 'Invalid Option', 'Sorry, I did not understand that. Please try again:', [
          { type: 'reply', reply: { id: 'restart', title: 'Start Over' } }
        ]);
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
