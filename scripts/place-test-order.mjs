import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCGj-c4WU6PwCF9s0Z6k3xT6dbA6yqdKEQ',
  authDomain: 'food-mela-notification.firebaseapp.com',
  projectId: 'food-mela-notification',
  storageBucket: 'food-mela-notification.firebasestorage.app',
  messagingSenderId: '623657462795',
  appId: '1:623657462795:web:26da5491d2c14a671fab0e',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function placeTestOrder() {
  // Sign in as test rider to have auth, then place order as customer
  // Actually, we need to sign in as a customer or admin to create orders
  // Let's sign in as the test rider first to verify, then create order

  // For now, sign in as admin to create order
  await signInWithEmailAndPassword(auth, 'admin@foodmela.com', 'Bisu@1234');
  console.log('✅ Signed in as admin');

  const orderId = `FM-TEST-${Date.now().toString().slice(-6)}`;
  console.log(`📦 Placing test order: ${orderId}`);

  await setDoc(doc(db, 'orders', orderId), {
    orderId: orderId,
    customerName: 'Test Customer',
    customerPhone: '919876543210',
    address: 'Saheed Nagar, Bhubaneswar - Test Order',
    items: [
      { itemId: 'cf1', itemName: 'Chicken Biryani', quantity: 2, price: 220, category: 'cooked_food' },
    ],
    itemsSummary: '2x Chicken Biryani',
    totalAmount: 440,
    specialInstructions: 'Test order for notification verification',
    pincode: '751007',
    locality: 'Saheed Nagar',
    orderCategory: 'cooked_food',
    orderCategoryLabel: 'COOKED FOOD',
    status: 'Order Placed',
    stage: 0,
    riderId: null,
    riderName: null,
    deliveryOtp: '1234',
    createdAt: serverTimestamp(),
    isDeleted: false,
  });

  console.log(`✅ Order placed: ${orderId}`);
  console.log(`   Stage: 0 (pending)`);
  console.log(`   Category: COOKED FOOD`);
  console.log(`   Customer: Test Customer`);
  console.log(`\n📱 Rider (Test Rider FM-TES-0001) should now see this order!`);
  console.log(`   Check Rider app dashboard for new order notification`);
}

placeTestOrder().catch(e => {
  console.error('Failed:', e.code, e.message);
  process.exit(1);
});
