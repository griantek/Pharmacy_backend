require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());

// SQLite Database Connection
const db = new sqlite3.Database('./pharmacy_booking.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Helper Functions
const sendWhatsAppMessage = async (phoneNumber, headerText, bodyText, buttons, type = 'button') => {
  try {
    const message = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type,
        header: { type: 'text', text: headerText },
        body: { text: bodyText },
        action: { buttons }
      }
    };
    
    await axios.post(process.env.WHATSAPP_API_URL, message, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

const checkActiveOrder = (phoneNumber) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT orders.*, medicines.name as medicine_name 
       FROM orders 
       JOIN medicines ON orders.medicine_id = medicines.id 
       WHERE phone_number = ? AND status NOT IN ("cancelled", "delivered")
       ORDER BY created_at DESC LIMIT 1`,
      [phoneNumber],
      (err, row) => {
      if (err) reject(err);
      resolve(row);
      }
    );
  });
};

const setOrderReminder = (phoneNumber) => {
  setTimeout(async () => {
    const order = await checkActiveOrder(phoneNumber);
    if (!order) {
      await sendWhatsAppMessage(
        phoneNumber,
        "Reminder",
        "Don't forget to complete your order!",
        [{ type: 'reply', reply: { id: 'order_now', title: 'Order Now' } }]
      );
    }
  }, 600000); // 10 minutes
};

const cancelOrder = (orderId) => {
  return new Promise((resolve, reject) => {
    db.run('UPDATE orders SET status = ? WHERE id = ?', 
    ['cancelled', orderId], 
    (err) => {
      if (err) reject(err);
      resolve();
    });
  });
};

const sendOrderDetails = async (phoneNumber, order) => {
  await sendWhatsAppMessage(
    phoneNumber,
    "Order Details",
    `Order #${order.id}\n` +
    `Medicine: ${order.medicine_name}\n` +
    `Quantity: ${order.quantity}\n` +
    `Status: ${order.status}\n` +
    `Total: ₹${order.total_price}`,
    []
  );
};

// Webhook Handler
app.post('/webhook', async (req, res) => {
  const { entry } = req.body;
  const phoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    // Check if the phone_number_id matches the chatbot's ID
    if (phoneNumberId !== `${process.env.ID}`) {
        console.log(`Ignoring message sent to phone_number_id: ${phoneNumberId}`);
        return res.sendStatus(200); // Ignore the request
    }

  if (entry?.[0]?.changes?.[0]?.value?.messages) {
    const message = entry[0].changes[0].value.messages[0];
    const incomingMessage = req.body.entry[0].changes[0].value.messages[0];
    const senderId = incomingMessage.phone; // WhatsApp ID (includes phone number)
    const phone = senderId.replace('whatsapp:', ''); // Extract phone number
    const userName = entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Customer";
    
    try {
      if (message.text?.body.toLowerCase() === 'hi') {
        const activeOrder = await checkActiveOrder(phone);
        
        if (!activeOrder) {
          await sendWhatsAppMessage(
            phone,
            `Welcome ${userName}!`,
            "How can we help you today?",
            [
              { type: 'reply', reply: { id: 'new_order', title: 'Place Order' } },
              { type: 'reply', reply: { id: 'contact_us', title: 'Contact Us' } }
            ]
          );
        } else {
          await sendWhatsAppMessage(
            phone,
            `Welcome back ${userName}!`,
            "What would you like to do?",
            [
              { type: 'reply', reply: { id: 'view_order', title: 'View Order' } },
              { type: 'reply', reply: { id: 'contact_us', title: 'Contact Us' } }
            ]
          );
        }
      } else if (message.interactive?.button_reply) {
        const { id } = message.interactive.button_reply;
        const activeOrder = await checkActiveOrder(phone);
        
        switch(id) {
          case 'new_order':
            await sendWhatsAppMessage(
              phone,
              "Order Medicines",
              "Click below to place your order:",
              [{ type: 'url', url: `${process.env.WEB_APP_URL}/order`, title: 'Order Now' }]
            );
            setOrderReminder(phone);
            break;
            
          case 'view_order':
            if (activeOrder) {
              await sendWhatsAppMessage(
                phone,
                "Order Management",
                "What would you like to do with your order?",
                [
                  { type: 'reply', reply: { id: 'modify_order', title: 'Modify Order' } },
                  { type: 'reply', reply: { id: 'track_order', title: 'Track Order' } },
                  { type: 'reply', reply: { id: 'cancel_order', title: 'Cancel Order' } }
                ]
              );
            }
            break;
            
          case 'modify_order':
            if (activeOrder) {
              await sendWhatsAppMessage(
                phone,
                "Modify Order",
                "Click below to modify your order:",
                [{ type: 'url', url: `${process.env.WEB_APP_URL}/modify/${activeOrder.id}`, title: 'Modify Order' }]
              );
            }
            break;
            
          case 'track_order':
            if (activeOrder) {
              await sendOrderDetails(phone, activeOrder);
            }
            break;
            
          case 'cancel_order':
            if (activeOrder) {
              await sendWhatsAppMessage(
                phone,
                "Cancel Order",
                "Are you sure you want to cancel your order?",
                [
                  { type: 'reply', reply: { id: 'confirm_cancel', title: 'Yes, Cancel' } },
                  { type: 'reply', reply: { id: 'keep_order', title: 'No, Keep Order' } }
                ]
              );
            }
            break;
            
          case 'confirm_cancel':
            if (activeOrder) {
              await cancelOrder(activeOrder.id);
              await sendWhatsAppMessage(
                phone,
                "Order Cancelled",
                "Your order has been cancelled successfully.",
                [{ type: 'reply', reply: { id: 'new_order', title: 'Place New Order' } }]
              );
            }
            break;
            
          case 'contact_us':
            await sendWhatsAppMessage(
              phone,
              "Contact Information",
              "XL Pharmacy\nAddress: 123 Health Street\nPhone: +1234567890\nEmail: support@xlpharmacy.com",
              [{ type: 'reply', reply: { id: 'show_location', title: 'Show Location' } }]
            );
            break;
            
          case 'show_location':
            await axios.post(
              process.env.WHATSAPP_API_URL,
              {
                messaging_product: 'whatsapp',
                to: phone,
                type: 'location',
                location: {
                  latitude: process.env.STORE_LATITUDE,
                  longitude: process.env.STORE_LONGITUDE,
                  name: "XL Pharmacy",
                  address: "123 Health Street"
                }
              },
              {
                headers: {
                  Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            break;
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }
  
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});