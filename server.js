// Backend for Pharmacy Web Application using SQLite

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./pharmacy_booking.db', (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

// Create Tables if Not Exist
const createTables = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category_id INTEGER NOT NULL,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      user_address TEXT NOT NULL,
      medicine_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );`);

    console.log('Tables created or already exist.');
  });
};

createTables();

// Routes

// Fetch categories
app.get('/categories', (req, res) => {
  db.all('SELECT * FROM categories', [], (err, rows) => {
    if (err) {
      console.error('Error fetching categories:', err.message);
      return res.status(500).send('Error fetching categories.');
    }
    res.json(rows);
  });
});

// Fetch medicines by category
app.get('/medicines/:categoryId', (req, res) => {
  const { categoryId } = req.params;
  db.all('SELECT * FROM medicines WHERE category_id = ?', [categoryId], (err, rows) => {
    if (err) {
      console.error('Error fetching medicines:', err.message);
      return res.status(500).send('Error fetching medicines.');
    }
    res.json(rows);
  });
});

// Check medicine availability
app.get('/availability/:medicineId', (req, res) => {
  const { medicineId } = req.params;
  db.get('SELECT stock FROM medicines WHERE id = ?', [medicineId], (err, row) => {
    if (err) {
      console.error('Error checking availability:', err.message);
      return res.status(500).send('Error checking availability.');
    }
    res.json({ available: row && row.stock > 0 });
  });
});

// Place an order
app.post('/order', (req, res) => {
  const { user_name, user_address, medicine_id, quantity } = req.body;
  db.run(
    `INSERT INTO orders (user_name, user_address, medicine_id, quantity, status) VALUES (?, ?, ?, ?, 'Pending')`,
    [user_name, user_address, medicine_id, quantity],
    function (err) {
      if (err) {
        console.error('Error placing order:', err.message);
        return res.status(500).send('Error placing order.');
      }
      res.json({ success: true, orderId: this.lastID });
    }
  );
});

// Update order status
app.put('/order/:orderId/status', (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  db.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId], function (err) {
    if (err) {
      console.error('Error updating order status:', err.message);
      return res.status(500).send('Error updating order status.');
    }
    res.json({ success: true });
  });
});

// Fetch order details
app.get('/order/:orderId', (req, res) => {
  const { orderId } = req.params;
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, row) => {
    if (err) {
      console.error('Error fetching order details:', err.message);
      return res.status(500).send('Error fetching order details.');
    }
    res.json(row);
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Pharmacy app backend running on port ${PORT}`);
});
