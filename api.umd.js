(function(){
  // Small UMD wrapper that imports module and exposes it to window.API
  function load() {
    if (window.API) return Promise.resolve(window.API);
    return import('./api.module.js').then(mod => {
      // Use the module's default export if provided (contains full API), otherwise fallback to named exports
      const API = mod.default ? mod.default : {
        apiGetProducts: mod.apiGetProducts,
        apiGetProduct: mod.apiGetProduct,
        apiRegister: mod.apiRegister,
        apiLogin: mod.apiLogin,
        apiLogout: mod.apiLogout,
        isLoggedIn: mod.isLoggedIn,
        apiGetCart: mod.apiGetCart,
        apiAddToCart: mod.apiAddToCart,
        apiUpdateCartItem: mod.apiUpdateCartItem,
        apiRemoveFromCart: mod.apiRemoveFromCart,
        apiCreateOrder: mod.apiCreateOrder,
        apiGetProfile: mod.apiGetProfile,
        apiUpdateProfile: mod.apiUpdateProfile,
        apiGetOrders: mod.apiGetOrders
      };
      window.API = API;
      // Also expose individual named functions for compatibility with old pages
      Object.keys(API).forEach(k => { if (!window[k]) window[k] = API[k]; });
      return API;
    }).catch(err => {
      console.error('No se pudo cargar api.module.js (module). Si tu navegador bloquea módulos para archivos locales (file://), abre con un servidor HTTP)');
      return Promise.reject(err);
    });
  }
  // Expose as async function
  window.__loadAPI = load;
  // Load automatically
  load().catch(()=>{});
})();
