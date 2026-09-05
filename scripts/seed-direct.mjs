import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

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

// ── Use Firestore REST API with API key (no auth needed for writes if rules allow, otherwise use admin) ──
// We'll try direct writes — if rules block, we'll show what to do

async function seed() {
  console.log('📦 Seeding real data via Firestore...\n');

  const now = new Date();

  // ── Customers ──────────────────────────────────────────────────────────
  const customers = [
    { phone: '919876543210', name: 'Rahul Sharma', email: 'rahul.sharma@gmail.com' },
    { phone: '919876543211', name: 'Priya Patel', email: 'priya.patel@gmail.com' },
    { phone: '919876543212', name: 'Amit Kumar', email: 'amit.kumar@gmail.com' },
    { phone: '919876543213', name: 'Sneha Singh', email: 'sneha.singh@gmail.com' },
    { phone: '919876543214', name: 'Vikash Yadav', email: 'vikash.yadav@gmail.com' },
  ];

  for (const c of customers) {
    try {
      await setDoc(doc(db, 'users', c.phone), {
        name: c.name, email: c.email, phone: c.phone,
        role: 'customer', accountStatus: 'active', approvalStatus: 'approved',
        createdAt: Timestamp.fromDate(new Date(now.getTime() - Math.random() * 86400000 * 7)),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      console.log(`  ✅ Customer: ${c.name} (${c.phone})`);
    } catch (e) {
      console.log(`  ❌ Customer ${c.name}: ${e.code} — ${e.message}`);
    }
  }

  // ── Delivery Partners ──────────────────────────────────────────────────
  const partners = [
    { phone: '919999888801', name: 'Ramesh Delivery', email: 'ramesh@foodmela.com', status: 'approved', partnerId: 'FM-RAM-4827' },
    { phone: '919999888802', name: 'Suresh Kumar', email: 'suresh@foodmela.com', status: 'approved', partnerId: 'FM-SUR-9134' },
    { phone: '919999888803', name: 'Foodmail Express', email: 'foodmail@foodmela.com', status: 'pending', partnerId: null },
    { phone: '919999888804', name: 'Rajesh Rider', email: 'rajesh@foodmela.com', status: 'approved', partnerId: 'FM-RAJ-2056' },
  ];

  for (const p of partners) {
    try {
      const data = {
        name: p.name, email: p.email, phone: p.phone,
        role: 'delivery_partner', accountStatus: 'active', approvalStatus: p.status,
        createdAt: Timestamp.fromDate(new Date(now.getTime() - Math.random() * 86400000 * 3)),
        updatedAt: serverTimestamp(),
      };
      if (p.partnerId) data.partnerId = p.partnerId;
      await setDoc(doc(db, 'users', p.phone), data, { merge: true });
      console.log(`  ✅ Partner: ${p.name} (${p.partnerId ?? 'PENDING'})`);
    } catch (e) {
      console.log(`  ❌ Partner ${p.name}: ${e.code} — ${e.message}`);
    }
  }

  // ── Orders ─────────────────────────────────────────────────────────────
  const orders = [
    {
      orderId: `FM-${Date.now().toString().slice(-6)}1`,
      customerName: 'Rahul Sharma', customerPhone: '919876543210',
      address: 'Flat 302, Saheed Nagar, Bhubaneswar', totalAmount: 450,
      stage: 0, status: 'Order Placed', orderCategory: 'cooked_food', orderCategoryLabel: 'COOKED FOOD',
      items: [{ itemId: 'cf1', itemName: 'Chicken Biryani', quantity: 2, price: 220, unit: '1 portion' }],
      itemsSummary: '2x Chicken Biryani (1 portion)', isDeleted: false,
    },
    {
      orderId: `FM-${Date.now().toString().slice(-6)}2`,
      customerName: 'Priya Patel', customerPhone: '919876543211',
      address: 'Tower B, Infocity, Patia, Bhubaneswar', totalAmount: 320,
      stage: 1, status: 'Order Accepted ✅', orderCategory: 'grocery', orderCategoryLabel: 'GROCERY',
      riderId: 'FM-RAM-4827', riderName: 'Ramesh Delivery',
      items: [{ itemId: 'gr1', itemName: 'Basmati Rice', quantity: 1, price: 180, unit: '5 kg' }],
      itemsSummary: '1x Basmati Rice (5 kg)', isDeleted: false,
    },
    {
      orderId: `FM-${Date.now().toString().slice(-6)}3`,
      customerName: 'Amit Kumar', customerPhone: '919876543212',
      address: 'Plot 45, Chandrasekharpur, Bhubaneswar', totalAmount: 180,
      stage: 3, status: 'Delivered 🏁', orderCategory: 'vegetables', orderCategoryLabel: 'VEGETABLES',
      riderId: 'FM-SUR-9134', riderName: 'Suresh Kumar',
      items: [{ itemId: 'vg1', itemName: 'Fresh Tomato', quantity: 2, price: 40, unit: '1 kg' }],
      itemsSummary: '2x Fresh Tomato (1 kg)', isDeleted: false,
    },
    {
      orderId: `FM-${Date.now().toString().slice(-6)}4`,
      customerName: 'Sneha Singh', customerPhone: '919876543213',
      address: 'Lane 5, Jaydev Vihar, Bhubaneswar', totalAmount: 240,
      stage: 2, status: 'Out for Delivery 🛵', orderCategory: 'cooked_food', orderCategoryLabel: 'COOKED FOOD',
      riderId: 'FM-RAJ-2056', riderName: 'Rajesh Rider',
      items: [{ itemId: 'cf2', itemName: 'Paneer Butter Masala', quantity: 1, price: 180, unit: '1 portion' }],
      itemsSummary: '1x Paneer Butter Masala', isDeleted: false,
    },
    {
      orderId: `FM-${Date.now().toString().slice(-6)}5`,
      customerName: 'Vikash Yadav', customerPhone: '919876543214',
      address: 'House 12, Old Town, Bhubaneswar', totalAmount: 120,
      stage: -1, status: 'Cancelled ❌', orderCategory: 'snacks', orderCategoryLabel: 'SNACKS',
      items: [{ itemId: 'sn1', itemName: 'Samosa', quantity: 3, price: 40, unit: '4 pcs' }],
      itemsSummary: '3x Samosa (4 pcs)', isDeleted: false,
    },
  ];

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    try {
      const createdAt = new Date(now.getTime() - (orders.length - i) * 3600000);
      const docData = {
        ...o,
        createdAt: Timestamp.fromDate(createdAt),
        updatedAt: Timestamp.fromDate(new Date(createdAt.getTime() + 600000)),
        isDeleted: false,
      };
      if (o.stage >= 1) docData.acceptedAt = Timestamp.fromDate(new Date(createdAt.getTime() + 300000));
      if (o.stage === 3) docData.deliveredAt = Timestamp.fromDate(new Date(createdAt.getTime() + 1800000));
      if (o.stage === -1) docData.cancelledAt = Timestamp.fromDate(new Date(createdAt.getTime() + 120000));
      await setDoc(doc(db, 'orders', o.orderId), docData);
      console.log(`  ✅ Order: ${o.orderId} — ${o.status} (₹${o.totalAmount})`);
    } catch (e) {
      console.log(`  ❌ Order ${o.orderId}: ${e.code} — ${e.message}`);
    }
  }

  console.log('\nDone. Check results above.');
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
