// Bundled app catalog mirror — names/categories/base prices as shipped in the
// customer app (1_Customer_App/lib/core/data/food_mela_data.dart).
// Used so admin picks items BY NAME; the doc ID is the itemId (never typed).
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  basePrice: number;
  unit?: string;
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
  { id: 'cf1', name: 'Chicken Biryani', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 220, unit: '1 Full Plate' },
  { id: 'cf2', name: 'Paneer Butter Masala', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 180, unit: '1 Portion' },
  { id: 'cf3', name: 'Dal Makhani', category: 'cooked_food', categoryLabel: 'Cooked Food', basePrice: 150, unit: '1 Portion' },
  { id: 'cf4', name: 'Mutton Curry', category: 'non_veg', categoryLabel: 'Non-Veg', basePrice: 280, unit: '1 Portion' },
  { id: 'cf5', name: 'Fish Curry', category: 'non_veg', categoryLabel: 'Non-Veg', basePrice: 240, unit: '1 Portion' },
  { id: 'sw1', name: 'Rasgulla (6 pcs)', category: 'sweets', categoryLabel: 'Sweets', basePrice: 80, unit: '6 pcs' },
  { id: 'sw2', name: 'Gulab Jamun (6 pcs)', category: 'sweets', categoryLabel: 'Sweets', basePrice: 70, unit: '6 pcs' },
  { id: 'sw3', name: 'Kheer (250ml)', category: 'sweets', categoryLabel: 'Sweets', basePrice: 60, unit: '250 ml' },
  { id: 'sn1', name: 'Samosa (4 pcs)', category: 'snacks', categoryLabel: 'Snacks', basePrice: 40, unit: '4 pcs' },
  { id: 'sn2', name: 'Aloo Tikki (4 pcs)', category: 'snacks', categoryLabel: 'Snacks', basePrice: 50, unit: '4 pcs' },
  { id: 'vg1', name: 'Fresh Tomato', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 40, unit: '1 kg' },
  { id: 'vg2', name: 'Potato', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 30, unit: '1 kg' },
  { id: 'vg3', name: 'Onion', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 35, unit: '1 kg' },
  { id: 'vg4', name: 'Brinjal (Baingan)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 30, unit: '1 kg' },
  { id: 'vg5', name: 'Cabbage (Pattagobi)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 30, unit: '1 kg' },
  { id: 'vg6', name: 'Cauliflower (Phoolgobi)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 35, unit: '1 kg' },
  { id: 'vg7', name: 'Lady Finger (Bhindi)', category: 'vegetables', categoryLabel: 'Vegetables', basePrice: 40, unit: '1 kg' },
  { id: 'fr1', name: 'Banana (Dozen)', category: 'fruits', categoryLabel: 'Fruits', basePrice: 50, unit: '1 Dozen (12 pcs)' },
  { id: 'fr2', name: 'Apple', category: 'fruits', categoryLabel: 'Fruits', basePrice: 160, unit: '1 kg' },
  { id: 'gr1', name: 'Basmati Rice (India Gate)', category: 'grocery', categoryLabel: 'Grocery', basePrice: 180, unit: '1 kg' },
  { id: 'gr2', name: 'Refined Oil (Fortune)', category: 'grocery', categoryLabel: 'Grocery', basePrice: 145, unit: '1 Litre' },
  { id: 'da1', name: 'Full Cream Milk (Amul)', category: 'dairy', categoryLabel: 'Dairy', basePrice: 62, unit: '1 Litre' },
  { id: 'da2', name: 'Paneer (Fresh)', category: 'dairy', categoryLabel: 'Dairy', basePrice: 80, unit: '200g' },
  { id: 'em1', name: 'Farm Eggs', category: 'eggs_meat', categoryLabel: 'Eggs & Meat', basePrice: 72, unit: '1 Dozen (12 pcs)' },
  { id: 'em2', name: 'Chicken (Boneless)', category: 'eggs_meat', categoryLabel: 'Eggs & Meat', basePrice: 320, unit: '1 kg' },
];
