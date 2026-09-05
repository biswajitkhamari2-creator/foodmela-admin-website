import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

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

console.log('=== REPRODUCING ORDER PLACEMENT BUG ===\n');

// Simulate exact payload from cart_screen.dart Confirm & Pay
async function testOrderCreation(testName, address, customerPhone) {
  console.log(`--- ${testName} ---`);
  console.log(`Address: "${address}"`);
  console.log(`Phone: "${customerPhone}"`);

  const now = Date.now();
  const orderId = `FM-TEST-${now.toString().substring(5)}`;
  const itemsList = [
    { itemId: 'biryani_001', name: 'Chicken Biryani', category: 'cooked_food', unit: '1 plate', quantity: 1, price: 199, totalPrice: 199 },
    { itemId: 'tomato_001', name: 'Fresh Tomato', category: 'vegetables', unit: '1 kg', quantity: 2, price: 40, totalPrice: 80 },
  ];
  const totalAmount = 279;
  const customerName = 'Test Customer';

  // Derive pincode/locality exactly as cart_screen does
  let pincode = '';
  let locality = '';
  const pinMatch = /PIN:\s*(\d{6})/.exec(address);
  if (pinMatch) { pincode = pinMatch[1] ?? ''; } else { const m = /\b\d{6}\b/.exec(address); if (m) pincode = m[0] ?? ''; }
  const cleanAddress = address.replaceAll('📍', '').trim();
  const lines = cleanAddress.split('\n');
  if (lines.length > 0) locality = lines[0].split(',')[0].trim();

  console.log(`Derived pincode: "${pincode}", locality: "${locality}"`);

  const payload = {
    orderId: orderId,
    customerName: customerName,
    customerPhone: customerPhone,
    address: address,
    items: itemsList,
    itemsSummary: '1x Chicken Biryani (1 plate), 2x Fresh Tomato (1 kg)',
    totalAmount: totalAmount,
    specialInstructions: '',
    pincode: pincode,
    locality: locality,
    orderCategory: 'cooked_food',
    orderCategoryLabel: 'COOKED FOOD',
    status: 'Order Placed',
    stage: 0,
    riderId: null,
    riderName: null,
    deliveryOtp: '1234',
    createdAt: serverTimestamp(),
    isDeleted: false,
  };

  console.log(`Payload keys: ${Object.keys(payload).join(', ')}`);
  console.log(`Required keys check: orderId=${!!payload.orderId}, customerName=${!!payload.customerName}, customerPhone=${!!payload.customerPhone}, address=${!!payload.address}, items=${!!payload.items}, totalAmount=${!!payload.totalAmount}`);

  try {
    await setDoc(doc(db, 'orders', orderId), payload);
    console.log(`✅ CREATE SUCCESS: ${orderId}`);

    // Verify read
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (snap.exists()) {
      const data = snap.data();
      console.log(`✅ READ SUCCESS: stage=${data.stage}, address="${data.address.substring(0,50)}", phone="${data.customerPhone}"`);
    } else {
      console.log(`❌ READ FAILED: doc not found after create`);
    }

    // Cleanup - mark deleted (can't delete due to rules)
    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'orders', orderId), { isDeleted: true, stage: -1 });
      console.log(`✅ Cleanup: marked deleted`);
    } catch (e) {
      console.log(`Cleanup note: ${e.code} ${e.message}`);
    }

    return true;
  } catch (e) {
    console.log(`❌ CREATE FAILED: ${e.code} - ${e.message}`);
    console.log(`Full error:`, e);
    return false;
  }
}

console.log('TEST A — MAP LOCATION');
console.log('Simulating: Customer picks location on MAP → setAddress("Flat 302, Building 4B, Saheed Nagar, Janpath Road, Bhubaneswar (Near Master Canteen)")');
const mapAddress = 'Flat 302, Building 4B, Saheed Nagar, Janpath Road, Bhubaneswar (Near Master Canteen)';
const resultA = await testOrderCreation('TEST A — MAP', mapAddress, '919999999999');

console.log('\nTEST B — MANUAL ADDRESS');
console.log('Simulating: Customer adds manual address → "Flat 101, MG Road, Patia, Bhubaneswar, 751024"');
const manualAddress = 'Flat 101, MG Road, Patia, Bhubaneswar, 751024';
const resultB = await testOrderCreation('TEST B — MANUAL', manualAddress, '919999999999');

console.log('\nTEST C — PLACEHOLDER (should fail validation but currently passes)');
const placeholder = '📍 Select Delivery Location...';
const resultC = await testOrderCreation('TEST C — PLACEHOLDER', placeholder, '919999999999');

console.log('\nTEST D — EMPTY PHONE (guest user)');
const resultD = await testOrderCreation('TEST D — EMPTY PHONE', mapAddress, '');

console.log('\n=== RESULTS ===');
console.log(`TEST A (MAP): ${resultA ? '✅ PASS' : '❌ FAIL'}`);
console.log(`TEST B (MANUAL): ${resultB ? '✅ PASS' : '❌ FAIL'}`);
console.log(`TEST C (PLACEHOLDER): ${resultC ? '⚠️ PASSES (no validation)' : '❌ FAIL'}`);
console.log(`TEST D (EMPTY PHONE): ${resultD ? '✅ PASS (empty phone allowed)' : '❌ FAIL'}`);

console.log('\n=== CHECKING EXISTING ORDERS ===');
try {
  const snap = await getDocs(collection(db, 'orders'));
  console.log(`Total orders in DB: ${snap.size}`);
  let count = 0;
  for (const d of snap.docs) {
    if (count++ >= 3) break;
    const data = d.data();
    console.log(`  ${d.id}: stage=${data.stage}, customer="${data.customerName}", address="${(data.address||'').substring(0,40)}"`);
  }
} catch (e) {
  console.log(`Failed to list orders: ${e.code} ${e.message}`);
}

process.exit(0);
