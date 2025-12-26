const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    console.log("Checking resources table...");
    db.all("PRAGMA table_info(resources)", (err, rows) => {
        if (err) {
            console.error("Error checking table:", err);
            return;
        }
        const hasDesc = rows.some(r => r.name === 'description');
        if (!hasDesc) {
            console.log("Adding description column...");
            db.run("ALTER TABLE resources ADD COLUMN description TEXT", (err) => {
                if (err) console.error("Error adding column:", err);
                else console.log("Column added successfully.");
            });
        } else {
            console.log("Description column already exists.");
        }
    });
});
