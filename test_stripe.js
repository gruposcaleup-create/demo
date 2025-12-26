require('dotenv').config();
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 10000,
});

async function test() {
    console.log('Testing Stripe Session Create...');
    try {
        const start = Date.now();

        // Simulate the payload from server.js
        const stripeItems = [
            {
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: 'Membresía Anual (Todo Incluido)',
                        images: ['https://placehold.co/600x400?text=VIP'],
                    },
                    unit_amount: 320000,
                },
                quantity: 1,
            }
        ];

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: stripeItems,
            mode: 'payment',
            success_url: 'http://localhost:3000/success',
            cancel_url: 'http://localhost:3000/cancel',
            metadata: {
                orderId: 'test_order_123',
                userId: '3',
                coupon: ''
            },
        });

        console.log('Success! Session URL:', session.url);
        console.log('Took:', Date.now() - start, 'ms');
    } catch (e) {
        console.error('FAILED:', e.message);
    }
}

test();
