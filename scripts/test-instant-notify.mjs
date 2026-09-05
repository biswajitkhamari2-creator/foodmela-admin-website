import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, serverTimestamp, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCGj-c4WU6PwCF9s0Z6k3xT6dbA6yqdKEQ',
  authDomain: 'food-mela-notification.firebaseapp.com',
  projectId: 'food-mela-notification',
  storageBucket: 'food-mela-notification.firebasestorage.app',
  messagingSenderId: '623657462795',
  appId: '1:623657462795:web:26da5491d2c14a671fab0e',
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Simulate Rider's liveOrdersStream (unfiltered collection snapshot)
console.log('=== TEST: Instant Rider Notification ===');
console.log('Step 1: Attach Rider listener (like Rider Dashboard does)');
let received = false;
let startTime = Date.now();
let orderCreatedAt = 0;

const unsub = onSnapshot(collection(db, 'orders'), (snap) => {
  const elapsed = Date.now() - startTime;
  // Check for our test order
  for (const d of snap.docs) {
    const data = d.data();
    if (data.orderId && data.orderId.startsWith('TEST-INSTANT-')) {
      if (!received) {
        received = true;
        const latency = orderCreatedAt ? Date.now() - orderCreatedAt : elapsed;
        console.log(`\n🔔 RIDER RECEIVED ORDER in ${latency}ms!`);
        console.log(`   orderId: ${data.orderId}`);
        console.log(`   customer: ${data.customerName}`);
        console.log(`   amount: ₹${data.totalAmount}`);
        console.log(`   stage: ${data.stage}, isDeleted: ${data.isDeleted}`);
        console.log(`   category: ${data.orderCategoryLabel}`);
        console.log(`   Latency: ${latency}ms ${latency < 2000 ? '✅ INSTANT' : latency < 5000 ? '⚠️ SLOW' : '❌ TOO SLOW'}`);
      }
    }
  }
}, (err) => {
  console.log('❌ Listener error:', err.code, err.message);
});

// Wait a bit for listener to attach, then create order
await new Promise(r => setTimeout(r, 2000));
console.log('Step 2: Listener attached, creating test order (simulating Customer App)...');

const testOrderId = `TEST-INSTANT-${Date.now()}`;
orderCreatedAt = Date.now();

try {
  await setDoc(doc(db, 'orders', testOrderId), {
    orderId: testOrderId,
    customerName: 'Test Customer',
    customerPhone: '919999999999',
    address: 'Test Address, Bhubaneswar',
    items: [{ itemId: 'test_item', quantity: 1, unit: '1 plate' }],
    itemsSummary: '1x Test Item (1 plate)',
    totalAmount: 199,
    specialInstructions: '',
    pincode: '751001',
    locality: 'Test Locality',
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
  console.log(`✅ Order ${testOrderId} created at ${new Date().toISOString()}`);
  console.log('   Waiting for Rider listener to fire...');

  // Also test Vercel FCM
  console.log('\nStep 3: Testing Vercel FCM push...');
  try {
    const res = await fetch('https://foodmela-notify.vercel.app/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: testOrderId,
        customerName: 'Test Customer',
        totalAmount: 199,
        address: 'Test Address, Bhubaneswar',
        orderCategory: 'COOKED FOOD',
      }),
    });
    const body = await res.text();
    console.log(`   Vercel FCM: ${res.status} ${body.slice(0, 200)}`);
    console.log(`   ${res.status === 200 ? '✅ FCM sent' : '❌ FCM failed'}`);
  } catch (e) {
    console.log(`   Vercel FCM error: ${e.message}`);
  }

  // Wait for listener
  await new Promise(r => setTimeout(r, 5000));

  if (!received) {
    console.log('\n❌ FAIL: Rider listener did NOT receive order within 5s');
    console.log('   This means Firestore rules or stream is broken');
  } else {
    console.log('\n✅ PASS: Instant notification working!');
  }

  // Cleanup: delete test order
  console.log('\nStep 4: Cleaning up test order...');
  try {
    const { deleteDoc } = await import('firebase/firestore');
    // Use update to mark deleted instead (rules block delete)
    const { updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'orders', testOrderId), { isDeleted: true, stage: -1 });
    console.log('✅ Test order cleaned up (marked deleted)');
  } catch (e) {
    console.log('Cleanup note:', e.message);
  }

} catch (e) {
  console.log('❌ Order creation failed:', e.code, e.message);
  console.log('   Full:', e);
}

unsub();
console.log('\n=== TEST COMPLETE ===');
process.exit(0);
