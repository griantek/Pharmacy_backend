// Backend for Pharmacy Web Application using SQLite
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const secretKey = '123';
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware

app.use('/uploads', express.static('uploads'));
app.use(cors());
app.use(bodyParser.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

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

// Add delivery boy verification middleware
const verifyDeliveryToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err || decoded.role !== 'delivery') {
      return res.status(401).send('Unauthorized');
    }
    req.user = decoded;
    next();
  });
};

// Add delivery orders endpoint
app.get('/delivery/orders', verifyDeliveryToken, (req, res) => {
  db.all(`
    SELECT 
      orders.*,
      medicines.name as medicine_name,
      medicines.price as medicine_price
    FROM orders 
    JOIN medicines ON orders.medicine_id = medicines.id
    WHERE orders.status IN ('verified', 'dispatched')
    ORDER BY orders.created_at DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Error fetching delivery orders:', err.message);
      return res.status(500).send('Error fetching orders');
    }
    res.json(rows);
  });
});

// Add delivery status update endpoint
app.put('/delivery/orders/:orderId/status', verifyDeliveryToken, (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  
  if (!['dispatched', 'delivered'].includes(status)) {
    return res.status(400).send('Invalid status');
  }

  db.get(`
    SELECT o.payment_status, o.phone_number, d.id as delivery_boy_id 
    FROM orders o
    JOIN delivery_boys d ON d.current_order_id = o.id
    WHERE o.id = ?`, 
    [orderId], 
    async (err, order) => {
      if (err) {
        return res.status(500).send('Error checking order');
      }
    
      if (status === 'delivered' && order.payment_status !== 'paid') {
        return res.status(400).send('Cannot mark as delivered until payment is received');
      }

      if (status === 'delivered') {
        // Clear current order
        db.run('UPDATE delivery_boys SET current_order_id = NULL WHERE current_order_id = ?', 
          [orderId]);

        // Send feedback request via WhatsApp
        const feedbackUrl = `${process.env.FRONTEND_URL}/feedback?orderId=${orderId}&deliveryBoyId=${order.delivery_boy_id}`;
        const message = `Thank you for choosing MedCare Pharmacy!\n\n` +
                       `Please rate your delivery experience:\n${feedbackUrl}`;

        try {
          await axios.post(
            `${process.env.WHATSAPP_API_URL}`,
            {
              messaging_product: "whatsapp",
              to: order.phone_number,
              type: "text",
              text: { body: message }
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (error) {
          console.error('Error sending feedback request:', error);
        }
      }

      db.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId], (err) => {
        if (err) {
          return res.status(500).send('Error updating status');
        }
        res.json({ success: true });
      });
    });
});

// Add payment status update endpoint for delivery
app.put('/delivery/orders/:orderId/payment', verifyDeliveryToken, (req, res) => {
  const { orderId } = req.params;
  const { payment_status } = req.body;
  
  if (!['pending', 'paid'].includes(payment_status)) {
    return res.status(400).send('Invalid payment status');
  }

  db.run('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, orderId], (err) => {
    if (err) {
      console.error('Error updating payment status:', err.message);
      return res.status(500).send('Error updating payment status');
    }
    res.json({ success: true });
  });
});

// WhatsApp messaging endpoints
app.post('/send-whatsapp-message', verifyAdminToken, async (req, res) => {
  const { phone, message } = req.body;
  
  try {
    await axios.post(
      `${process.env.WHATSAPP_API_URL}`,
      {
        messaging_product: "whatsapp",
        to: phone.replace(/[^0-9]/g, ''),
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('WhatsApp API Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

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

    // Add to existing tables creation
    db.run(`CREATE TABLE IF NOT EXISTS delivery_boys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      current_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      delivery_boy_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (delivery_boy_id) REFERENCES delivery_boys(id)
    )`);

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

app.post('/delivery/login', async (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM delivery_boys WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).send('Error during authentication');
    }

    if (!user || user.password !== password) {
      return res.status(401).send('Invalid credentials');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'delivery' },
      secretKey,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: user.id, name: user.name, phone: user.phone } });
  });
});

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

// Get all delivery boys
app.get('/admin/delivery-boys', verifyAdminToken, (req, res) => {
  db.all(`
    SELECT 
      d.id, 
      d.username, 
      d.name, 
      d.phone,
      d.current_order_id,
      o.status as order_status,
      o.user_name as customer_name,
      o.user_address as delivery_address
    FROM delivery_boys d
    LEFT JOIN orders o ON d.current_order_id = o.id
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching delivery boys:', err.message);
      return res.status(500).send('Error fetching delivery boys');
    }
    res.json(rows);
  });
});
// Add new delivery boy
app.post('/admin/delivery-boys', verifyAdminToken, (req, res) => {
  const { username, password, name, phone } = req.body;

  if (!username || !password || !name || !phone) {
    return res.status(400).send('All fields are required');
  }

  db.run(
    'INSERT INTO delivery_boys (username, password, name, phone) VALUES (?, ?, ?, ?)',
    [username, password, name, phone],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).send('Username already exists');
        }
        console.error('Error creating delivery boy:', err.message);
        return res.status(500).send('Error creating delivery boy');
      }
      res.json({ id: this.lastID });
    }
  );
});

// Update delivery boy
app.put('/admin/delivery-boys/:id', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  const { username, password, name, phone } = req.body;

  let query, params;
  if (password) {
    query = 'UPDATE delivery_boys SET username = ?, password = ?, name = ?, phone = ? WHERE id = ?';
    params = [username, password, name, phone, id];
  } else {
    query = 'UPDATE delivery_boys SET username = ?, name = ?, phone = ? WHERE id = ?';
    params = [username, name, phone, id];
  }

  db.run(query, params, function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).send('Username already exists');
      }
      console.error('Error updating delivery boy:', err.message);
      return res.status(500).send('Error updating delivery boy');
    }
    res.json({ success: true });
  });
});

// Delete delivery boy
app.delete('/admin/delivery-boys/:id', verifyAdminToken, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM delivery_boys WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Error deleting delivery boy:', err.message);
      return res.status(500).send('Error deleting delivery boy');
    }
    res.json({ success: true });
  });
});

// Add endpoint to assign order to delivery boy
app.put('/admin/delivery-boys/:id/assign-order', verifyAdminToken, (req, res) => {
  const { id } = req.params;
  const { orderId } = req.body;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run('UPDATE delivery_boys SET current_order_id = ? WHERE id = ?', 
      [orderId, id], function(err) {
        if (err) {
          db.run('ROLLBACK');
          console.error('Error assigning order:', err.message);
          return res.status(500).send('Error assigning order');
        }

        db.run('UPDATE orders SET status = ? WHERE id = ?', 
          ['dispatched', orderId], function(err) {
            if (err) {
              db.run('ROLLBACK');
              console.error('Error updating order status:', err.message);
              return res.status(500).send('Error updating order status');
            }

            db.run('COMMIT');
            res.json({ success: true });
        });
    });
  });
});

// Add endpoint to get current order for delivery boy
app.get('/delivery/current-order', verifyDeliveryToken, (req, res) => {
  const deliveryBoyId = req.user.id;

  db.get(`
    SELECT 
      d.current_order_id,
      o.*,
      m.name as medicine_name,
      m.price as medicine_price
    FROM delivery_boys d
    LEFT JOIN orders o ON d.current_order_id = o.id
    LEFT JOIN medicines m ON o.medicine_id = m.id
    WHERE d.id = ?
  `, [deliveryBoyId], (err, row) => {
    if (err) {
      console.error('Error fetching current order:', err.message);
      return res.status(500).send('Error fetching current order');
    }
    if (!row?.current_order_id) {
      return res.json(null);
    }
    res.json(row);
  });
});

// Add feedback endpoints
app.post('/api/feedback', async (req, res) => {
  const { orderId, deliveryBoyId, rating, comment } = req.body;

  db.run(
    'INSERT INTO feedback (order_id, delivery_boy_id, rating, comment) VALUES (?, ?, ?, ?)',
    [orderId, deliveryBoyId, rating, comment],
    function(err) {
      if (err) {
        console.error('Error saving feedback:', err);
        return res.status(500).json({ error: 'Failed to save feedback' });
      }
      res.json({ success: true });
    }
  );
});

app.get('/admin/feedbacks', verifyAdminToken, (req, res) => {
  db.all(`
    SELECT 
      f.*,
      d.name as delivery_boy_name,
      o.status as order_status
    FROM feedback f
    JOIN delivery_boys d ON f.delivery_boy_id = d.id
    JOIN orders o ON f.order_id = o.id
    ORDER BY f.created_at DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching feedbacks:', err.message);
      return res.status(500).send('Error fetching feedbacks');
    }
    res.json(rows);
  });
});
// Start the server
app.listen(PORT, () => {
  console.log(`Pharmacy app backend running on port ${PORT}`);
});