const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// 1. Create dist folder
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

// 2. Helper to copy files
function copyFile(src, dest) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${src} -> ${dest}`);
}

// 3. Helper to copy directories recursively
function copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            copyFile(srcPath, destPath);
        }
    }
}

// 4. Select files to copy (Frontend ONLY)
// We scan the directory to pick up all HTML, CSS, Images, and client JS.
const files = fs.readdirSync(__dirname);

files.forEach(file => {
    // Skip these (Server & Config)
    if ([
        'node_modules', '.git', '.env', 'dist',
        'server.js', 'database.js', 'package.json', 'package-lock.json', 'vercel.json',
        'build.js', 'test_course_modules.js', 'test_enrollment_logic.js', 'test_verify_endpoint.js',
        'api' // The api folder contains server handlers, we don't serve it statically
    ].includes(file)) return;

    // Copy HTML
    if (file.endsWith('.html')) {
        copyFile(path.join(__dirname, file), path.join(distDir, file));
    }
    // Copy CSS (if any in root)
    else if (file.endsWith('.css')) {
        copyFile(path.join(__dirname, file), path.join(distDir, file));
    }
    // Copy Client JS (api.js, alpine, etc)
    else if (file === 'api.js') {
        copyFile(path.join(__dirname, file), path.join(distDir, file));
    }
    // Copy Images folder
    else if (file === 'images' && fs.lstatSync(path.join(__dirname, file)).isDirectory()) {
        copyDir(path.join(__dirname, file), path.join(distDir, file));
    }
});

console.log("Build complete! 'dist' folder ready.");
