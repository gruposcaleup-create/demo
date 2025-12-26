// ============================================================
// TESTING SCRIPT - Copia y pega en la consola del navegador
// ============================================================

// 1. REGISTRAR USUARIO
async function testRegister() {
    try {
        const result = await apiRegister('testuser@julg.com', 'test1234', 'Test', 'User');
        console.log('✅ Registro exitoso:', result);
        return result;
    } catch (err) {
        console.error('❌ Error en registro:', err.message);
    }
}

// 2. LOGIN
async function testLogin() {
    try {
        const user = await apiLogin('test@julg.com', 'test123');
        console.log('✅ Login exitoso:', user);
        return user;
    } catch (err) {
        console.error('❌ Error en login:', err.message);
    }
}

// 3. OBTENER PRODUCTOS
async function testGetProducts() {
    try {
        const products = await apiGetProducts();
        console.log('✅ Productos obtenidos:', products);
        return products;
    } catch (err) {
        console.error('❌ Error obteniendo productos:', err.message);
    }
}

// 4. AGREGAR AL CARRITO
async function testAddToCart() {
    try {
        // Primero obtener productos
        const products = await apiGetProducts();
        if (products.length === 0) {
            console.error('❌ No hay productos disponibles');
            return;
        }
        const productId = products[0].id;
        const result = await apiAddToCart(productId, 2);
        console.log('✅ Producto agregado al carrito:', result);
        return result;
    } catch (err) {
        console.error('❌ Error agregando al carrito:', err.message);
    }
}

// 5. OBTENER CARRITO
async function testGetCart() {
    try {
        const cart = await apiGetCart();
        console.log('✅ Carrito obtenido:', cart);
        console.log(`   Subtotal: $${cart.subtotal.toFixed(2)}`);
        console.log(`   IVA (21%): $${cart.tax.toFixed(2)}`);
        console.log(`   Envío: $${cart.shipping.toFixed(2)}`);
        console.log(`   Descuento: -$${cart.discount.toFixed(2)}`);
        console.log(`   TOTAL: $${cart.total.toFixed(2)}`);
        return cart;
    } catch (err) {
        console.error('❌ Error obteniendo carrito:', err.message);
    }
}

// 6. APLICAR CUPÓN
async function testApplyCoupon() {
    try {
        const result = await apiApplyCoupon('WELCOME10');
        console.log('✅ Cupón aplicado:', result);
        // Luego obtener carrito para ver descuento
        await testGetCart();
        return result;
    } catch (err) {
        console.error('❌ Error aplicando cupón:', err.message);
    }
}

// 7. CREAR ORDEN
async function testCreateOrder() {
    try {
        const result = await apiCreateOrder({
            address: 'Calle Falsa 123',
            city: 'Buenos Aires',
            postalCode: '1425'
        });
        console.log('✅ Orden creada:', result);
        return result;
    } catch (err) {
        console.error('❌ Error creando orden:', err.message);
    }
}

// 8. VER ÓRDENES
async function testGetOrders() {
    try {
        const orders = await apiGetOrders();
        console.log('✅ Órdenes obtenidas:', orders);
        orders.forEach(order => {
            console.log(`   - ${order.id}: $${order.total.toFixed(2)} (${order.items.length} items)`);
        });
        return orders;
    } catch (err) {
        console.error('❌ Error obteniendo órdenes:', err.message);
    }
}

// 9. OBTENER PERFIL
async function testGetProfile() {
    try {
        const profile = await apiGetProfile();
        console.log('✅ Perfil obtenido:', profile);
        return profile;
    } catch (err) {
        console.error('❌ Error obteniendo perfil:', err.message);
    }
}

// 10. OBTENER ESTADÍSTICAS (ADMIN)
async function testGetStats() {
    try {
        const stats = await apiGetDashboardStats();
        console.log('✅ Estadísticas obtenidas:', stats);
        console.log(`   Ingresos totales: $${stats.totalRevenue.toFixed(2)}`);
        console.log(`   Total de órdenes: ${stats.totalOrders}`);
        console.log(`   Total de miembros: ${stats.totalMembers}`);
        console.log(`   Total de productos: ${stats.totalProducts}`);
        return stats;
    } catch (err) {
        console.error('❌ Error obteniendo estadísticas:', err.message);
    }
}

// 11. FLUJO COMPLETO DE COMPRA
async function testCompleteFlow() {
    console.log('🚀 Iniciando flujo completo de compra...\n');
    
    // Step 1: Login
    console.log('1️⃣ Iniciando sesión...');
    const user = await testLogin();
    if (!user) return;
    
    // Step 2: Ver productos
    console.log('\n2️⃣ Obteniendo productos...');
    const products = await testGetProducts();
    if (!products || products.length === 0) return;
    
    // Step 3: Agregar al carrito
    console.log('\n3️⃣ Agregando producto al carrito...');
    await testAddToCart();
    
    // Step 4: Ver carrito
    console.log('\n4️⃣ Viendo carrito...');
    await testGetCart();
    
    // Step 5: Aplicar cupón
    console.log('\n5️⃣ Aplicando cupón WELCOME10...');
    await testApplyCoupon();
    
    // Step 6: Crear orden
    console.log('\n6️⃣ Creando orden...');
    const order = await testCreateOrder();
    
    // Step 7: Ver órdenes
    console.log('\n7️⃣ Viendo historial de órdenes...');
    await testGetOrders();
    
    // Step 8: Ver estadísticas (si es admin)
    console.log('\n8️⃣ Viendo estadísticas (requiere admin)...');
    await testGetStats();
    
    console.log('\n✅ ¡Flujo completo finalizado!');
}

// ============================================================
// COMANDOS PARA USAR
// ============================================================

console.log(`
╔════════════════════════════════════════════════════════════╗
║           TESTING API BACKEND - JULG STORE                ║
╚════════════════════════════════════════════════════════════╝

COMANDOS DISPONIBLES:

📝 AUTENTICACIÓN:
  - testRegister()          : Registrar nuevo usuario
  - testLogin()             : Iniciar sesión
  - isLoggedIn()            : Verificar sesión actual

🛒 CARRITO Y COMPRAS:
  - testGetProducts()       : Obtener lista de cursos
  - testAddToCart()         : Agregar producto al carrito
  - testGetCart()           : Ver carrito con cálculos
  - testApplyCoupon()       : Aplicar cupón WELCOME10
  - testCreateOrder()       : Crear orden/hacer compra
  - testGetOrders()         : Ver historial de órdenes

👤 PERFIL:
  - testGetProfile()        : Obtener datos del usuario

📊 ADMIN:
  - testGetStats()          : Ver estadísticas del dashboard

🎯 FLUJOS COMPLETOS:
  - testCompleteFlow()      : Test de compra completo

USUARIOS DE PRUEBA:
  - admin@julg.com / admin
  - test@julg.com / test123

CUPÓN DE PRUEBA:
  - WELCOME10 (10% descuento)
`);
