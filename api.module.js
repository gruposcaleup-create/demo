// Wrapper for ES Module compatibility
import './api.js';

const API = window.API;
export const apiRegister = API.apiRegister;
export const apiLogin = API.apiLogin;
export const apiLogout = API.apiLogout;
export const isLoggedIn = API.isLoggedIn;
export const apiGetProfile = API.apiGetProfile;
export const apiGetProducts = API.apiGetProducts;
export const apiGetProduct = API.apiGetProduct;
export const apiGetCart = API.apiGetCart;
export const apiAddToCart = API.apiAddToCart;
export const apiRemoveFromCart = API.apiRemoveFromCart;
export const apiUpdateCartItem = API.apiUpdateCartItem;
export const apiCreateOrder = API.apiCreateOrder;
export const apiGetAllCourses = API.apiGetAllCourses;
export const apiCreateCourse = API.apiCreateCourse;
export const apiUpdateCourse = API.apiUpdateCourse;
export const apiDeleteCourse = API.apiDeleteCourse;
export const apiGetCategories = API.apiGetCategories;
export const apiAddCategory = API.apiAddCategory;
export const apiDeleteCategory = API.apiDeleteCategory;
export const apiGetCoupons = API.apiGetCoupons;
export const apiCreateCoupon = API.apiCreateCoupon;
export const apiDeleteCoupon = API.apiDeleteCoupon;
export const apiGetResources = API.apiGetResources;
export const apiCreateResource = API.apiCreateResource;
export const apiDeleteResource = API.apiDeleteResource;
export const apiGetMembers = API.apiGetMembers;
export const apiGetAllUsers = API.apiGetAllUsers;
export const apiUpdateMemberStatus = API.apiUpdateMemberStatus;
export const apiGetOrders = API.apiGetOrders;

// Dashboard & Stripe
export const apiGetMyPurchasedCourses = API.apiGetMyPurchasedCourses;
export const apiGetDashboardStats = API.apiGetDashboardStats;
export const apiUpdateProgress = API.apiUpdateProgress;
export const apiCreateCheckoutSession = API.apiCreateCheckoutSession;

export default API;
