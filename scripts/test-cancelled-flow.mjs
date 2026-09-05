import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp, onSnapshot, query, where } from 'firebase/firestore';

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

console.log('=== TEST CANCELLED ORDERS FLOW ===\n');

// Helper to check rider dashboard filtering logic
function isActiveDoc(data, riderId) {
  const stage = data.stage ?? 0;
  const isDeleted = data.isDeleted ?? false;
  const rid = data.riderId;
  return (stage === 1 || stage === 2) && rid === riderId && !isDeleted;
}
function isCancelledForRider(data, riderId) {
  const stage = data.stage ?? 0;
  const status = (data.status ?? '').toLowerCase();
  const rid = data.riderId;
  return (stage === -1 || status.includes('cancel')) && rid === riderId;
}
function isCompletedForRider(data, riderId) {
  const stage = data.stage ?? 0;
  const status = (data.status ?? '').toLowerCase();
  const rid = data.riderId;
  return stage === 3 && rid === riderId && !status.includes('cancel');
}
function isEarned(data, riderId) {
  const stage = data.stage ?? 0;
  const status = (data.status ?? '').toLowerCase();
  const rid = data.riderId;
  const isDeleted = data.isDeleted ?? false;
  return stage === 3 && rid === riderId && !isDeleted && !status.includes('cancel');
}

const testRiderId = 'TEST-RIDER-001';
const orderId1 = `FM-CANCEL-TEST-${Date.now()}`;
const orderId2 = `FM-COMPLETE-TEST-${Date.now() + 1}`;

console.log(`Test rider: ${testRiderId}`);
console.log(`Order 1 (to cancel): ${orderId1}`);
console.log(`Order 2 (to complete): ${orderId2}`);

// Step 1: Create two orders assigned to test rider
console.log('Step 1: Creating 2 orders assigned to test rider...');
await setDoc(doc(db, 'orders', orderId1), {
  orderId: orderId1, customerName: 'Cancel Test Customer', customerPhone: '919999999991',
  address: 'Test Address 1, Bhubaneswar', items: [{ itemId: 'test', quantity: 1 }], itemsSummary: '1x Test',
  totalAmount: 199, status: 'Order Accepted', stage: 1, riderId: testRiderId, riderName: 'Test Rider',
  orderCategory: 'cooked_food', orderCategoryLabel: 'COOKED FOOD',
  createdAt: serverTimestamp(), isDeleted: false,
});
await setDoc(doc(db, 'orders', orderId2), {
  orderId: orderId2, customerName: 'Complete Test Customer', customerPhone: '919999999992',
  address: 'Test Address 2, Bhubaneswar', items: [{ itemId: 'test', quantity: 1 }], itemsSummary: '1x Test',
  totalAmount: 299, status: 'Order Accepted', stage: 1, riderId: testRiderId, riderName: 'Test Rider',
  orderCategory: 'grocery', orderCategoryLabel: 'GROCERY',
  createdAt: serverTimestamp(), isDeleted: false,
});
console.log('✅ 2 orders created with stage=1 (accepted)\n');

await new Promise(r => setTimeout(r, 1500));

// Step 2: Verify Active tab shows both
console.log('Step 2: Check Active tab (should show 2)...');
let snap = await getDocs(collection(db, 'orders'));
let allDocs = snap.docs.map(d => d.data());
let active = allDocs.filter(d => isActiveDoc(d, testRiderId) && (d.orderId === orderId1 || d.orderId === orderId2));
console.log(`Active for ${testRiderId}: ${active.length} (expected 2) ${active.length === 2 ? '✅' : '❌'}`);
active.forEach(d => console.log(`  - ${d.orderId} stage=${d.stage} status="${d.status}"`));

// Step 3: Cancel order 1 (simulate customer cancel)
console.log('\nStep 3: Cancelling order 1 (customer cancel)...');
try {
  await updateDoc(doc(db, 'orders', orderId1), { stage: -1, status: 'Cancelled by Customer', cancelledAt: serverTimestamp() });
  console.log('✅ Cancel update succeeded');
} catch (e) {
  console.log(`❌ Cancel failed: ${e.code} ${e.message}`);
  console.log('Full:', e);
}

await new Promise(r => setTimeout(r, 1500));

// Step 4: Complete order 2
console.log('\nStep 4: Completing order 2 (delivered)...');
try {
  await updateDoc(doc(db, 'orders', orderId2), { stage: 3, status: 'Delivered', deliveredAt: serverTimestamp() });
  console.log('✅ Complete update succeeded');
} catch (e) {
  console.log(`❌ Complete failed: ${e.code} ${e.message}`);
}

await new Promise(r => setTimeout(r, 1500));

// Step 5: Verify all tabs
console.log('\nStep 5: Verify all tabs after cancel + complete...');
snap = await getDocs(collection(db, 'orders'));
allDocs = snap.docs.map(d => d.data());
const testDocs = allDocs.filter(d => d.orderId === orderId1 || d.orderId === orderId2);

console.log('\nAll test orders:');
testDocs.forEach(d => console.log(`  ${d.orderId}: stage=${d.stage}, status="${d.status}", riderId=${d.riderId}`));

const activeAfter = testDocs.filter(d => isActiveDoc(d, testRiderId));
const cancelledAfter = testDocs.filter(d => isCancelledForRider(d, testRiderId));
const completedAfter = testDocs.filter(d => isCompletedForRider(d, testRiderId));
const earnedAfter = testDocs.filter(d => isEarned(d, testRiderId));

console.log(`\nActive: ${activeAfter.length} (expected 0) ${activeAfter.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Cancelled: ${cancelledAfter.length} (expected 1 - ${orderId1}) ${cancelledAfter.length === 1 ? '✅ PASS' : '❌ FAIL'}`);
if (cancelledAfter.length > 0) console.log(`  - ${cancelledAfter[0].orderId}`);
console.log(`Completed: ${completedAfter.length} (expected 1 - ${orderId2}) ${completedAfter.length === 1 ? '✅ PASS' : '❌ FAIL'}`);
if (completedAfter.length > 0) console.log(`  - ${completedAfter[0].orderId}`);
console.log(`Earned: ${earnedAfter.length} (expected 1, cancelled should NOT earn) ${earnedAfter.length === 1 ? '✅ PASS' : '❌ FAIL'}`);

// Check no overlap
const cancelledIds = new Set(cancelledAfter.map(d => d.orderId));
const completedIds = new Set(completedAfter.map(d => d.orderId));
const overlap = [...cancelledIds].filter(id => completedIds.has(id));
console.log(`\nNo overlap between Cancelled & Completed: ${overlap.length === 0 ? '✅ PASS' : '❌ FAIL - overlap: ' + overlap.join(',')}`);

// Step 6: Test real-time — listen then cancel
console.log('\nStep 6: Real-time test — listen for cancellation...');
const orderId3 = `FM-RT-CANCEL-${Date.now()}`;
await setDoc(doc(db, 'orders', orderId3), {
  orderId: orderId3, customerName: 'RT Test', customerPhone: '919999999993',
  address: 'RT Address', items: [{ itemId: 'test', quantity: 1 }], itemsSummary: '1x RT Test',
  totalAmount: 150, status: 'Order Accepted', stage: 1, riderId: testRiderId, riderName: 'Test Rider',
  orderCategory: 'cooked_food', orderCategoryLabel: 'COOKED FOOD',
  createdAt: serverTimestamp(), isDeleted: false,
});
console.log(`Created ${orderId3} with stage=1`);

let realtimeFired = false;
const unsub = onSnapshot(doc(db, 'orders', orderId3), (snap) => {
  if (!snap.exists()) return;
  const data = snap.data();
  const stage = data.stage ?? 0;
  const status = (data.status ?? '').toLowerCase();
  if (stage === -1 || status.includes('cancel')) {
    if (!realtimeFired) {
      realtimeFired = true;
      console.log(`🔔 Real-time: cancellation detected for ${orderId3} stage=${stage} status="${data.status}" ✅ INSTANT`);
    }
  }
});

await new Promise(r => setTimeout(r, 1000));
console.log('Cancelling via update...');
await updateDoc(doc(db, 'orders', orderId3), { stage: -1, status: 'Cancelled by Customer', cancelledAt: serverTimestamp() });
await new Promise(r => setTimeout(r, 3000));
console.log(`Real-time fired: ${realtimeFired ? '✅ PASS' : '❌ FAIL'}`);
unsub();

// Cleanup: mark test orders as deleted (can't actually delete due to rules, so update to isDeleted)
console.log('\nStep 7: Cleanup test orders...');
for (const oid of [orderId1, orderId2, orderId3]) {
  try {
    await updateDoc(doc(db, 'orders', oid), { isDeleted: true });
    console.log(`  ${oid}: marked deleted`);
  } catch (e) {
    console.log(`  ${oid}: cleanup failed ${e.code} (will remain, delete via console)`);
  }
}

console.log('\n=== TEST COMPLETE ===');
console.log(`Active removed: ${activeAfter.length === 0 ? 'PASS' : 'FAIL'}`);
console.log(`Cancelled tab: ${cancelledAfter.length === 1 ? 'PASS' : 'FAIL'}`);
console.log(`Completed tab: ${completedAfter.length === 1 ? 'PASS' : 'FAIL'}`);
console.log(`No overlap: ${overlap.length === 0 ? 'PASS' : 'FAIL'}`);
console.log(`Earnings (cancelled not counted): ${earnedAfter.length === 1 ? 'PASS' : 'FAIL'}`);
console.log(`Real-time: ${realtimeFired ? 'PASS' : 'FAIL'}`);

process.exit(0);
