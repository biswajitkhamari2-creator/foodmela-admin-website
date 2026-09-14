// Bundled app catalog mirror — names/categories/base prices as shipped in the
// customer app (1_Customer_App/lib/core/data/food_mela_data.dart).
// Used so admin picks items BY NAME; the doc ID is the itemId (never typed).
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  basePrice: number;
}

export const CATEGORY_LABELS: Record<string, string> = {
  cooked_food: 'Cooked Food',
  non_veg: 'Non-Veg',
  sweets: 'Sweets',
  snacks: 'Snacks',
  vegetables: 'Vegetables',
  fruits: 'Fruits',
  grocery: 'Grocery',
  dairy: 'Dairy',
  eggs_meat: 'Eggs & Meat',
};

export const CATALOG: CatalogItem[] = [
  { id: 'cf1', name: 'Chicken Biryani', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 220 },
  { id: 'cf2', name: 'Paneer Butter Masala', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 180 },
  { id: 'cf3', name: 'Dal Makhani', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 150 },
  { id: 'cf4', name: 'Mutton Curry', category: 'non_veg', categoryLabel: 'Non-Veg', basePrice: 280 },
  { id: 'cf5', name: 'Fish Curry', category: 'non_veg', categoryLabel: 'Non-Veg', basePrice: 240 },
  { id: 'sw1', name: 'Rasgulla (6 pcs)', category: 'sweets', categoryLabel: 'Sweets', basePrice: 80 },
  { id: 'sw2', name: 'Gulab Jamun (6 pcs)', category: 'sweets', categoryLabel: 'Sweets', basePrice: 70 },
  { id: 'sw3', name: 'Kheer (250ml)', category: 'sweets', categoryLabel: 'Sweets', basePrice: 60 },
  { id: 'sn1', name: 'Samosa (4 pcs)', category: 'snacks', categoryLabel: 'Snacks', basePrice: 40 },
  { id: 'sn2', name: 'Aloo Tikki (4 pcs)', category: 'snacks', categoryLabel: 'Snacks', basePrice: 50 },
  { id: 'vg1', name: 'Fresh Tomato', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 40 },
  { id: 'vg2', name: 'Potato', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 30 },
  { id: 'vg3', name: 'Onion', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 35 },
  { id: 'vg4', name: 'Brinjal (Baingan)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 30 },
  { id: 'vg5', name: 'Cabbage (Pattagobi)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 30 },
  { id: 'vg6', name: 'Cauliflower (Phoolgobi)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 35 },
  { id: 'vg7', name: 'Lady Finger (Bhindi)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 40 },
  { id: 'fr1', name: 'Banana (Dozen)', category: 'fruits', categoryLabel: 'Fruits', basePrice: 50 },
  { id: 'fr2', name: 'Apple', category: 'fruits', categoryLabel: 'Fruits', basePrice: 160 },
  { id: 'gr1', name: 'Basmati Rice (India Gate)', category: 'grocery', categoryLabel: 'Grocery', basePrice: 180 },
  { id: 'gr2', name: 'Refined Oil (Fortune)', category: 'grocery', categoryLabel: 'Grocery', basePrice: 145 },
  { id: 'da1', name: 'Full Cream Milk (Amul)', category: 'dairy', categoryLabel: 'Dairy', basePrice: 62 },
  { id: 'da2', name: 'Paneer (Fresh)', category: 'dairy', categoryLabel: 'Dairy', basePrice: 80 },
  { id: 'em1', name: 'Farm Eggs', category: 'eggs_meat', categoryLabel: 'Eggs & Meat', basePrice: 72 },
  { id: 'em2', name: 'Chicken (Boneless)', category: 'eggs_meat', categoryLabel: 'Eggs & Meat', basePrice: 320 },
];
