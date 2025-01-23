// Backend for Pharmacy Web Application

const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database Connection (MySQL for scalability)
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'pharmacy_booking'
});

db.connect(err => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  console.log('Connected to MySQL database.');
});

// Routes

// Fetch categories
app.get('/categories', (req, res) => {
  const query = 'SELECT * FROM categories';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching categories:', err);
      return res.status(500).send('Error fetching categories.');
    }
    res.json(results);
  });
});

// Fetch medicines by category
app.get('/medicines/:categoryId', (req, res) => {
  const { categoryId } = req.params;
  const query = 'SELECT * FROM medicines WHERE category_id = ?';
  db.query(query, [categoryId], (err, results) => {
    if (err) {
      console.error('Error fetching medicines:', err);
      return res.status(500).send('Error fetching medicines.');
    }
    res.json(results);
  });
});

// Check medicine availability
app.get('/availability/:medicineId', (req, res) => {
  const { medicineId } = req.params;
  const query = 'SELECT stock FROM medicines WHERE id = ?';
  db.query(query, [medicineId], (err, results) => {
    if (err) {
      console.error('Error checking availability:', err);
      return res.status(500).send('Error checking availability.');
    }
    if (results.length > 0 && results[0].stock > 0) {
      res.json({ available: true });
    } else {
      res.json({ available: false });
    }
  });
});

// Place an order
app.post('/order', (req, res) => {
  const { userId, medicineId, quantity, address } = req.body;
  const query = 'INSERT INTO orders (user_id, medicine_id, quantity, address, status) VALUES (?, ?, ?, ?, ?)';
  db.query(query, [userId, medicineId, quantity, address, 'Pending'], (err, results) => {
    if (err) {
      console.error('Error placing order:', err);
      return res.status(500).send('Error placing order.');
    }
    res.json({ success: true, orderId: results.insertId });
  });
});

// Update order status
app.put('/order/:orderId/status', (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  const query = 'UPDATE orders SET status = ? WHERE id = ?';
  db.query(query, [status, orderId], (err) => {
    if (err) {
      console.error('Error updating order status:', err);
      return res.status(500).send('Error updating order status.');
    }
    res.json({ success: true });
  });
});

// Fetch order details
app.get('/order/:orderId', (req, res) => {
  const { orderId } = req.params;
  const query = 'SELECT * FROM orders WHERE id = ?';
  db.query(query, [orderId], (err, results) => {
    if (err) {
      console.error('Error fetching order details:', err);
      return res.status(500).send('Error fetching order details.');
    }
    res.json(results[0]);
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Pharmacy app backend running on port ${PORT}`);
});
