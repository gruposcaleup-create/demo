// API client connecting to Node.js backend
if (typeof window !== 'undefined') {
  (function () {
    // Use relative URL for production compatibility (Vercel)
    // If running via file:// or different port, this needs adjustment, but for Vercel/Same-Origin it's perfect.
    const BASE_URL = '/api';

    // Helper for requests
    async function request(endpoint, options = {}) {
      options.headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      options.signal = controller.signal;

      try {
        const res = await fetch(`${BASE_URL}${endpoint}`, options);
        clearTimeout(timeoutId);
        let data;
        try {
          data = await res.json();
        } catch (e) {
          // If response is not JSON (e.g. 404 HTML from old server), throw readable error
          throw new Error(`Error del servidor (${res.status}): ${res.statusText}`);
        }

        if (!res.ok) {
          throw new Error(data.error || 'API Error');
        }
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado. Reintenta.');
        throw err;
      }
    }

    // --- Auth ---
    async function apiRegister(email, password, firstName, lastName) {
      const user = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, firstName, lastName })
      });
      _setCurrentUser(user);
      return user;
    }

    async function apiLogin(email, password) {
      const user = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      _setCurrentUser(user);
      return user;
    }

    async function apiRecoverPassword(email) {
      return request('/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
    }

    async function apiResetPassword(email, code, newPassword) {
      return request('/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email, code, newPassword })
      });
    }

    async function apiUpdatePassword(currentPassword, newPassword) {
      const user = _currentUser();
      if (!user) throw new Error('Usuario no autenticado');
      return request('/users/password', {
        method: 'PUT',
        body: JSON.stringify({ email: user.email, currentPassword, newPassword })
      });
    }

    function apiLogout() {
      localStorage.removeItem('currentUser');
      window.location.href = 'index.html';
    }

    function isLoggedIn() {
      return !!_currentUser();
    }

    function _currentUser() {
      return JSON.parse(localStorage.getItem('currentUser'));
    }

    function _setCurrentUser(u) {
      localStorage.setItem('currentUser', JSON.stringify(u));
    }

    async function apiGetCourses() {
      return request('/courses');
    }

    async function apiGetSettings() {
      return _currentUser();
    }

    async function apiGetProfile() {
      return _currentUser();
    }

    // --- Products/Courses ---
    async function apiGetProducts() {
      const courses = await request('/courses');
      return courses.map(c => ({ ...c, name: c.title }));
    }

    async function apiGetProduct(id) {
      const products = await apiGetProducts();
      return products.find(p => p.id == id);
    }

    // --- Cart (Local for now, or could be server) ---
    // To keep it simple and fast as requested ("ya mismo"), we keep cart in localStorage
    // for guest/user, but ideally should be on server. The plan said "cart management" on server
    // but let's stick to local cart for speed unless user explicitly asked for server cart persistence.
    // Actually, user said "que ande". Server cart is better but more complex to sync.
    // Let's keep local cart but Order creation goes to server.

    async function apiGetCart() {
      let raw;
      try {
        raw = JSON.parse(localStorage.getItem('cart') || '{"items":[]}');
      } catch (e) {
        raw = { items: [] };
      }

      // Ensure raw.items exists
      if (!raw.items || !Array.isArray(raw.items)) {
        raw = { items: [] };
      }

      // CLEANUP: Filter out invalid items (null, no productId)
      const originalCount = raw.items.length;
      raw.items = raw.items.filter(i => i && i.productId);
      if (raw.items.length !== originalCount) {
        console.warn('[API] Cart contained invalid items, cleaned up.');
        localStorage.setItem('cart', JSON.stringify(raw));
      }

      // Refresh Membership Price from Server
      const membershipItem = raw.items.find(i => i.productId === 'membership-annual');
      if (membershipItem) {
        try {
          // Check if we can fetch settings
          const settings = await request('/settings');
          const newPrice = settings.membership_price_offer || settings.membership_price || 999;
          // If price changed, update it
          if (parseFloat(membershipItem.price) !== parseFloat(newPrice)) {
            console.log(`Updating membership price in cart: ${membershipItem.price} -> ${newPrice}`);
            membershipItem.price = newPrice;
            localStorage.setItem('cart', JSON.stringify(raw));
          }
        } catch (e) {
          console.warn("Could not refresh membership price:", e);
        }
      }

      // Transform flat items into nested structure expected by frontend
      const items = raw.items.map(i => ({
        id: i.productId,
        quantity: i.quantity || 1,
        product: {
          id: i.productId,
          name: i.name || 'Curso (' + i.productId + ')',
          price: i.price || 0,
          image: i.image || 'https://placehold.co/600x400',
          description: i.description || ''
        }
      }));

      const subtotal = items.reduce((acc, i) => acc + (parseFloat(i.product.price) * i.quantity), 0);
      const total = subtotal;

      return { items, subtotal, total, discountAmount: 0 };
    }

    async function apiAddToCart(productId, qty = 1) {
      // Get raw cart first to modify
      let raw;
      try { raw = JSON.parse(localStorage.getItem('cart') || '{"items":[]}'); }
      catch (e) { raw = { items: [] }; }
      if (!raw.items) raw.items = [];

      // Special handling for Annual Membership
      if (productId === 'membership-annual') {
        const existing = raw.items.find(i => i.productId === 'membership-annual');
        if (existing) {
          return await apiGetCart();
        }

        try {
          const settings = await apiGetSettings();
          const price = settings.membership_price_offer || settings.membership_price || 999;

          raw.items.push({
            productId: 'membership-annual',
            quantity: 1,
            name: 'Membresía Anual (Todo Incluido)',
            price: price,
            image: 'https://placehold.co/600x400?text=VIP',
            description: 'Acceso ilimitado a todos los cursos por 1 año'
          });
          localStorage.setItem('cart', JSON.stringify(raw));
          return await apiGetCart();
        } catch (e) {
          console.error("Error adding membership", e);
          throw e;
        }
      }


      const existingIndex = raw.items.findIndex(i => i.productId == productId);
      if (existingIndex > -1) {
        raw.items[existingIndex].quantity += qty;
      } else {
        const product = await apiGetProduct(productId);
        if (product) {
          // Log product to verify we got it
          console.log('[API] Adding Product:', product);
          raw.items.push({
            productId: product.id,
            quantity: qty,
            name: product.name || product.title || 'Curso sin nombre',
            price: product.priceOffer || product.price,
            image: product.image,
            description: product.desc || product.description || ''
          });
        } else {
          console.warn('[API] Product not found for ID:', productId);
          throw new Error('Producto no encontrado en el servidor');
        }
      }
      localStorage.setItem('cart', JSON.stringify(raw));
      return await apiGetCart();
    }

    async function apiRemoveFromCart(productId) {
      const raw = JSON.parse(localStorage.getItem('cart') || '{"items":[]}');
      if (raw.items) {
        raw.items = raw.items.filter(i => i.productId != productId);
        localStorage.setItem('cart', JSON.stringify(raw));
      }
      return await apiGetCart();
    }

    async function apiUpdateCartItem(productId, qty) {
      const raw = JSON.parse(localStorage.getItem('cart') || '{"items":[]}');
      if (raw.items) {
        const item = raw.items.find(i => i.productId == productId);
        if (item) {
          item.quantity = parseInt(qty);
          localStorage.setItem('cart', JSON.stringify(raw));
        }
      }
      return await apiGetCart();
    }

    // --- Orders ---
    async function apiCreateOrder() {
      const cart = await apiGetCart();
      if (cart.items.length === 0) throw new Error("Carrito vacío");

      const user = _currentUser();
      if (!user) throw new Error("Debes iniciar sesión");

      // Recalculate total just to be safe, though apiGetCart has it
      const total = cart.items.reduce((acc, i) => acc + (i.product.price * i.quantity), 0);

      const order = await request('/orders', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          items: cart.items,
          total: total
        })
      });

      // Clear cart
      localStorage.setItem('cart', '{"items":[]}');
      return order;
    }

    // --- Admin ---
    async function apiGetAllCourses() {
      return await request('/admin/courses');
    }
    async function apiCreateCourse(data) {
      return await request('/courses', { method: 'POST', body: JSON.stringify(data) });
    }
    async function apiUpdateCourse(id, data) {
      return await request(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    }
    async function apiDeleteCourse(id) {
      return await request(`/courses/${id}`, { method: 'DELETE' });
    }

    async function apiGetCategories() { return await request('/categories'); }
    async function apiAddCategory(name) { return await request('/categories', { method: 'POST', body: JSON.stringify({ name }) }); }
    async function apiDeleteCategory(name) { return await request(`/categories/${name}`, { method: 'DELETE' }); }

    async function apiGetCoupons() { return await request('/coupons'); }
    async function apiCreateCoupon(data) { return await request('/coupons', { method: 'POST', body: JSON.stringify(data) }); }
    async function apiDeleteCoupon(id) { return await request(`/coupons/${id}`, { method: 'DELETE' }); }
    async function apiValidateCoupon(code) { return await request('/coupons/validate', { method: 'POST', body: JSON.stringify({ code }) }); }

    async function apiGetResources() { return await request('/resources'); }
    async function apiCreateResource(data) { return await request('/resources', { method: 'POST', body: JSON.stringify(data) }); }
    async function apiDeleteResource(id) { return await request(`/resources/${id}`, { method: 'DELETE' }); }

    async function apiGetMembers() { return await request('/users'); }
    async function apiGetAllUsers() { return await request('/users'); } // Alias
    async function apiUpdateMemberStatus(email, status) {
      return await request(`/users/${email}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    }
    async function apiGetOrders() { return await request('/orders'); }
    async function apiDeleteOrder(id) { return await request(`/orders/${id}`, { method: 'DELETE' }); }

    // --- Dashboard ---
    async function apiGetMyPurchasedCourses() {
      const user = _currentUser();
      if (!user) return { courses: [] };
      return await request(`/my-courses?userId=${user.id}`);
    }

    async function apiCreateCheckoutSession(items, couponCode) {
      const user = _currentUser();
      const userId = user ? user.id : null;

      // Items are passed from cart.html which now uses correct structure from apiGetCart
      // couponCode is passed from cart.html
      return await request('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({ items, userId, couponCode })
      });
    }

    async function apiGetDashboardStats() {
      const user = _currentUser();
      if (!user) return { stats: { completed: 0, totalHours: 0 }, lastCourse: null };
      return await request(`/dashboard?userId=${user.id}`);
    }

    async function apiUpdateProgress(courseId, progress, hoursToAdd) {
      const user = _currentUser();
      if (!user) return;
      return await request('/progress', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, courseId, progress, hoursToAdd })
      });
    }

    // Expose
    window.API = {
      apiRegister,
      apiLogin,
      apiLogout,
      apiRecoverPassword,
      apiResetPassword,
      apiUpdatePassword,
      isLoggedIn,
      apiGetProfile,
      apiGetProducts,
      apiGetProduct,
      apiGetCart,
      apiAddToCart,
      apiRemoveFromCart,
      apiUpdateCartItem,
      apiCreateOrder,

      // Admin
      apiGetAllCourses,
      apiCreateCourse,
      apiUpdateCourse,
      apiDeleteCourse,
      apiGetCategories,
      apiAddCategory,
      apiDeleteCategory,
      apiGetCoupons,
      apiCreateCoupon,
      apiDeleteCoupon,
      apiValidateCoupon,
      apiGetResources,
      apiCreateResource,
      apiDeleteResource,
      apiGetMembers,
      apiGetAllUsers,
      apiUpdateMemberStatus,
      apiUpdateUserStatus: apiUpdateMemberStatus, // Alias for component compatibility
      apiGetCourses: apiGetCourses,
      apiGetOrders,
      apiDeleteOrder,
      apiGetSettings: async function () { return await request('/settings'); },
      apiSaveSettings: async function (settings) { return await request('/settings', { method: 'POST', body: JSON.stringify({ settings }) }); },

      // Dashboard
      apiGetMyPurchasedCourses,
      apiGetDashboardStats,
      apiUpdateProgress,
      apiCreateCheckoutSession,
      apiAssignMembership: async function (userId) {
        return await request(`/admin/users/${userId}/membership`, { method: 'POST' });
      }
    };
  })();
} else {
  // Node.js Execution - Server Side
  // Import the Express app from server.js
  const app = require('./server');
  const PORT = process.env.PORT || 3000;

  // Start Server
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Render Service Ready`);
  });
}
