const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// --- SQLITE MODE FORCED ---
// We use a persistent file path.
// Note: On Render Web Services without a Disk, this file is ephemeral (resets on deploy/restart).
// Use Render Disks for persistence if needed, but per request we use a local file.
const dbPath = path.resolve(__dirname, 'tienda.db'); // Changed to tienda.db to ensure consistency if it existed before

console.log(`Connecting to SQLite at ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('CRITICAL: Error connecting to SQLite:', err.message);
    } else {
        console.log('Connected to SQLite');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT,
            firstName TEXT,
            lastName TEXT,
            role TEXT DEFAULT 'user',
            status TEXT DEFAULT 'active',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => { if (err) console.error("Init Users:", err.message) });

        // Courses Table
        db.run(`CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            desc TEXT,
            price REAL,
            priceOffer REAL,
            image TEXT,
            videoPromo TEXT,
            category TEXT,
            status TEXT DEFAULT 'active',
            modulesCount INTEGER DEFAULT 0,
            modulesData TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Init Courses:", err.message);
        });

        // Orders Table
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            total REAL,
            status TEXT DEFAULT 'completed',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            items TEXT
        )`);

        // Coupons
        db.run(`CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            discount REAL,
            type TEXT DEFAULT 'percentage',
            status TEXT DEFAULT 'active',
            usedCount INTEGER DEFAULT 0
        )`);

        // Resources
        db.run(`CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            description TEXT,
            type TEXT,
            url TEXT,
            dataUrl TEXT, 
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Settings
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Enrollments (Progress & Access)
        db.run(`CREATE TABLE IF NOT EXISTS enrollments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            courseId INTEGER,
            progress REAL DEFAULT 0,
            lastAccess DATETIME DEFAULT CURRENT_TIMESTAMP,
            totalHoursSpent REAL DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            -- FOREIGN KEY (userId) REFERENCES users(id)
            -- FOREIGN KEY (courseId) REFERENCES courses(id)
        )`);

        // Memberships (Annual Logic)
        db.run(`CREATE TABLE IF NOT EXISTS memberships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            status TEXT DEFAULT 'active', -- active, expired, cancelled
            startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
            endDate DATETIME,
            paymentId INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Password Resets
        db.run(`CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT,
            code TEXT,
            expiresAt DATETIME,
            used BOOLEAN DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // --- Seed Data ---

        // Settings Seed
        db.get("SELECT value FROM settings WHERE key = 'membership_price'", [], (err, row) => {
            if (!row) {
                db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['membership_price', '999']);
                db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['membership_price_offer', '']);
            }
        });

        // Admin User Seed
        db.get("SELECT * FROM users WHERE email = 'admin@julg.com'", [], (err, row) => {
            if (!row) {
                db.run(`INSERT INTO users (email, password, firstName, lastName, role) VALUES (?, ?, ?, ?, ?)`,
                    ['admin@julg.com', 'admin', 'Admin', 'User', 'admin'],
                    (err) => {
                        if (!err) console.log('Admin user seeded.');
                    }
                );
            }
        });

        // Sample Courses
        db.get("SELECT COUNT(*) as count FROM courses", [], (err, row) => {
            if (row && row.count == 0) {
                const sampleModules = JSON.stringify([
                    { id: 1, title: 'Introducción', lessons: [{ id: 1, title: 'Bienvenida', url: 'https://www.youtube.com/watch?v=xyz' }] }
                ]);

                db.run(`INSERT INTO courses (title, desc, price, category, modulesData, image) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['Curso Fiscal 2024', 'Aprende todo sobre las nuevas reformas.', 99.00, 'Fiscal', sampleModules, 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=600']);

                db.run(`INSERT INTO courses (title, desc, price, category, modulesData, image) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['Contabilidad para No Contadores', 'Domina los números de tu negocio.', 49.00, 'Contabilidad', sampleModules, 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=600']);

                console.log('Sample courses seeded.');
            }
        });

    });
}

db.init = initDatabase;

module.exports = db;
