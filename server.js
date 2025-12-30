const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./database');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const Stripe = require('stripe');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        maxNetworkRetries: 2,
        timeout: 10000,
    });
} else {
    console.warn("⚠️ STRIPE_SECRET_KEY missing. Payments will be disabled.");
}

// Mail Transporter
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: 587, // Standard
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD || process.env.MAIL_PASS // Support both just in case
    }
});

const app = express();
const PORT = process.env.PORT || 3000; // Puerto del servidor (Render injects PORT)
const APP_URL = process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:3000'; // Fallback order

app.use(cors());
// app.options removed for Express 5 compatibility (cors middleware handles it)

// Health Check (No DB) - Proves server is running
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'running', env: process.env.NODE_ENV });
});

// Webhook endpoint needs raw body, so we define it BEFORE default parsers
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!stripe) return res.status(503).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const orderId = session.metadata.orderId;
        const userId = session.metadata.userId;
        console.log(`Pago confirmado para orden ${orderId}`);

        // Update order status in DB
        if (orderId) {
            const dbId = orderId.replace('order_', '');

            // 1. Mark Order as Paid
            db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [dbId], (err) => {
                if (err) console.error("Error updating order status", err);
                else {
                    // 2. Retrieve Order Items to Enroll User
                    db.get(`SELECT items FROM orders WHERE id = ?`, [dbId], (err, row) => {
                        if (!err && row && row.items) {
                            try {
                                const items = JSON.parse(row.items);
                                items.forEach(item => {
                                    // Handle 'membership-annual' or specific courses
                                    if (item.id === 'membership-annual') {
                                        console.log(`[Enrollment] User ${userId} bought Annual Membership.`);
                                        // Create/Update Membership
                                        const startDate = new Date().toISOString();
                                        const endDate = new Date();
                                        endDate.setFullYear(endDate.getFullYear() + 1); // +1 Year

                                        db.run(`INSERT INTO memberships (userId, status, startDate, endDate, paymentId) VALUES (?, ?, ?, ?, ?)`,
                                            [userId, 'active', startDate, endDate.toISOString(), dbId],
                                            (errMem) => {
                                                if (errMem) console.error("Error creating membership", errMem);
                                                else console.log("Membership created for user", userId);
                                            }
                                        );
                                    } else {
                                        // Enroll in specific course
                                        const courseId = item.id;
                                        // Check if already enrolled
                                        db.get(`SELECT id FROM enrollments WHERE userId = ? AND courseId = ?`, [userId, courseId], (e, r) => {
                                            if (!r) {
                                                db.run(`INSERT INTO enrollments (userId, courseId, progress, totalHoursSpent) VALUES (?, ?, 0, 0)`,
                                                    [userId, courseId],
                                                    (errEnroll) => {
                                                        if (errEnroll) console.error(`[Enrollment] Failed for user ${userId} course ${courseId}`, errEnroll);
                                                        else console.log(`[Enrollment] Success for user ${userId} course ${courseId}`);
                                                    }
                                                );
                                            }
                                        });
                                    }
                                });
                            } catch (parseErr) {
                                console.error("[Enrollment] Error parsing order items", parseErr);
                            }
                        }
                    });
                }
            });
        }
    }

    res.json({ received: true });
});

app.use(bodyParser.json({ limit: '50mb' })); // Limit alto para uploads base64 si es necesario
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '.')));

// --- RUTAS DE API ---

// 0. HEALTH CHECK (DB Connection)
app.get('/api/db-check', (req, res) => {
    db.get('SELECT 1', [], (err, row) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        res.json({ status: 'ok', database: 'connected' });
    });
});

// 1. Auth: Registro
app.post('/api/auth/register', async (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (email, password, firstName, lastName) VALUES (?, ?, ?, ?)`,
            [email, hash, firstName || '', lastName || ''],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'El email ya está registrado' });
                    return res.status(500).json({ error: err.message });
                }
                res.json({ id: this.lastID, email, firstName, lastName, role: 'user' });
            }
        );
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Auth: Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: 'Credenciales inválidas' });

        if (row.status === 'blocked') return res.status(403).json({ error: 'Tu cuenta ha sido bloqueada. Contacta soporte.' });

        try {
            // Check password (support old plain text for admin seed if needed, but better migrate)
            // If row.password doesn't start with $2b$, it might be legacy plain text (dev mode)
            let match = false;
            // Hack for pre-seeded plain text admin
            if (!row.password.startsWith('$2b$') && row.password === password) {
                match = true;
            } else {
                match = await bcrypt.compare(password, row.password);
            }

            if (!match) return res.status(401).json({ error: 'Credenciales inválidas' });

            // En prod: retornar JWT. Aquí retornamos el user object simple.
            const { password: _, ...userWithoutPass } = row;

            // Check Membership Status
            db.get(`SELECT * FROM memberships WHERE userId = ? AND status = 'active' AND endDate > CURRENT_TIMESTAMP ORDER BY endDate DESC LIMIT 1`, [row.id], (mErr, membership) => {
                if (membership) userWithoutPass.membership = { active: true, endDate: membership.endDate };
                res.json(userWithoutPass);
            });

        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

// Store recovery codes in memory (Map: email -> { code, expires })
const recoveryCodes = new Map();

// 3. Auth: Recuperar Pass (Simulado)
// 3. Auth: Recuperar Pass
app.post('/api/auth/recover', (req, res) => {
    const { email } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.json({ message: 'Si el correo existe, se enviaron instrucciones.' });
        }

        // Generate 6 digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 300000).toISOString(); // 5 mins

        db.run(`INSERT INTO password_resets (email, code, expiresAt) VALUES (?, ?, ?)`, [email, code, expiresAt], (err2) => {
            if (err2) console.error("Error saving reset code", err2);

            // Send Email
            if (process.env.MAIL_USER) {
                try {
                    transporter.sendMail({
                        from: '"Soporte" <' + process.env.MAIL_USER + '>',
                        to: email,
                        subject: 'Recuperación de Contraseña',
                        text: `Tu código de recuperación es: ${code}`,
                        html: `<b>Tu código de recuperación es: ${code}</b><br>Expira en 5 minutos.`
                    }).catch(console.error);
                } catch (e) { console.error("Mail error", e); }
            } else {
                console.log(`[MOCK EMAIL] To: ${email}, Code: ${code}`);
            }

            res.json({ message: 'Si el correo existe, se enviaron instrucciones.' });
        });
    });
});

app.post('/api/auth/reset', async (req, res) => {
    const { email, code, newPassword } = req.body;

    // Check code in DB
    db.get(`SELECT * FROM password_resets WHERE email = ? AND code = ? AND used = 0 AND expiresAt > CURRENT_TIMESTAMP ORDER BY createdAt DESC LIMIT 1`,
        [email, code], async (err, row) => {

            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(400).json({ error: 'Código inválido o expirado' });

            try {
                const hash = await bcrypt.hash(newPassword, 10);

                // Update password & Mark Used
                db.serialize(() => {
                    db.run('UPDATE users SET password = ? WHERE email = ?', [hash, email]);
                    db.run('UPDATE password_resets SET used = 1 WHERE id = ?', [row.id]);
                });

                res.json({ message: 'Contraseña restablecida correctamente.' });

            } catch (e) { res.status(500).json({ error: e.message }); }
        });
});

// Update Password (Authenticated)
app.put('/api/users/password', (req, res) => {
    const { email, currentPassword, newPassword } = req.body;

    // First verify current
    db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, currentPassword], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

        // Update
        db.run('UPDATE users SET password = ? WHERE email = ?', [newPassword, email], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Contraseña actualizada' });
        });
    });
});

// 4. Cursos: Listar (Público)
app.get('/api/courses', (req, res) => {
    db.all(`SELECT * FROM courses WHERE status = 'active'`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Parse modulesData
        const courses = rows.map(c => ({
            ...c,
            modules: c.modulesData ? JSON.parse(c.modulesData) : []
        }));
        res.json(courses);
    });
});

// Admin: Get All Courses (incluido inactivos)
app.get('/api/admin/courses', (req, res) => {
    db.all(`SELECT * FROM courses`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const courses = rows.map(c => ({
            ...c,
            modules: c.modulesData ? JSON.parse(c.modulesData) : []
        }));
        res.json(courses);
    });
});

// Admin: Crear Curso
app.post('/api/courses', (req, res) => {
    const { title, desc, price, priceOffer, image, videoPromo, category, modules } = req.body;
    const modulesStr = JSON.stringify(modules || []);
    const modulesCount = modules ? modules.length : 0;

    db.run(`INSERT INTO courses (title, desc, price, priceOffer, image, videoPromo, category, modulesData, modulesCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, desc, price, priceOffer, image, videoPromo, category, modulesStr, modulesCount],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, ...req.body });
        }
    );
});

// Admin: Editar Curso
app.put('/api/courses/:id', (req, res) => {
    const { id } = req.params;
    const { title, desc, price, priceOffer, image, videoPromo, category, modules, status } = req.body;

    // Construir query dinámico o update masivo
    // Simplificamos actualizando todo lo enviado.
    const modulesStr = modules ? JSON.stringify(modules) : null;
    const modulesCount = modules ? modules.length : null;

    db.run(`UPDATE courses SET 
            title = COALESCE(?, title), 
            desc = COALESCE(?, desc), 
            price = COALESCE(?, price), 
            priceOffer = COALESCE(?, priceOffer), 
            videoPromo = COALESCE(?, videoPromo), 
            category = COALESCE(?, category),
            modulesData = COALESCE(?, modulesData),
            modulesCount = COALESCE(?, modulesCount),
            status = COALESCE(?, status)
            WHERE id = ?`,
        [title, desc, price, priceOffer, videoPromo, category, modulesStr, modulesCount, status, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Curso actualizado' });
        }
    );
});

// Admin: Eliminar Curso
app.delete('/api/courses/:id', (req, res) => {
    db.run(`DELETE FROM courses WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Curso eliminado' });
    });
});


// 5. Categorías (Simulado por ahora extrayendo de cursos o tabla separada. Usaremos tabla separada si da tiempo, sino hardcoded en DB o distinct)
// Vamos a hacer un DISTINCT de la tabla cursos + una tabla auxiliar si se quiere gestionar vacías.
// Por simplicidad en este paso, retornamos DISTINCT categorias de cursos + defaults.
app.get('/api/categories', (req, res) => {
    db.all("SELECT DISTINCT category FROM courses", [], (err, rows) => {
        const cats = rows.map(r => r.category).filter(c => c);
        // Agregar defaults si no están
        const defaults = ['Fiscal', 'Contabilidad', 'Finanzas', 'Legal'];
        const all = [...new Set([...defaults, ...cats])];
        res.json(all);
    });
});
// Para añadir categoria (stub para que el panel no falle)
app.post('/api/categories', (req, res) => { res.json({ success: true }); });
app.delete('/api/categories/:name', (req, res) => { res.json({ success: true }); });


// 6. Ordenes & Stripe Checkout
app.post('/api/checkout/session', async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Pagos deshabilitados por falta de configuración (Stripe Key missing)' });

    try {
        const { items, userId, couponCode } = req.body; // items: [{ id: productId, qty: 1 }]

        if (!items || items.length === 0) return res.status(400).json({ error: 'Carrito vacío' });

        // 1. Validate Coupon
        let discountMultiplier = 1;
        if (couponCode) {
            const coupon = await new Promise((resolve) => {
                db.get("SELECT * FROM coupons WHERE code = ? AND status = 'active'", [couponCode], (err, row) => resolve(row));
            });
            if (coupon) {
                // Apply discount (e.g. 10% -> 0.9 multiplier)
                discountMultiplier = 1 - (coupon.discount / 100);
            }
        }

        // 2. Build Stripe Items
        const promises = items.map(async (item) => {
            let product, price;

            // ... inside map ...
            if (item.id === 'membership-annual') {
                // Get price from settings
                const settings = await new Promise(resolve => {
                    db.all("SELECT * FROM settings", [], (err, rows) => {
                        const s = {}; rows.forEach(r => s[r.key] = r.value);
                        resolve(s);
                    });
                });
                const rawPrice = settings['membership_price_offer'] || settings['membership_price'] || 999;
                price = parseFloat(rawPrice);
                product = { title: 'Membresía Anual (Todo Incluido)', image: 'https://placehold.co/600x400?text=VIP' };
                console.log(`[Checkout] Membership Base Price: ${price} (Raw: ${rawPrice})`);
            } else {
                // Get from DB
                product = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM courses WHERE id = ?", [item.id], (err, row) => {
                        if (err || !row) resolve(null); else resolve(row);
                    });
                });
                if (!product) throw new Error(`Producto ${item.id} no encontrado`);
                price = product.priceOffer || product.price;
            }

            const finalPrice = price * discountMultiplier;
            const unitAmount = Math.round(finalPrice * 100);

            console.log(`[Checkout] Item: ${product.title}, Base: ${price}, DiscountMult: ${discountMultiplier}, Final: ${finalPrice}, UnitAmount: ${unitAmount}`);

            return {
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: product.title + (discountMultiplier < 1 ? ` (Desc. ${couponCode} -${Math.round((1 - discountMultiplier) * 100)}%)` : ''),
                        images: product.image ? [product.image] : [],
                    },
                    unit_amount: unitAmount,
                },
                quantity: item.qty,
            };
        });

        const stripeItems = await Promise.all(promises);

        // Debug Log
        console.log(`[Checkout] Creating session. User: ${userId}, Coupon: ${couponCode || 'None'}`);
        stripeItems.forEach(i => {
            console.log(` - Item: ${i.price_data.product_data.name}, Unit Amount: ${i.price_data.unit_amount}, Qty: ${i.quantity}`);
        });

        const totalAmount = stripeItems.reduce((acc, item) => acc + (item.price_data.unit_amount * item.quantity) / 100, 0);
        console.log('[Checkout] Total calculated:', totalAmount);

        // 3. Create Order in DB
        console.log('[Checkout] Inserting order into DB...');
        const orderId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO orders (userId, total, items, status) VALUES (?, ?, ?, ?)`,
                [userId || 0, totalAmount, JSON.stringify(items), 'pending'],
                function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
        console.log('[Checkout] Order created in DB:', orderId);

        const dbOrderId = `order_${orderId}`;

        // TEST: HARDCODED PAYLOAD to verify if data is the issue
        // SANITIZATION: Clean data to prevent Stripe hang
        const cleanStripeItems = stripeItems.map(item => {
            // Ensure unit amount is an integer
            let amount = parseInt(item.price_data.unit_amount);
            if (isNaN(amount) || amount < 0) amount = 0;

            // Ensure quantity is positive integer
            let qty = parseInt(item.quantity);
            if (isNaN(qty) || qty < 1) qty = 1;

            // Ensure images are valid URLs or empty array
            let images = item.price_data.product_data.images || [];
            if (!Array.isArray(images)) images = [];
            images = images.filter(url => url && typeof url === 'string' && url.startsWith('http'));

            return {
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: String(item.price_data.product_data.name || 'Producto sin nombre').substring(0, 150),
                        images: images
                    },
                    unit_amount: amount,
                },
                quantity: qty,
            };
        });
        console.log('[Checkout] Payload Sanitized. Item Count:', cleanStripeItems.length);

        // Force timeout wrapper - Server Side Protection
        const session = await Promise.race([
            stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: cleanStripeItems,
                mode: 'payment',
                success_url: `${APP_URL}/panel.html?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${APP_URL}/cart.html?canceled=true`,
                metadata: {
                    orderId: dbOrderId,
                    userId: userId ? userId.toString() : 'guest',
                    coupon: couponCode || ''
                },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Stripe API Timeout (12s Server Limit)')), 12000))
        ]);
        console.log('[Checkout] Stripe session URL:', session.url);

        res.json({ url: session.url });
    } catch (err) {
        console.error("Stripe Checkout Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 6.5 Verify Session & Force Enrollment (Fallback)
app.post('/api/checkout/verify-session', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

        // Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        if (session.payment_status === 'paid') {
            const orderId = session.metadata.orderId; // e.g. "order_123"
            const userId = session.metadata.userId;
            const dbId = orderId.replace('order_', '');

            console.log(`[Verify] Verifying order ${dbId} for user ${userId}`);

            // Update Status Forcefully
            db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [dbId], (err) => {
                if (err) console.error("[Verify] Error updating order", err);

                // Enroll Logic (Idempotent)
                db.get(`SELECT items FROM orders WHERE id = ?`, [dbId], (err, row) => {
                    if (!err && row && row.items) {
                        try {
                            const items = JSON.parse(row.items);
                            items.forEach(item => {
                                if (item.id === 'membership-annual') {
                                    // Handle membership
                                } else {
                                    const courseId = item.id;
                                    // Check existence
                                    db.get(`SELECT id FROM enrollments WHERE userId = ? AND courseId = ?`, [userId, courseId], (e, r) => {
                                        if (!r) {
                                            db.run(`INSERT INTO enrollments (userId, courseId, progress, totalHoursSpent) VALUES (?, ?, 0, 0)`,
                                                [userId, courseId],
                                                (errEnroll) => {
                                                    if (errEnroll) console.error("[Verify] Enrollment failed", errEnroll);
                                                    else console.log(`[Verify] Enrolled user ${userId} in course ${courseId}`);
                                                }
                                            );
                                        } else {
                                            console.log(`[Verify] User ${userId} already enrolled in ${courseId}`);
                                        }
                                    });
                                }
                            });
                        } catch (e) {
                            console.error("[Verify] Item parse error", e);
                        }
                    }
                });
            });

            return res.json({ success: true, status: 'paid' });
        } else {
            return res.json({ success: false, status: session.payment_status });
        }
    } catch (err) {
        console.error("Verify Error:", err);
        res.status(500).json({ error: err.message });
    }
});
// Legacy simple order creation kept for non-stripe tests if needed, but endpoint overwrites are tricky.
// Let's modify the old api/orders to be just for admin manual usage or manual confirmation if needed, 
// OR just leave it as is if it doesn't conflict. 
// Actually, let's keep the old endpoint but maybe rename logic or assume frontend calls checkout now.
// For now, I'll add the Stripe logic above and keep the old one below but commented out or renamed if it conflicts.
// The old one was line 152: app.post('/api/orders'...
// I will REPLACE the old order endpoint with one that just creates the order in DB, 
// BUT users now want Stripe. So I will add the checkout endpoint separately.


app.get('/api/orders', (req, res) => {
    db.all(`SELECT * FROM orders ORDER BY createdAt DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })));
    });
});

app.delete('/api/orders/:id', (req, res) => {
    db.run(`DELETE FROM orders WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Orden eliminada' });
    });
});

// 7. Cupones
app.get('/api/coupons', (req, res) => {
    db.all(`SELECT * FROM coupons`, [], (err, rows) => res.json(rows));
});
app.post('/api/coupons', (req, res) => {
    const { code, discount } = req.body;
    db.run(`INSERT INTO coupons (code, discount) VALUES (?, ?)`, [code, discount], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, code, discount });
    });
});
app.delete('/api/coupons/:id', (req, res) => {
    db.run(`DELETE FROM coupons WHERE id = ?`, [req.params.id], (err) => res.json({ success: true }));
});

app.post('/api/coupons/validate', (req, res) => {
    const { code } = req.body;
    db.get("SELECT * FROM coupons WHERE code = ? AND status = 'active'", [code], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ valid: false, message: 'Cupón no válido' });
        res.json({ valid: true, code: row.code, discount: row.discount });
    });
});


// 8. Recursos
app.get('/api/resources', (req, res) => {
    // No devolver dataUrl gigante en lista
    db.all(`SELECT id, name, description, type, url, createdAt FROM resources`, [], (err, rows) => res.json(rows));
});
app.post('/api/resources', (req, res) => {
    const { name, type, dataUrl, description } = req.body;
    db.run(`INSERT INTO resources (name, type, dataUrl, description) VALUES (?, ?, ?, ?)`,
        [name, type, dataUrl, description || ''],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});
// Download Resource
app.get('/api/resources/:id/download', (req, res) => {
    db.get(`SELECT * FROM resources WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Resource not found' });
        res.json(row);
    });
});

app.delete('/api/resources/:id', (req, res) => {
    db.run(`DELETE FROM resources WHERE id = ?`, [req.params.id], (err) => res.json({ success: true }));
});

// Settings API
app.get('/api/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

app.post('/api/settings', (req, res) => {
    const { settings } = req.body; // { key: value, ... }
    if (!settings) return res.status(400).json({ error: 'Settings required' });

    db.serialize(() => {
        const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(key, String(value));
        }
        stmt.finalize();
        res.json({ success: true });
    });
});


// 9. Usuarios (Admin)
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, email, firstName, lastName, role, status, createdAt FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Agregar "spent" dummy o calculado
        // Recorrer ordenes para calcular spent... (buena práctica: JOIN, pero aqui JS)
        db.all(`SELECT userId, total FROM orders`, [], (err2, orders) => {
            const users = rows.map(u => {
                const spent = orders.filter(o => o.userId === u.id).reduce((acc, o) => acc + o.total, 0);
                const userOrders = orders.filter(o => o.userId === u.id);
                // Get course names from orders logic could be complex, skipping for brevity
                return { ...u, spent, courses: [] };
            });
            res.json(users);
        });
    });
});
app.put('/api/users/:email/status', (req, res) => {
    const { status } = req.body;
    db.run(`UPDATE users SET status = ? WHERE email = ?`, [status, req.params.email], (err) => res.json({ success: true }));
});

// 10. Admin: Assign Membership Manually
app.post('/api/admin/users/:userId/membership', (req, res) => {
    const { userId } = req.params;
    // Activate for 1 year
    const startDate = new Date().toISOString();
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1);

    db.run(`INSERT INTO memberships (userId, status, startDate, endDate, paymentId) VALUES (?, ?, ?, ?, ?)`,
        [userId, 'active', startDate, endDate.toISOString(), 'manual_admin'],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Membresía asignada manualmente' });
        }
    );
});

// 10. Dashboard & My Courses
app.get('/api/my-courses', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'UserId required' });

    // Join enrollments with courses
    const query = `
        SELECT e.*, c.title, c.image, c.desc, c.modulesData 
        FROM enrollments e
        JOIN courses c ON e.courseId = c.id
        WHERE e.userId = ?
    `;

    db.all(query, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const courses = rows.map(r => ({
            id: r.courseId,
            name: r.title,
            image: r.image,
            description: r.desc,
            progress: r.progress,
            lastAccess: r.lastAccess,
            modules: r.modulesData ? JSON.parse(r.modulesData) : []
        }));

        res.json({ courses });
    });
});

app.get('/api/dashboard', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'UserId required' });

    // 1. Stats: Completed courses & Total hours (simulated logic for hours if not tracked strictly)
    db.all(`SELECT * FROM enrollments WHERE userId = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const completed = rows.filter(r => r.progress >= 100).length;
        const totalHours = rows.reduce((acc, r) => acc + (r.totalHoursSpent || 0), 0);

        // 2. Last continued course (most recent lastAccess)
        // Sort by lastAccess desc
        const sorted = rows.sort((a, b) => new Date(b.lastAccess) - new Date(a.lastAccess));
        const lastEnrollment = sorted[0];

        let lastCourse = null;
        if (lastEnrollment) {
            db.get(`SELECT title, image FROM courses WHERE id = ?`, [lastEnrollment.courseId], (err2, course) => {
                if (course) {
                    lastCourse = {
                        id: lastEnrollment.courseId,
                        title: course.title,
                        image: course.image,
                        progress: lastEnrollment.progress
                    };
                }
                res.json({
                    stats: { completed, totalHours },
                    lastCourse
                });
            });
        } else {
            res.json({
                stats: { completed, totalHours },
                lastCourse: null
            });
        }
    });
});

app.post('/api/progress', (req, res) => {
    const { userId, courseId, progress, hoursToAdd } = req.body;

    // Update progress
    // If progress is provided, update it (if greater than current? optional logic, stick to overwrite for now or max)
    // Update lastAccess = NOW
    // Add hoursToAdd

    let sql = `UPDATE enrollments SET lastAccess = CURRENT_TIMESTAMP`;
    const params = [];

    if (progress !== undefined) {
        sql += `, progress = ?`;
        params.push(progress);
    }

    if (hoursToAdd) {
        sql += `, totalHoursSpent = totalHoursSpent + ?`;
        params.push(hoursToAdd);
    }

    sql += ` WHERE userId = ? AND courseId = ?`;
    params.push(userId, courseId);

    db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// Start

// Global Error Handlers (Prevent Crash in Prod)
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL ERROR (Unhandled Rejection):', reason);
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`App URL: ${APP_URL}`);
    });
}

module.exports = app;
