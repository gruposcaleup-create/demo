const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

// Detect environment
const isPostgres = !!(process.env.POSTGRES_URL || process.env.DATABASE_URL);
let db;
let sqlite3;

// Safe require for SQLite to avoid Vercel crashes if it fails to build
if (!isPostgres) {
    try {
        sqlite3 = require('sqlite3').verbose();
    } catch (e) {
        console.error("SQLite3 dependency not found or failed to load. If you are on Vercel, this is expected ONLY if you use Postgres.", e);
    }
}

if (isPostgres) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    console.log('Using PostgreSQL database (Cloud Mode)');

    // Helper: Translate SQLite '?' -> Postgres '$1', '$2', etc.
    const translateQuery = (sql) => {
        let i = 1;
        return sql.replace(/\?/g, () => `$${i++}`);
    };

    // Adapter Object
    db = {
        pool, // expose for direct access if needed
        serialize: (cb) => cb(), // PG is async, invoke immediately

        run: function (sql, params = [], callback) {
            if (typeof params === 'function') { callback = params; params = []; }

            // 1. Table Creation Compatibility
            if (sql.trim().toUpperCase().startsWith('CREATE TABLE')) {
                // Primary Key mapping
                sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
                // DateTime mapping
                sql = sql.replace(/DATETIME/gi, 'TIMESTAMP');
            }
            // 2. ALTER TABLE fixes
            // Sqlite "ALTER TABLE x ADD COLUMN y TEXT" works in PG too.

            // 3. INSERT RETURNING ID
            // SQLite 'this.lastID' usage requires us to return the ID from PG.
            let isInsert = sql.trim().toUpperCase().startsWith('INSERT');
            if (isInsert && !sql.toLowerCase().includes('returning')) {
                // Simple heuristic: just append RETURNING id. 
                // Will fail if table has no 'id' col, but all our tables do.
                sql += ' RETURNING id';
            }

            const pgSql = translateQuery(sql);

            pool.query(pgSql, params, (err, res) => {
                if (err) {
                    // Ignore "relation already exists" or "column already exists" for init
                    if (err.code === '42P07' || err.code === '42701') {
                        // table/col exists, treat as success for idempotency
                        if (callback) callback.call({ lastID: 0, changes: 0 }, null);
                        return;
                    }
                    if (callback) callback(err);
                    else console.error('DB Error:', err.message);
                    return;
                }

                // Mock existing SQLite 'this' context
                const context = {
                    lastID: (isInsert && res.rows[0]) ? res.rows[0].id : 0,
                    changes: res.rowCount
                };

                if (callback) callback.call(context, null);
            });
        },

        get: function (sql, params = [], callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            const pgSql = translateQuery(sql);
            pool.query(pgSql, params, (err, res) => {
                if (err) return callback(err);
                callback(null, res.rows[0]);
            });
        },

        all: function (sql, params = [], callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            const pgSql = translateQuery(sql);
            pool.query(pgSql, params, (err, res) => {
                if (err) return callback(err);
                callback(null, res.rows);
            });
        }
    };

    // Run Init after a brief tick to ensure export (simulated start)
    setTimeout(() => initDatabase(), 500);

} else {
    // --- LOCAL SQLITE MODE ---
    const dbPath = path.resolve(__dirname, 'database.sqlite');
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error connecting to SQLite:', err.message);
        } else {
            console.log('Connected to SQLite (Local Mode)');
            initDatabase();
        }
    });
}

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
            // If failed, maybe it exists? Try ALTER just in case if using sqlite (PG create handled above)
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

        // Enrollments
        db.run(`CREATE TABLE IF NOT EXISTS enrollments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            courseId INTEGER,
            progress REAL DEFAULT 0,
            lastAccess DATETIME DEFAULT CURRENT_TIMESTAMP,
            totalHoursSpent REAL DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            -- FOREIGN KEYS removed for simple compatibility if needed, but keeping logic
        )`);

        // --- Seed Data ---

        // Settings Seed
        db.get("SELECT value FROM settings WHERE key = 'membership_price'", [], (err, row) => {
            // Ignore errors (table might just have been created)
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
            if (row && row.count == 0) { // weak equality for string '0' from PG
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

module.exports = db;
