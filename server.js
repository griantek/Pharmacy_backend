// Backend for Pharmacy Web Application using SQLite

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const secretKey = '123';
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
      phone_number TEXT NOT NULL,
      medicine_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      prescription_photo TEXT,
      total_price REAL,
      payment_status TEXT DEFAULT 'pending',
      prescription_verified BOOLEAN DEFAULT false,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );`);

    console.log('Tables created or already exist.');
  });
};

createTables();

// Configure Multer for prescription uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5 MB
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|gif/;
    const extName = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeType = fileTypes.test(file.mimetype);
    if (extName && mimeType) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed (JPEG, PNG, GIF).'));
    }
  },
});

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
app.post('/order', upload.single('prescription'), (req, res) => {
  const { user_name, user_address, phone_number, medicine_id, quantity } = req.body;
  const prescriptionPhoto = req.file ? req.file.path : null;

  // Check medicine price and calculate total
  db.get('SELECT category_id, stock, price FROM medicines WHERE id = ?', [medicine_id], (err, medicine) => {
    if (err) {
      console.error('Error checking medicine:', err.message);
      return res.status(500).send('Error checking medicine.');
    }

    if (!medicine) {
      return res.status(404).send('Medicine not found.');
    }

    const total_price = medicine.price * quantity;

    // Insert order with total price
    db.run(
      `INSERT INTO orders (user_name, user_address, phone_number, medicine_id, quantity, status, prescription_photo, total_price) 
       VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)`,
      [user_name, user_address, phone_number, medicine_id, quantity, prescriptionPhoto, total_price],
      function (err) {
        if (err) {
          console.error('Error placing order:', err.message);
          return res.status(500).send('Error placing order.');
        }
        // Update stock
        db.run('UPDATE medicines SET stock = stock - ? WHERE id = ?', [quantity, medicine_id], (err) => {
          if (err) {
            console.error('Error updating stock:', err.message);
            return res.status(500).send('Error updating stock.');
          }
          res.json({ success: true, orderId: this.lastID });
        });
      }
    );
  });
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
// Fetch order details with medicine info
app.get('/order/:orderId', (req, res) => {
  const { orderId } = req.params;
  db.get(`
    SELECT orders.*, 
           medicines.name as medicine_name, 
           medicines.price as medicine_price
    FROM orders 
    JOIN medicines ON orders.medicine_id = medicines.id 
    WHERE orders.id = ?`, 
    [orderId], 
    (err, row) => {
      if (err) {
        console.error('Error fetching order details:', err.message);
        return res.status(500).send('Error fetching order details.');
      }
      res.json(row);
    });
});

// Fetch all medicines
app.get('/medicines', (req, res) => {
  db.all('SELECT * FROM medicines', [], (err, rows) => {
    if (err) {
      console.error('Error fetching medicines:', err.message);
      return res.status(500).send('Error fetching medicines.');
    }
    res.json(rows);
  });
});
// Fetch medicine details by ID
app.get('/medicine/:medicineId', (req, res) => {
  const { medicineId } = req.params;
  db.get('SELECT * FROM medicines WHERE id = ?', [medicineId], (err, row) => {
    if (err) {
      console.error('Error fetching medicine details:', err.message);
      return res.status(500).send('Error fetching medicine details.');
    }
    if (!row) {
      return res.status(404).send('Medicine not found.');
    }
    res.json(row);
  });
});
// Cancel an order
app.delete('/order/:orderId', (req, res) => {
  const { orderId } = req.params;

  // Get the order details
  db.get('SELECT medicine_id, quantity FROM orders WHERE id = ?', [orderId], (err, row) => {
    if (err) {
      console.error('Error fetching order details:', err.message);
      return res.status(500).send('Error fetching order details.');
    }

    if (!row) {
      return res.status(404).send('Order not found.');
    }

    const { medicine_id, quantity } = row;

    // Delete the order
    db.run('DELETE FROM orders WHERE id = ?', [orderId], function (err) {
      if (err) {
        console.error('Error deleting order:', err.message);
        return res.status(500).send('Error deleting order.');
      }

      // Restore the stock of the medicine
      db.run('UPDATE medicines SET stock = stock + ? WHERE id = ?', [quantity, medicine_id], (err) => {
        if (err) {
          console.error('Error updating stock:', err.message);
          return res.status(500).send('Error updating stock.');
        }
        res.json({ success: true });
      });
    });
  });
});

// Update order details
app.patch('/order/:orderId', upload.single('prescription'), (req, res) => {
  const { orderId } = req.params;
  const { user_name, user_address, phone_number, medicine_id, quantity } = req.body;
  const prescriptionPhoto = req.file ? req.file.path : null;

  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) {
      console.error('Error fetching order:', err.message);
      return res.status(500).send('Error fetching order.');
    }

    if (!order) return res.status(404).send('Order not found.');
    if (order.status !== 'Pending') return res.status(400).send('Only pending orders can be modified.');

    // Get new medicine price if medicine changed
    db.get('SELECT price FROM medicines WHERE id = ?', [medicine_id], (err, medicine) => {
      if (err) return res.status(500).send('Error fetching medicine.');
      if (!medicine) return res.status(404).send('Medicine not found.');

      const total_price = medicine.price * quantity;

      if (order.medicine_id !== medicine_id || order.quantity !== quantity) {
        // Update stock for both old and new medicine
        db.run('UPDATE medicines SET stock = stock + ? WHERE id = ?', [order.quantity, order.medicine_id], (err) => {
          if (err) return res.status(500).send('Error updating old stock.');

          db.run('UPDATE medicines SET stock = stock - ? WHERE id = ?', [quantity, medicine_id], (err) => {
            if (err) return res.status(500).send('Error updating new stock.');
            // Update order with new total price
            db.run(
              `UPDATE orders SET user_name = ?, user_address = ?, phone_number = ?, medicine_id = ?, 
               quantity = ?, prescription_photo = ?, total_price = ? WHERE id = ?`,
              [user_name, user_address, phone_number, medicine_id, quantity, 
               prescriptionPhoto || order.prescription_photo, total_price, orderId],
              (err) => {
                if (err) return res.status(500).send('Error updating order.');
                res.json({ success: true });
              }
            );
          });
        });
      } else {
        // Update order without stock changes
        db.run(
          `UPDATE orders SET user_name = ?, user_address = ?, phone_number = ?, 
           prescription_photo = ?, total_price = ? WHERE id = ?`,
          [user_name, user_address, phone_number, 
           prescriptionPhoto || order.prescription_photo, total_price, orderId],
          (err) => {
            if (err) return res.status(500).send('Error updating order.');
            res.json({ success: true });
          }
        );
      }
    });
  });
});

// Admin login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  // Replace with your actual admin credentials validation
  if (username === 'admin' && password === '1234') {
    const token = jwt.sign({ username }, secretKey, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid username or password' });
  }
});

// Middleware to verify admin token
const verifyAdminToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).send('Unauthorized');
  }

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(401).send('Unauthorized');
    }
    req.user = decoded;
    next();
  });
};

// Fetch admin dashboard stats
app.get('/admin/stats', verifyAdminToken, (req, res) => {
  const stats = {};

  db.serialize(() => {
    db.get('SELECT COUNT(*) AS totalOrders FROM orders', (err, row) => {
      if (err) {
        console.error('Error fetching total orders:', err.message);
        return res.status(500).send('Error fetching total orders.');
      }
      stats.totalOrders = row.totalOrders;

      db.get('SELECT SUM(quantity * price) AS totalRevenue FROM orders JOIN medicines ON orders.medicine_id = medicines.id', (err, row) => {
        if (err) {
          console.error('Error fetching total revenue:', err.message);
          return res.status(500).send('Error fetching total revenue.');
        }
        stats.totalRevenue = row.totalRevenue || 0;

        db.all('SELECT orders.id, orders.user_name, orders.created_at, medicines.name AS medicine_name, (orders.quantity * medicines.price) AS total_price, orders.status FROM orders JOIN medicines ON orders.medicine_id = medicines.id ORDER BY orders.created_at DESC LIMIT 10', (err, rows) => {
          if (err) {
            console.error('Error fetching recent orders:', err.message);
            return res.status(500).send('Error fetching recent orders.');
          }
          stats.recentOrders = rows;
          res.json(stats);
        });
      });
    });
  });
});

// Fetch admin orders
app.get('/admin/orders', verifyAdminToken, (req, res) => {
  db.all('SELECT orders.id, orders.user_name, orders.user_address, orders.phone_number, medicines.name AS medicine_name, orders.quantity, (orders.quantity * medicines.price) AS total_price, orders.status, orders.created_at FROM orders JOIN medicines ON orders.medicine_id = medicines.id ORDER BY orders.created_at DESC', (err, rows) => {
    if (err) {
      console.error('Error fetching orders:', err.message);
      return res.status(500).send('Error fetching orders.');
    }
    res.json(rows);
  });
});

// Cancel an order
app.delete('/admin/orders/:orderId', verifyAdminToken, (req, res) => {
  const { orderId } = req.params;

  db.run('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', orderId], function(err) {
    if (err) {
      console.error('Error cancelling order:', err.message);
      return res.status(500).send('Error cancelling order.');
    }
    res.json({ success: true });
  });
});
// Fetch admin medicines
// Fetch admin medicines with categories
app.get('/admin/medicines', verifyAdminToken, (req, res) => {
  db.all('SELECT medicines.*, categories.name AS category_name FROM medicines JOIN categories ON medicines.category_id = categories.id ORDER BY medicines.name', (err, rows) => {
    if (err) {
      console.error('Error fetching medicines:', err.message);
      return res.status(500).send('Error fetching medicines.');
    }
    res.json(rows);
  });
});

// Add a new medicine with category
app.post('/admin/medicines', verifyAdminToken, (req, res) => {
  const { name, description, price, stock, category_id } = req.body;
  db.run('INSERT INTO medicines (name, description, price, stock, category_id) VALUES (?, ?, ?, ?, ?)', [name, description, price, stock, category_id], function(err) {
    if (err) {
      console.error('Error adding medicine:', err.message);
      return res.status(500).send('Error adding medicine.');
    }
    res.json({ id: this.lastID });
  });
});

// Update a medicine with category
app.patch('/admin/medicines/:medicineId', verifyAdminToken, (req, res) => {
  const { medicineId } = req.params;
  const { name, description, price, stock, category_id } = req.body;
  db.run('UPDATE medicines SET name = ?, description = ?, price = ?, stock = ?, category_id = ? WHERE id = ?', [name, description, price, stock, category_id, medicineId], function(err) {
    if (err) {
      console.error('Error updating medicine:', err.message);
      return res.status(500).send('Error updating medicine.');
    }
    res.json({ success: true });
  });
});

// Delete a medicine
app.delete('/admin/medicines/:medicineId', verifyAdminToken, (req, res) => {
  const { medicineId } = req.params;
  db.run('DELETE FROM medicines WHERE id = ?', [medicineId], function(err) {
    if (err) {
      console.error('Error deleting medicine:', err.message);
      return res.status(500).send('Error deleting medicine.');
    }
    res.json({ success: true });
  });
});

// Add prescription verification endpoint
app.put('/order/:orderId/verify-prescription', verifyAdminToken, (req, res) => {
  const { orderId } = req.params;
  db.run('UPDATE orders SET prescription_verified = true WHERE id = ?', [orderId], (err) => {
    if (err) {
      console.error('Error verifying prescription:', err.message);
      return res.status(500).send('Error verifying prescription.');
    }
    res.json({ success: true });
  });
});
// Add payment status update endpoint
app.put('/order/:orderId/payment-status', verifyAdminToken, (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  
  if (!['pending', 'paid'].includes(status)) {
    return res.status(400).send('Invalid payment status');
  }

  db.run('UPDATE orders SET payment_status = ? WHERE id = ?', [status, orderId], (err) => {
    if (err) {
      console.error('Error updating payment status:', err.message);
      return res.status(500).send('Error updating payment status.');
    }
    res.json({ success: true });
  });
});
// Start the server
app.listen(PORT, () => {
  console.log(`Pharmacy app backend running on port ${PORT}`);
});