import type { Timestamp } from 'firebase/firestore';

export type AccountStatus = 'active' | 'blocked';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'customer' | 'delivery_partner' | 'admin';

export interface UserRecord {
  id: string; // phone (doc ID)
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  accountStatus: AccountStatus;
  approvalStatus: ApprovalStatus;
  partnerId?: string; // FM-XXX-XXXX
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  approvedAt?: Timestamp | null;
}

export interface OrderRecord {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: unknown;
  itemsSummary?: string;
  totalAmount: number;
  status: string;
  stage: number; // 0=pending, 1=accepted, 2=out_for_delivery, 3=delivered, -1=cancelled
  riderId?: string | null;
  riderName?: string | null;
  deliveryOtp?: string;
  orderCategory?: string;
  orderCategoryLabel?: string;
  createdAt?: Timestamp | null;
  acceptedAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  deliveredAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  paymentMethod?: string;
  paymentStatus?: string;
  deliveryFee?: number;
  discount?: number;
  tax?: number;
  specialInstructions?: string;
  pincode?: string;
  locality?: string;
  isDeleted?: boolean;
}

export interface AuditLog {
  id: string;
  adminPhone: string;
  adminName: string;
  action: string;
  targetId: string;
  targetType: string;
  metadata?: Record<string, unknown>;
  timestamp?: Timestamp | null;
  createdAt?: Timestamp | null;
}

export interface DashboardStats {
  totalCustomers: number;
  activeCustomers: number;
  blockedCustomers: number;
  totalPartners: number;
  activePartners: number;
  blockedPartners: number;
  pendingApprovals: number;
  totalOrders: number;
  pendingOrders: number;
  acceptedOrders: number;
  outForDeliveryOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  todayOrders: number;
  todayRevenue: number;
  totalRevenue: number;
}
