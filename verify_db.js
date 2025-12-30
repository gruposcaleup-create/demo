var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('tienda.db');

db.all("SELECT * FROM courses", function (err, rows) {
    if (err) {
        console.error("Error reading courses:", err.message);
        process.exit(1);
    }
    console.log("Courses found:", rows.length);
    if (rows.length > 0) {
        console.log("First course desc:", rows[0].desc);
        console.log("First course title:", rows[0].title);
    } else {
        console.log("No courses found.");
    }
});

db.all("PRAGMA table_info(courses)", function (err, rows) {
    if (err) console.error("Error reading schema:", err);
    console.log("Schema Columns:", rows.map(r => r.name).join(', '));
});
