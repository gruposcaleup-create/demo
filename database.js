const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Conexión a la base de datos (se crea archivo si no existe)
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        // Tabla de Usuarios
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT,
            firstName TEXT,
            lastName TEXT,
            role TEXT DEFAULT 'user',
            status TEXT DEFAULT 'active',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla de Cursos
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
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla de Módulos (almacenados como JSON por simplicidad en este prototipo, 
        // o idealmente tabla separada. Para rapidez usaremos JSON en una columna TEXT en courses 
        // O tabla relacional. Vamos con tabla relacional para ser "pro")
        // Decisión: Para simplificar el ABM en el frontend que ya envía JSON completo, 
        // guardaremos la estructura de módulos como JSON string en la tabla courses por ahora,
        // ya que el frontend espera un objeto anidado.
        try {
            db.run(`ALTER TABLE courses ADD COLUMN modulesData TEXT`, (err) => { });
        } catch (e) { }


        // Tabla de Ordenes/Ventas
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            total REAL,
            status TEXT DEFAULT 'completed',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            items TEXT -- JSON con los items comprados
        )`);

        // Tabla de Cupones
        db.run(`CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            discount REAL,
            type TEXT DEFAULT 'percentage',
            status TEXT DEFAULT 'active',
            usedCount INTEGER DEFAULT 0
        )`);

        // Recursos
        db.run(`CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            description TEXT,
            type TEXT,
            url TEXT,
            dataUrl TEXT, 
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        try {
            db.run(`ALTER TABLE resources ADD COLUMN description TEXT`, (err) => { });
        } catch (e) { }

        // Settings (Configuration)
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Seed default membership price if not exists
        db.get("SELECT value FROM settings WHERE key = 'membership_price'", [], (err, row) => {
            if (!row) {
                db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['membership_price', '999']);
                db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['membership_price_offer', '']);
            }
        });

        // Enrollments (Missing/Fix)
        db.run(`CREATE TABLE IF NOT EXISTS enrollments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            courseId INTEGER,
            progress REAL DEFAULT 0,
            lastAccess DATETIME DEFAULT CURRENT_TIMESTAMP,
            totalHoursSpent REAL DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(userId) REFERENCES users(id),
            FOREIGN KEY(courseId) REFERENCES courses(id)
        )`);

        console.log('Tablas inicializadas o verificadas.');

        // Crear usuario admin default si no existe
        db.get("SELECT * FROM users WHERE email = 'admin@julg.com'", [], (err, row) => {
            if (!row) {
                // Pass: admin (en prod usar bcrypt, aquí simple para cumplir "ya mismo")
                db.run(`INSERT INTO users (email, password, firstName, lastName, role) VALUES (?, ?, ?, ?, ?)`,
                    ['admin@julg.com', 'admin', 'Admin', 'User', 'admin'],
                    (err) => {
                        if (err) console.error(err.message);
                        else console.log('Usuario admin creado por defecto.');
                    }
                );
            }
        });

        // Cursos de ejemplo
        db.get("SELECT COUNT(*) as count FROM courses", [], (err, row) => {
            if (row && row.count === 0) {
                const sampleModules = JSON.stringify([
                    { id: 1, title: 'Introducción', lessons: [{ id: 1, title: 'Bienvenida', url: 'https://www.youtube.com/watch?v=xyz' }] }
                ]);

                db.run(`INSERT INTO courses (title, desc, price, category, modulesData, image) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['Curso Fiscal 2024', 'Aprende todo sobre las nuevas reformas.', 99.00, 'Fiscal', sampleModules, 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=600']);

                db.run(`INSERT INTO courses (title, desc, price, category, modulesData, image) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['Contabilidad para No Contadores', 'Domina los números de tu negocio.', 49.00, 'Contabilidad', sampleModules, 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=600']);

                console.log('Cursos de ejemplo insertados.');
            }
        });
    });
}

module.exports = db;
